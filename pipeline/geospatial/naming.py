"""Street-name conflation: TIGER names onto GDOT geometry.

GDOT's inventory has no street names. For each GDOT line we look at nearby
TIGER roads, group them by name, and measure how far the GDOT line strays from
each named road: nine sample points (10%..90% along the line) are measured
against the named road and the *largest* distance is kept. A name matches only
if that worst-case distance is within NAME_MATCH_BUFFER_M.

Using the worst case (not overlap length) matters for short lines: a cross
street touches the middle of a short unit, but its far ends are well away from
the cross street, so the cross street can never win.
"""

from __future__ import annotations

import re

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.strtree import STRtree

from pipeline.config import NAME_MATCH_BUFFER_M

SAMPLE_FRACTIONS = np.linspace(0.1, 0.9, 9)


class Namer:
    def __init__(self, tiger: gpd.GeoDataFrame):
        self.tiger = tiger.reset_index(drop=True)
        self.geoms = self.tiger.geometry.values
        self.names = self.tiger["name"].to_numpy()
        self.common = (self.tiger["rttyp"].fillna("") == "M").to_numpy()
        self.tree = STRtree(self.geoms)

    def name_for(self, line: LineString) -> str | None:
        if line is None or line.is_empty or line.length < 5:
            return None
        idx = self.tree.query(line, predicate="dwithin", distance=NAME_MATCH_BUFFER_M)
        if len(idx) == 0:
            return None
        samples = shapely.line_interpolate_point(line, SAMPLE_FRACTIONS, normalized=True)
        best: tuple[float, int, str] | None = None
        for name in np.unique(self.names[idx]):
            members = idx[self.names[idx] == name]
            target = shapely.union_all(self.geoms[members])
            worst = float(shapely.distance(samples, target).max())
            if worst > NAME_MATCH_BUFFER_M:
                continue
            # prefer the closest fit; on a tie prefer a common street name
            # over a route number ("Medlock Bridge Rd" over "State Rte 141")
            key = (round(worst), 0 if self.common[members].any() else 1, name)
            if best is None or key < best:
                best = key
        return best[2] if best else None


_ROUTE_CODE = re.compile(r"^0*(\d+)$")


def fallback_name(route_key: str, system_code: str) -> str:
    """A readable label for roads TIGER could not name."""
    if system_code == "1" and len(route_key) >= 11:
        m = _ROUTE_CODE.match(route_key[5:11])
        if m:
            return f"SR {int(m.group(1))}"
    return "Unnamed road"
