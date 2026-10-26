"""Traffic exposure (AADT) for candidates.

AADT segments carry GDOT LRS Route IDs, so a candidate road is matched to AADT
on the *same route* (route key, ignoring INC/DEC) and nearby — never to a
merely nearby parallel road. Missing AADT stays missing: it is never treated
as zero (a zero would claim "no traffic", which is false).

Intersections: the AADT of each crossing road is summed, which approximates
the total vehicles entering the intersection per day. If only some of the
crossing roads have a count (common for local side streets), the sum is
reported with status "partial".
"""

from __future__ import annotations

from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import Point
from shapely.strtree import STRtree

SEGMENT_MATCH_M = 30.0
INTERSECTION_MATCH_M = 90.0


@dataclass(frozen=True)
class TrafficValue:
    aadt: float | None
    year: int | None
    status: str  # "measured" | "partial" | "unavailable"
    roads_counted: int
    roads_total: int


class TrafficIndex:
    def __init__(self, aadt: gpd.GeoDataFrame):
        aadt = aadt.reset_index(drop=True)
        self.geoms = aadt.geometry.values
        self.values = aadt["aadt"].to_numpy(dtype=float)
        self.years = aadt["aadt_year"].to_numpy()
        self.keys = aadt["route_id"].astype(str).str.slice(0, -3).to_numpy()
        self.tree = STRtree(self.geoms)

    def nearest_on_route(self, geom, route_key: str, max_dist: float) -> tuple[float, int] | None:
        idx = self.tree.query(geom, predicate="dwithin", distance=max_dist)
        idx = idx[self.keys[idx] == route_key]
        if len(idx) == 0:
            return None
        d = shapely.distance(self.geoms[idx], geom)
        j = idx[int(np.argmin(d))]
        return float(self.values[j]), int(self.years[j])

    def for_segment(self, line, route_key: str) -> TrafficValue:
        hit = self.nearest_on_route(line.interpolate(0.5, normalized=True), route_key, SEGMENT_MATCH_M)
        if hit is None:
            return TrafficValue(None, None, "unavailable", 0, 1)
        return TrafficValue(hit[0], hit[1], "measured", 1, 1)

    def for_intersection(self, center: Point, route_keys: list[str]) -> tuple[TrafficValue, list[float | None]]:
        per_road: list[float | None] = []
        years: list[int] = []
        for key in route_keys:
            hit = self.nearest_on_route(center, key, INTERSECTION_MATCH_M)
            per_road.append(hit[0] if hit else None)
            if hit:
                years.append(hit[1])
        counted = [v for v in per_road if v is not None]
        if not counted:
            return TrafficValue(None, None, "unavailable", 0, len(route_keys)), per_road
        status = "measured" if len(counted) == len(route_keys) else "partial"
        return TrafficValue(float(sum(counted)), max(years), status, len(counted), len(route_keys)), per_road
