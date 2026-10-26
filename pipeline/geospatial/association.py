"""Crash -> candidate association.

Each crash is assigned to at most one candidate, so no crash is ever counted
twice. The steps, in order:

1. Snap to the nearest road centerline within CRASH_SNAP_TOLERANCE_M (30 m).
   No road that close -> "off_network" (e.g. deep in a parking lot or field).
2. Snapped to an interstate/freeway mainline -> "limited_access" (excluded;
   pedestrians are not on these roads and school-area review does not
   address them).
3. Within INTERSECTION_INFLUENCE_M (76.2 m) of an intersection that the
   snapped road actually belongs to -> that intersection.
4. Otherwise -> the nearest mid-block unit on the same road. Crashes on the
   opposite (DEC) carriageway of a divided road land on the INC unit because
   both carriageways share a route key.
5. Ramp crashes away from a ramp terminal -> "ramp" (excluded).
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.strtree import STRtree

from pipeline.config import CRASH_SNAP_TOLERANCE_M, INTERSECTION_INFLUENCE_M
from pipeline.ingestion.roads import ROLE_ACCESS_CONTROLLED, ROLE_CONNECTOR, ROLE_RAMP

SEGMENT_SEARCH_M = 45.0  # crash-to-unit search (unit may sit on the other carriageway)

UNASSIGNED_REASONS = {
    "off_network": f"More than {CRASH_SNAP_TOLERANCE_M:.0f} m from any road centerline.",
    "limited_access": "On an interstate or freeway mainline.",
    "ramp": "On a ramp, away from any ramp-terminal intersection.",
    "no_candidate": "On a road segment too short to form a mid-block unit, outside any intersection area.",
}


def _nearest_per_crash(crash_idx: np.ndarray, target_idx: np.ndarray, dist: np.ndarray) -> dict[int, int]:
    if len(crash_idx) == 0:
        return {}
    df = pd.DataFrame({"c": crash_idx, "t": target_idx, "d": dist}).sort_values(["c", "d", "t"])
    first = df.drop_duplicates("c", keep="first")
    return dict(zip(first["c"].to_numpy(), first["t"].to_numpy()))


def associate(
    crash_points: np.ndarray,
    roads: gpd.GeoDataFrame,
    intersections: gpd.GeoDataFrame,
    units: gpd.GeoDataFrame,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (candidate_id or "" per crash, status per crash)."""
    n = len(crash_points)
    candidate = np.full(n, "", dtype=object)
    status = np.full(n, "off_network", dtype=object)
    if n == 0 or roads.empty:
        return candidate, status

    road_geoms = roads.geometry.values
    road_tree = STRtree(road_geoms)
    (c_idx, r_idx), dist = road_tree.query_nearest(
        crash_points, max_distance=CRASH_SNAP_TOLERANCE_M, return_distance=True, all_matches=False
    )
    snapped_road = np.full(n, -1)
    snapped_road[c_idx] = r_idx
    roles = roads["role"].to_numpy()
    keys = roads["route_key"].to_numpy()

    # intersections the crash is near, restricted to ones the snapped road belongs to
    int_choice: dict[int, int] = {}
    if len(intersections):
        int_tree = STRtree(intersections.geometry.values)
        ci, ii = int_tree.query(crash_points, predicate="dwithin", distance=INTERSECTION_INFLUENCE_M)
        legs = intersections["route_keys"].to_numpy()
        ok = []
        for c, i in zip(ci, ii):
            r = snapped_road[c]
            if r < 0:
                ok.append(False)
            elif roles[r] == ROLE_CONNECTOR:
                ok.append(True)  # slip lanes belong to whatever intersection they serve
            else:
                ok.append(keys[r] in legs[i])
        ok = np.asarray(ok, dtype=bool)
        if ok.any():
            d = shapely.distance(crash_points[ci[ok]], intersections.geometry.values[ii[ok]])
            int_choice = _nearest_per_crash(ci[ok], ii[ok], d)

    unit_choice: dict[int, int] = {}
    if len(units):
        u_tree = STRtree(units.geometry.values)
        cu, uu = u_tree.query(crash_points, predicate="dwithin", distance=SEGMENT_SEARCH_M)
        ukeys = units["route_keys"].to_numpy()
        ok = np.array([snapped_road[c] >= 0 and keys[snapped_road[c]] in ukeys[u] for c, u in zip(cu, uu)], dtype=bool)
        if ok.any():
            d = shapely.distance(crash_points[cu[ok]], units.geometry.values[uu[ok]])
            unit_choice = _nearest_per_crash(cu[ok], uu[ok], d)

    int_ids = intersections["candidate_id"].to_numpy() if len(intersections) else np.array([])
    unit_ids = units["candidate_id"].to_numpy() if len(units) else np.array([])
    for c in range(n):
        r = snapped_road[c]
        if r < 0:
            continue  # stays off_network
        role = roles[r]
        if role == ROLE_ACCESS_CONTROLLED:
            status[c] = "limited_access"
        elif c in int_choice:
            candidate[c], status[c] = int_ids[int_choice[c]], "assigned"
        elif role == ROLE_RAMP:
            status[c] = "ramp"
        elif c in unit_choice:
            candidate[c], status[c] = unit_ids[unit_choice[c]], "assigned"
        else:
            status[c] = "no_candidate"
    return candidate, status
