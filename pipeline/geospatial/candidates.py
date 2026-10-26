"""Candidate locations: intersections and mid-block segment units.

Schools whose analysis areas overlap are processed together as one "region",
so a location near two schools is built once and gets one stable ID.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import Point
from shapely.ops import substring
from shapely.strtree import STRtree

from pipeline.config import MAX_RADIUS_M, NETWORK_MARGIN_M, SIGNAL_MATCH_M
from pipeline.geospatial.intersections import cluster_nodes, detect_nodes
from pipeline.geospatial.naming import Namer, fallback_name
from pipeline.geospatial.segments import build_segment_units
from pipeline.geospatial.traffic import TrafficIndex
from pipeline.ingestion.roads import ROLE_CONNECTOR, ROLE_RAMP, ROLE_SURFACE

LEG_SEARCH_M = 2.0       # a road whose line passes this close to an intersection node is one of its legs
LEG_NAME_RADIUS_M = 60.0 # leg names are taken from the first 60 m of each leg
RUN_END_SEARCH_M = 110.0 # a mid-block run's end is "at" an intersection within this distance

FUNCTIONAL_CLASS = {
    1: "Interstate",
    2: "Freeway or expressway",
    3: "Principal arterial",
    4: "Minor arterial",
    5: "Major collector",
    6: "Minor collector",
    7: "Local road",
}


def stable_id(prefix: str, *coords: float) -> str:
    """Deterministic ID from rounded projected coordinates (1 m)."""
    key = prefix + ":" + ",".join(f"{round(c):d}" for c in coords)
    return prefix + hashlib.sha1(key.encode()).hexdigest()[:10]


def build_regions(schools_ac: gpd.GeoDataFrame) -> list:
    buffers = schools_ac.geometry.buffer(MAX_RADIUS_M + NETWORK_MARGIN_M).values
    return list(shapely.get_parts(shapely.union_all(buffers)))


@dataclass
class Context:
    roads: gpd.GeoDataFrame
    roads_tree: STRtree
    namer: Namer
    traffic: TrafficIndex
    signals_tree: STRtree | None


def clip_roads(ctx: Context, region) -> gpd.GeoDataFrame:
    idx = ctx.roads_tree.query(region, predicate="intersects")
    sub = ctx.roads.iloc[idx].copy()
    sub["geometry"] = shapely.intersection(sub.geometry.values, region)
    sub = sub[~sub.geometry.is_empty]
    sub = sub.explode(index_parts=False, ignore_index=True)
    sub = sub[sub.geometry.geom_type == "LineString"]
    return sub[sub.geometry.length > 0.5].reset_index(drop=True)


def _name_or_fallback(namer: Namer, geom, route_key: str, system_code: str) -> tuple[str, bool]:
    name = namer.name_for(geom)
    if name:
        return name, True
    return fallback_name(route_key, system_code), False


def build_intersections(ctx: Context, roads: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    clusters = cluster_nodes(detect_nodes(roads))
    if clusters.empty:
        return clusters
    leg_roads = roads[roads["role"].isin([ROLE_SURFACE, ROLE_CONNECTOR, ROLE_RAMP])].reset_index(drop=True)
    leg_tree = STRtree(leg_roads.geometry.values)
    rows = []
    for c in clusters.itertuples():
        center: Point = c.geometry
        # (a single query geometry returns a 1-D array of tree indices)
        idx = np.unique(leg_tree.query(c.node_points, predicate="dwithin", distance=LEG_SEARCH_M))
        legs = leg_roads.iloc[idx]
        route_keys = sorted(set(legs["route_key"]))
        traffic, per_road = ctx.traffic.for_intersection(center, route_keys)
        aadt_by_key = dict(zip(route_keys, per_road))
        # Name every *arm* (each direction leaving the intersection) on its
        # own. A GDOT local route can turn from one street onto another at a
        # junction, so naming whole legs would merge two streets into one.
        named: dict[str, tuple[int, float]] = {}  # name -> (best f_system, aadt)
        for leg in legs[legs["role"] == ROLE_SURFACE].itertuples():
            line = leg.geometry
            d = line.project(center)
            arms = (substring(line, d, min(line.length, d + LEG_NAME_RADIUS_M)),
                    substring(line, max(0.0, d - LEG_NAME_RADIUS_M), d))
            fs = int(leg.f_system) if pd.notna(leg.f_system) else 7
            for arm in arms:
                if arm.is_empty or arm.length < 10:
                    continue
                name, _ = _name_or_fallback(ctx.namer, arm, leg.route_key, leg.system_code)
                vol = aadt_by_key.get(leg.route_key) or 0.0
                prev = named.get(name)
                if prev is None or (fs, -vol) < (prev[0], -prev[1]):
                    named[name] = (fs, vol)
        # order: most major road first, then busiest, then alphabetical;
        # "Unnamed road" never leads when a real name exists
        distinct_names = [
            nm for nm, _ in sorted(named.items(), key=lambda kv: (kv[0] == "Unnamed road", kv[1][0], -kv[1][1], kv[0]))
        ]
        if len(distinct_names) > 1 and "Unnamed road" in distinct_names:
            distinct_names.remove("Unnamed road")
        f_systems = [v[0] for v in named.values()] or [7]
        if len(distinct_names) >= 2:
            label = f"{distinct_names[0]} & {distinct_names[1]}"
        elif distinct_names:
            label = f"{distinct_names[0]} (junction)"
        else:
            label = "Unnamed intersection"
        signalized = None
        if ctx.signals_tree is not None and len(ctx.signals_tree.query(center, predicate="dwithin", distance=SIGNAL_MATCH_M)):
            signalized = True
        rows.append(
            {
                "candidate_id": stable_id("I", center.x, center.y),
                "kind": "intersection",
                "name": label,
                "roads": distinct_names,
                "route_keys": route_keys,
                "f_system": min(f_systems),
                "lanes": None,
                "length_m": None,
                "legs": int(c.max_dirs),
                "signalized": signalized,
                "aadt": traffic.aadt,
                "aadt_year": traffic.year,
                "aadt_status": traffic.status,
                "aadt_roads_counted": traffic.roads_counted,
                "aadt_roads_total": traffic.roads_total,
                "context": None,
                "geometry": center,
            }
        )
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=roads.crs)


def build_segments(ctx: Context, roads: gpd.GeoDataFrame, intersections: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    units = build_segment_units(roads, intersections)
    if units.empty:
        return units
    int_tree = STRtree(intersections.geometry.values) if len(intersections) else None
    int_names = intersections["roads"].to_numpy() if len(intersections) else np.array([])
    int_keys = intersections["route_keys"].to_numpy() if len(intersections) else np.array([])

    def cross_street(pt, route_key: str, own: str) -> str | None:
        if int_tree is None:
            return None
        idx = int_tree.query(pt, predicate="dwithin", distance=RUN_END_SEARCH_M)
        idx = [i for i in idx if route_key in int_keys[i]]
        if not idx:
            return None
        i = min(idx, key=lambda j: intersections.geometry.values[j].distance(pt))
        others = [n for n in int_names[i] if n != own]
        return others[0] if others else None

    rows = []
    run_cache: dict[int, tuple[str, bool, str | None, str | None]] = {}
    for u in units.itertuples():
        if u.run not in run_cache:
            name, _ = _name_or_fallback(ctx.namer, u.geometry, u.route_key, u.system_code)
            run_cache[u.run] = (
                name,
                True,
                cross_street(u.run_start, u.route_key, name),
                cross_street(u.run_end, u.route_key, name),
            )
        name, _, a, b = run_cache[u.run]
        if a and b and a != b:
            context = f"between {a} and {b}"
        elif a or b:
            context = f"near {a or b}"
        else:
            context = None
        if u.parts > 1:
            context = (context + ", " if context else "") + f"section {u.part} of {u.parts}"
        traffic = ctx.traffic.for_segment(u.geometry, u.route_key)
        start, end = shapely.get_point(u.geometry, 0), shapely.get_point(u.geometry, -1)
        rows.append(
            {
                "candidate_id": stable_id("S", start.x, start.y, end.x, end.y),
                "kind": "segment",
                "name": name,
                "roads": [name],
                "route_keys": [u.route_key],
                "f_system": int(u.f_system) if pd.notna(u.f_system) else 7,
                "lanes": float(u.lanes) if pd.notna(u.lanes) else None,
                "length_m": float(u.length_m),
                "legs": None,
                "signalized": None,
                "aadt": traffic.aadt,
                "aadt_year": traffic.year,
                "aadt_status": traffic.status,
                "aadt_roads_counted": traffic.roads_counted,
                "aadt_roads_total": traffic.roads_total,
                "context": context,
                "geometry": u.geometry,
            }
        )
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=roads.crs)


def process_region(ctx: Context, region) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """Return (clipped roads, intersections, segment units) for one region."""
    roads = clip_roads(ctx, region)
    intersections = build_intersections(ctx, roads)
    segments = build_segments(ctx, roads, intersections)
    return roads, intersections, segments
