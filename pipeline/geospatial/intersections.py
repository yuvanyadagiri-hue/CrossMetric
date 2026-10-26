"""Intersection detection.

Definition used by CrossMetric:

    An intersection is a point where surface roads leave in three or more
    distinct directions (or two surface directions plus the end of a ramp).

Counting *directions* rather than line features makes the rule robust to the
quirks of a linear-referencing network:

* GDOT splits a road wherever an attribute changes, so two features often meet
  end-to-end mid-block. That point has only two directions -> not an
  intersection.
* Concurrent routes can share identical geometry. Duplicate directions
  collapse into one.
* Interstates and freeways (access-controlled) never contribute directions,
  so an overpass is never mistaken for an at-grade crossing.
* Ramps contribute only at their ends, which creates ramp-terminal
  intersections but not false crossings where a ramp flies over a street.
* Slip lanes (Y-connectors) never contribute, so they don't spawn extra
  intersections at corners.

Nodes closer than INTERSECTION_CLUSTER_M are then merged, so a divided highway
crossing a street (two carriageways -> two nodes) becomes one intersection.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from pipeline.config import INTERSECTION_CLUSTER_M
from pipeline.ingestion.roads import ROLE_RAMP, ROLE_SURFACE

NODE_TOLERANCE_M = 1.5    # lines this close to a node point are "at" the node
BEARING_SAMPLE_M = 12.0   # how far along a line to look when measuring its direction
MIN_SAMPLE_M = 3.0        # ignore stubs shorter than this
BEARING_MERGE_DEG = 25.0  # directions closer than this are the same direction


@dataclass(frozen=True)
class NodeDirections:
    surface: int
    ramp: int

    @property
    def is_intersection(self) -> bool:
        return self.surface >= 3 or (self.surface >= 2 and self.ramp >= 1)


def _bearing(p: Point, q: Point) -> float:
    return math.degrees(math.atan2(q.y - p.y, q.x - p.x)) % 360.0


def directions_from(line: LineString, p: Point, endpoints_only: bool) -> list[float]:
    """Bearings (degrees) of the ways one can leave point ``p`` along ``line``."""
    length = line.length
    d = line.project(p)
    at_start, at_end = d <= NODE_TOLERANCE_M, (length - d) <= NODE_TOLERANCE_M
    if endpoints_only and not (at_start or at_end):
        return []
    bearings: list[float] = []
    for target in (d + BEARING_SAMPLE_M, d - BEARING_SAMPLE_M):
        t = min(max(target, 0.0), length)
        q = line.interpolate(t)
        if q.distance(p) >= MIN_SAMPLE_M:
            bearings.append(_bearing(p, q))
    return bearings


def count_distinct(bearings: list[float], merge_deg: float = BEARING_MERGE_DEG) -> int:
    """Number of distinct directions after merging bearings within ``merge_deg`` (circular)."""
    if not bearings:
        return 0
    b = sorted(x % 360.0 for x in bearings)
    groups = 1
    for prev, cur in zip(b, b[1:]):
        if cur - prev > merge_deg:
            groups += 1
    # the circle wraps: the first and last groups may be the same direction
    if groups > 1 and (b[0] + 360.0 - b[-1]) <= merge_deg:
        groups -= 1
    return groups


def candidate_points(surface: gpd.GeoDataFrame, ramps: gpd.GeoDataFrame) -> np.ndarray:
    """Every place an intersection could be: line ends and surface-surface crossings."""
    pts = [shapely.get_point(surface.geometry.values, 0), shapely.get_point(surface.geometry.values, -1)]
    if len(ramps):
        pts += [shapely.get_point(ramps.geometry.values, 0), shapely.get_point(ramps.geometry.values, -1)]
    geoms = surface.geometry.values
    tree = STRtree(geoms)
    left, right = tree.query(geoms, predicate="intersects")
    keep = left < right
    left, right = left[keep], right[keep]
    if len(left):
        inter = shapely.intersection(geoms[left], geoms[right])
        parts = shapely.get_parts(inter)
        points = parts[shapely.get_type_id(parts) == 0]  # Points only; overlaps (lines) are ignored
        pts.append(points)
    allpts = np.concatenate([np.asarray(p) for p in pts if len(p)])
    # de-duplicate at 10 cm
    xy = np.round(shapely.get_coordinates(allpts), 1)
    _, idx = np.unique(xy, axis=0, return_index=True)
    return allpts[np.sort(idx)]


def detect_nodes(roads: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Return intersection nodes (before clustering) with their direction counts."""
    surface = roads[roads["role"] == ROLE_SURFACE].reset_index(drop=True)
    ramps = roads[roads["role"] == ROLE_RAMP].reset_index(drop=True)
    if surface.empty:
        return gpd.GeoDataFrame({"surface_dirs": [], "ramp_dirs": []}, geometry=[], crs=roads.crs)
    points = candidate_points(surface, ramps)
    s_tree = STRtree(surface.geometry.values)
    r_tree = STRtree(ramps.geometry.values) if len(ramps) else None

    s_pt, s_line = s_tree.query(points, predicate="dwithin", distance=NODE_TOLERANCE_M)
    by_point_surface: dict[int, list[int]] = {}
    for pi, li in zip(s_pt, s_line):
        by_point_surface.setdefault(int(pi), []).append(int(li))
    by_point_ramp: dict[int, list[int]] = {}
    if r_tree is not None:
        r_pt, r_line = r_tree.query(points, predicate="dwithin", distance=NODE_TOLERANCE_M)
        for pi, li in zip(r_pt, r_line):
            by_point_ramp.setdefault(int(pi), []).append(int(li))

    out_geoms, s_counts, r_counts = [], [], []
    sgeoms, rgeoms = surface.geometry.values, ramps.geometry.values
    for pi, lines in by_point_surface.items():
        if len(lines) < 2 and pi not in by_point_ramp:
            # a single line can only form an intersection by crossing itself
            continue
        p = points[pi]
        s_bear = [b for li in lines for b in directions_from(sgeoms[li], p, endpoints_only=False)]
        n_surface = count_distinct(s_bear)
        n_ramp = 0
        if pi in by_point_ramp:
            r_bear = [b for li in by_point_ramp[pi] for b in directions_from(rgeoms[li], p, endpoints_only=True)]
            n_ramp = count_distinct(r_bear)
        nd = NodeDirections(n_surface, n_ramp)
        if nd.is_intersection:
            out_geoms.append(p)
            s_counts.append(n_surface)
            r_counts.append(n_ramp)
    return gpd.GeoDataFrame({"surface_dirs": s_counts, "ramp_dirs": r_counts}, geometry=out_geoms, crs=roads.crs)


def cluster_nodes(nodes: gpd.GeoDataFrame, radius: float = INTERSECTION_CLUSTER_M) -> gpd.GeoDataFrame:
    """Merge nodes within ``radius`` (single linkage) into intersection clusters."""
    if nodes.empty:
        return gpd.GeoDataFrame({"n_nodes": [], "max_dirs": []}, geometry=[], crs=nodes.crs)
    geoms = nodes.geometry.values
    tree = STRtree(geoms)
    a, b = tree.query(geoms, predicate="dwithin", distance=radius)
    parent = list(range(len(geoms)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, j in zip(a, b):
        ri, rj = find(int(i)), find(int(j))
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)
    labels = np.array([find(i) for i in range(len(geoms))])
    xy = shapely.get_coordinates(geoms)
    rows = []
    for lab in np.unique(labels):
        m = labels == lab
        cx, cy = xy[m, 0].mean(), xy[m, 1].mean()
        rows.append(
            {
                "n_nodes": int(m.sum()),
                "max_dirs": int((nodes["surface_dirs"].to_numpy()[m] + nodes["ramp_dirs"].to_numpy()[m]).max()),
                "node_points": shapely.multipoints(xy[m]),
                "geometry": Point(cx, cy),
            }
        )
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=nodes.crs)
