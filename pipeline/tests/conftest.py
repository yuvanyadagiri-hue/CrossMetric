"""Shared helpers for pipeline tests.

All geometries built here are SYNTHETIC test fixtures in the analysis CRS
(meters). They reproduce real network situations (overpasses, ramps, divided
highways) at known coordinates so the expected answer is obvious.
"""

from __future__ import annotations

import geopandas as gpd
import pytest
from shapely.geometry import LineString

from pipeline.config import ANALYSIS_CRS
from pipeline.ingestion.roads import ROLE_ACCESS_CONTROLLED, ROLE_CONNECTOR, ROLE_RAMP, ROLE_SURFACE


def road(route_id: str, coords, role: str = ROLE_SURFACE, f_system: int = 4, lanes: float = 2.0) -> dict:
    return {
        "route_id": route_id,
        "route_key": route_id[:-3],
        "direction": route_id[-3:],
        "system_code": route_id[4:5] if len(route_id) >= 5 else "2",
        "function_type": route_id[0],
        "f_system": f_system,
        "lanes": lanes,
        "role": role,
        "geometry": LineString(coords),
    }


def network(*rows: dict) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(list(rows), geometry="geometry", crs=ANALYSIS_CRS)


@pytest.fixture
def roles():
    return {"surface": ROLE_SURFACE, "ramp": ROLE_RAMP, "access": ROLE_ACCESS_CONTROLLED, "connector": ROLE_CONNECTOR}
