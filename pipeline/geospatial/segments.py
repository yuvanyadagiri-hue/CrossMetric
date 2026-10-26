"""Mid-block segment units.

Road length that is not inside any intersection's influence area (76.2 m,
the Highway Safety Manual's 250 ft convention) is "mid-block". Mid-block road
is merged per road (route key), then cut into equal units of at most
SEGMENT_UNIT_MAX_M so that every candidate represents a comparable amount of
roadway. Units shorter than SEGMENT_UNIT_MIN_M are discarded.

Only the inventory-direction carriageway (INC) of a divided highway produces
units; the opposite carriageway (DEC) would otherwise duplicate every unit.
Crashes recorded on a DEC carriageway are re-assigned to the matching INC unit
during crash association.
"""

from __future__ import annotations

import math

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge, substring
from shapely.strtree import STRtree

from pipeline.config import INTERSECTION_INFLUENCE_M, SEGMENT_UNIT_MAX_M, SEGMENT_UNIT_MIN_M
from pipeline.ingestion.roads import ROLE_SURFACE


def split_equal(line: LineString, max_len: float = SEGMENT_UNIT_MAX_M) -> list[LineString]:
    """Cut ``line`` into ceil(L / max_len) pieces of equal length."""
    n = max(1, math.ceil(line.length / max_len))
    step = line.length / n
    return [substring(line, i * step, (i + 1) * step) for i in range(n)]


def _as_lines(geom) -> list[LineString]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        merged = linemerge(geom)
        return list(merged.geoms) if isinstance(merged, MultiLineString) else [merged]
    return [g for g in shapely.get_parts(geom) if isinstance(g, LineString)]


def build_segment_units(roads: gpd.GeoDataFrame, intersections: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    surface = roads[(roads["role"] == ROLE_SURFACE) & (roads["direction"] != "DEC")]
    if surface.empty:
        return gpd.GeoDataFrame(columns=["route_key", "route_id", "f_system", "lanes", "geometry"], geometry="geometry", crs=roads.crs)
    # Each road only needs the influence zones near it; subtracting one giant
    # union of every zone in a metro-sized region would be very slow.
    zones = intersections.geometry.buffer(INTERSECTION_INFLUENCE_M).values if len(intersections) else None
    zone_tree = STRtree(zones) if zones is not None else None

    rows = []
    run_no = 0
    for route_key, grp in surface.groupby("route_key", sort=True):
        geom = shapely.union_all(grp.geometry.values)
        if zone_tree is not None:
            near = zone_tree.query(geom, predicate="intersects")
            if len(near):
                geom = shapely.difference(geom, shapely.union_all(zones[near]))
        sections = grp.geometry.values
        for run in _as_lines(geom):
            if run.length < SEGMENT_UNIT_MIN_M:
                continue
            run_no += 1
            pieces = [u for u in split_equal(run) if u.length >= SEGMENT_UNIT_MIN_M]
            for part, unit in enumerate(pieces, start=1):
                # attributes come from the GDOT section under the unit's midpoint
                mid = unit.interpolate(0.5, normalized=True)
                major = grp.iloc[int(np.argmin(shapely.distance(sections, mid)))]
                rows.append(
                    {
                        "run": run_no,
                        "part": part,
                        "parts": len(pieces),
                        "run_start": shapely.get_point(run, 0),
                        "run_end": shapely.get_point(run, -1),
                        "route_key": route_key,
                        "route_id": major["route_id"],
                        "f_system": major["f_system"],
                        "lanes": major["lanes"],
                        "system_code": major["system_code"],
                        "length_m": unit.length,
                        "geometry": unit,
                    }
                )
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=roads.crs)
