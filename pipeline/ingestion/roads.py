"""GDOT Road Inventory 2025 -> CrossMetric road network.

The F_SYSTEM data item is already segmented along every LRS route and carries
its own geometry, so it is used as the base network. Each section gets:

* functional system (HPMS F_SYSTEM 1-7)
* LRS function type, system code and direction decoded from the Route ID
* through lanes (joined from THROUGH_LANES by route + milepoint)

Route ID anatomy (GDOT Road Inventory Data Dictionary, section 6):
    char 1      function type  (1 mainline, 2 ramp, 3 collector-distributor,
                                4 ramp-CD connector, 5 frontage road, 6 alley,
                                7 managed facility, 8 Y-connector, 9 private,
                                P projected, Z other)
    chars 2-4   county FIPS ("000" = statewide state route)
    char 5      system code    (1 state highway, 2 public road, 3 private, 4 federal)
    chars 6-11  route code
    chars 12-13 route suffix
    chars 14-16 direction      (INC inventory direction, DEC opposite carriageway)
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely

from pipeline.config import ACCESS_CONTROLLED_F_SYSTEM, ANALYSIS_CRS, INTERIM, RAW

GDB = RAW / "road_inventory" / "Road_Inventory_2025_Geodatabase.gdb"
ROADS_TABLE = INTERIM / "roads.parquet"

# Function types kept in the network.
MAINLINE, RAMP, CD, RAMP_CD, FRONTAGE, ALLEY, MANAGED, Y_CONNECTOR = "1", "2", "3", "4", "5", "6", "7", "8"
KEPT_FUNCTION_TYPES = {MAINLINE, RAMP, CD, RAMP_CD, FRONTAGE, MANAGED, Y_CONNECTOR}
RAMP_LIKE = {RAMP, CD, RAMP_CD}

# Road roles used by the candidate builder.
ROLE_SURFACE = "surface"            # ordinary streets: can be candidates, form intersections
ROLE_ACCESS_CONTROLLED = "access_controlled"  # interstates/freeways/express lanes: absorb crashes only
ROLE_RAMP = "ramp"                  # only ramp endpoints form (ramp-terminal) intersections
ROLE_CONNECTOR = "connector"        # slip lanes: part of an intersection, never a segment candidate


def decode_route_id(route_id: pd.Series) -> pd.DataFrame:
    rid = route_id.astype("string").str.strip()
    return pd.DataFrame(
        {
            "function_type": rid.str.slice(0, 1),
            "county_fips": rid.str.slice(1, 4),
            "system_code": rid.str.slice(4, 5),
            "direction": rid.str.slice(-3),
            # Carriageway partner key: INC and DEC carriageways of one road
            # share everything except the direction suffix.
            "route_key": rid.str.slice(0, -3),
        }
    )


def assign_role(function_type: pd.Series, f_system: pd.Series) -> pd.Series:
    role = pd.Series(ROLE_SURFACE, index=function_type.index, dtype="string")
    role[function_type.isin(RAMP_LIKE)] = ROLE_RAMP
    role[function_type == Y_CONNECTOR] = ROLE_CONNECTOR
    access_controlled = (function_type == MANAGED) | (
        (function_type == MAINLINE) & f_system.isin(list(ACCESS_CONTROLLED_F_SYSTEM))
    )
    role[access_controlled] = ROLE_ACCESS_CONTROLLED
    return role


def _lanes_lookup(sections: pd.DataFrame) -> pd.Series:
    """Through lanes at each section's midpoint milepoint (route-aware asof join)."""
    lanes = pyogrio.read_dataframe(
        GDB, layer="THROUGH_LANES", read_geometry=False, columns=["RouteId", "BeginPoint", "EndPoint", "ValueNumeric"]
    )
    lanes = lanes.rename(columns={"RouteId": "route_id", "BeginPoint": "l_begin", "EndPoint": "l_end", "ValueNumeric": "lanes"})
    probe = pd.DataFrame({"route_id": sections["route_id"], "mid": (sections["begin_mp"] + sections["end_mp"]) / 2})
    probe["_order"] = np.arange(len(probe))
    probe = probe.sort_values("mid")
    lanes = lanes.sort_values("l_begin")
    joined = pd.merge_asof(probe, lanes, left_on="mid", right_on="l_begin", by="route_id", direction="backward")
    joined.loc[joined["mid"] > joined["l_end"], "lanes"] = np.nan
    return joined.sort_values("_order")["lanes"].to_numpy()


def build_roads() -> gpd.GeoDataFrame:
    if not GDB.exists():
        raise FileNotFoundError(f"GDOT road inventory not found at {GDB}. See docs/DATA_SETUP.md.")
    fs = pyogrio.read_dataframe(GDB, layer="F_SYSTEM", columns=["RouteId", "BeginPoint", "EndPoint", "ValueNumeric"])
    fs = fs.rename(columns={"RouteId": "route_id", "BeginPoint": "begin_mp", "EndPoint": "end_mp", "ValueNumeric": "f_system"})
    print(f"F_SYSTEM sections read: {len(fs):,}")

    # Geometry hygiene: drop Z/M, repair invalid shapes, discard empties.
    geom = shapely.force_2d(fs.geometry.values)
    invalid = ~shapely.is_valid(geom)
    if invalid.any():
        geom[invalid] = shapely.make_valid(geom[invalid])
    fs = fs.set_geometry(gpd.GeoSeries(geom, crs=fs.crs))
    empty = fs.geometry.isna() | fs.geometry.is_empty
    print(f"  repaired {int(invalid.sum()):,} invalid geometries; dropped {int(empty.sum()):,} empty")
    fs = fs[~empty].copy()

    decoded = decode_route_id(fs["route_id"])
    fs = pd.concat([fs.reset_index(drop=True), decoded.reset_index(drop=True)], axis=1)
    fs["f_system"] = pd.to_numeric(fs["f_system"], errors="coerce").astype("Int8")

    keep = fs["function_type"].isin(list(KEPT_FUNCTION_TYPES)) & fs["system_code"].isin(["1", "2"])
    print(f"  excluded {int((~keep).sum()):,} sections (alleys, private, federal, projected, other)")
    fs = fs[keep].copy()
    fs["role"] = assign_role(fs["function_type"], fs["f_system"])
    fs["lanes"] = pd.array(_lanes_lookup(fs), dtype="Float32")

    roads = gpd.GeoDataFrame(fs, geometry="geometry", crs=fs.crs).to_crs(ANALYSIS_CRS)
    roads = roads.explode(index_parts=False, ignore_index=True)
    roads = roads[roads.geometry.length > 0.5].reset_index(drop=True)
    roads["road_id"] = [f"r{i:06d}" for i in range(len(roads))]
    ROADS_TABLE.parent.mkdir(parents=True, exist_ok=True)
    roads.to_parquet(ROADS_TABLE, index=False)
    print(f"roads written: {len(roads):,} line parts")
    print(roads["role"].value_counts().to_string())
    return roads


def load_roads() -> gpd.GeoDataFrame:
    if not ROADS_TABLE.exists():
        return build_roads()
    return gpd.read_parquet(ROADS_TABLE)


if __name__ == "__main__":
    build_roads()
