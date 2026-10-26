"""Harvest GDOT crash records and map them onto CrossMetric's crash model.

Run directly to (re)build the raw crash table:

    python -m pipeline.ingestion.crashes

Pages are cached under data/raw/gdot_crashes/ so an interrupted harvest
resumes where it stopped.
"""

from __future__ import annotations

import sys
from typing import Any

import pandas as pd

from pipeline.config import INTERIM, RAW
from pipeline.sources.arcgis import ArcGISLayer
from pipeline.sources.catalog import GDOT_CRASHES

RAW_TABLE = INTERIM / "crashes_raw.parquet"
PAGE_CACHE = RAW / "gdot_crashes"

PEDESTRIAN_UNIT = "00-Pedestrian"
BICYCLE_UNIT = "19-Pedacycle, Bicycle"

# GDOT LIGHT_CONDITION codes -> CrossMetric light categories.
LIGHT_CATEGORIES = {
    "01-Daylight": "daylight",
    "02-Dusk": "dusk",
    "03-Dawn": "dawn",
    "04-DarkLighted": "dark_lighted",
    "05-DarkNot Lighted": "dark_unlighted",
}
LOW_LIGHT = {"dusk", "dawn", "dark_lighted", "dark_unlighted"}


def harvest() -> pd.DataFrame:
    layer = ArcGISLayer(GDOT_CRASHES)
    report = layer.validate_schema(strict=True)
    print(report.describe())
    rows: list[dict[str, Any]] = []
    for page in layer.iter_pages(cache_dir=PAGE_CACHE):
        for feature in page:
            attrs = feature["attributes"]
            geom = feature.get("geometry") or {}
            attrs["_geom_x"] = geom.get("x")
            attrs["_geom_y"] = geom.get("y")
            rows.append(attrs)
    raw = pd.DataFrame(rows)
    RAW_TABLE.parent.mkdir(parents=True, exist_ok=True)
    raw.to_parquet(RAW_TABLE, index=False)
    print(f"wrote {len(raw):,} raw crash rows -> {RAW_TABLE}")
    return raw


def _either(df: pd.DataFrame, value: str) -> pd.Series:
    return (df["VEHICLE_TYPE1"] == value) | (df["VEHICLE_TYPE2"] == value)


def normalize(raw: pd.DataFrame) -> pd.DataFrame:
    """Adapter: GDOT field names -> internal crash model.

    Two GDOT fields are deliberately NOT used as published:

    * ``PEDESTRIAN`` is '1' on 99.2% of all crashes, so it cannot mean
      "pedestrian involved". Pedestrian involvement is derived from the unit
      types instead: a crash is pedestrian-involved when either recorded unit
      is '00-Pedestrian'. Because the public layer exposes only two units, this
      is a conservative lower bound.
    * ``X``/``Y`` are kept only to cross-check the returned geometry.
    """
    out = pd.DataFrame(
        {
            "source_oid": raw["OBJECTID"].astype("int64"),
            "crash_id": raw["ACCIDENT_ID"].astype("Int64").astype("string"),
            "crash_ts": pd.to_datetime(raw["ACCIDENT_DATE"], unit="ms", utc=True, errors="coerce"),
            "fatalities": pd.to_numeric(raw["FATALITIES"], errors="coerce").astype("Int16"),
            "injuries": pd.to_numeric(raw["INJURIES"], errors="coerce").astype("Int16"),
            "vehicles": pd.to_numeric(raw["VEHICLES"], errors="coerce").astype("Int16"),
            "pedestrian": _either(raw, PEDESTRIAN_UNIT),
            "bicyclist": _either(raw, BICYCLE_UNIT),
            "light": raw["LIGHT_CONDITION"].map(LIGHT_CATEGORIES).fillna("unknown"),
            "location_of_impact": raw["LOCATION_OF_IMPACT"].astype("string"),
            "collision_type": raw["COLLISION_TYPE"].astype("string"),
            "geometry_source": raw["GEOMETRY_SOURCE"].astype("string"),
            "county": raw["COUNTY_NAME"].astype("string"),
            "lon": pd.to_numeric(raw["_geom_x"], errors="coerce"),
            "lat": pd.to_numeric(raw["_geom_y"], errors="coerce"),
            "attr_x": pd.to_numeric(raw["X"], errors="coerce"),
            "attr_y": pd.to_numeric(raw["Y"], errors="coerce"),
            "gdot_pedestrian_flag": raw["PEDESTRIAN"].astype("string"),
        }
    )
    injuries = out["injuries"].fillna(0)
    fatalities = out["fatalities"].fillna(0)
    out["injury_or_fatal"] = (injuries > 0) | (fatalities > 0)
    out["fatal"] = fatalities > 0
    out["low_light"] = out["light"].isin(LOW_LIGHT)
    out["crash_date"] = out["crash_ts"].dt.tz_convert("America/New_York").dt.date
    return out


def load_raw() -> pd.DataFrame:
    if not RAW_TABLE.exists():
        return harvest()
    return pd.read_parquet(RAW_TABLE)


if __name__ == "__main__":
    df = harvest()
    norm = normalize(df)
    print(norm.describe(include="all").T.head(30))
    sys.exit(0)
