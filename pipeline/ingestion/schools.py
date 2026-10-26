"""Georgia public schools from NCES EDGE (locations) + CCD (administrative data).

Locations come from the EDGE geocode layer; district name, school level,
status and the VIRTUAL flag come from the administrative layer. The two are
joined on the 12-digit NCES school ID (NCESSCH).
"""

from __future__ import annotations

from typing import Any

import geopandas as gpd
import pandas as pd

from pipeline.config import GEORGIA_BOUNDS, INTERIM, RAW
from pipeline.sources.arcgis import ArcGISLayer
from pipeline.sources.catalog import NCES_SCHOOL_ADMIN, NCES_SCHOOL_LOCATIONS

SCHOOLS_TABLE = INTERIM / "schools.parquet"
QUARANTINE_TABLE = INTERIM / "schools_quarantine.parquet"

# School is excluded when its CCD status says it is not operating.
INACTIVE_STATUSES = {"Closed", "Inactive", "Future", "Changed Agency"}


def _fetch(spec, where: str, cache_name: str) -> pd.DataFrame:
    layer = ArcGISLayer(spec)
    print(layer.validate_schema(strict=True).describe())
    rows: list[dict[str, Any]] = []
    for page in layer.iter_pages(where=where, out_sr=4326, cache_dir=RAW / cache_name, progress=False):
        for feature in page:
            attrs = dict(feature["attributes"])
            geom = feature.get("geometry") or {}
            attrs["_lon"] = geom.get("x")
            attrs["_lat"] = geom.get("y")
            rows.append(attrs)
    return pd.DataFrame(rows)


def build_schools() -> tuple[gpd.GeoDataFrame, pd.DataFrame]:
    loc = _fetch(NCES_SCHOOL_LOCATIONS, "STATE = 'GA'", "nces_locations_2425")
    admin = _fetch(NCES_SCHOOL_ADMIN, "LSTATE = 'GA'", "nces_admin_2425")
    print(f"NCES: {len(loc):,} GA location records, {len(admin):,} GA admin records")

    admin = admin.drop_duplicates("NCESSCH")
    merged = loc.merge(
        admin[["NCESSCH", "LEA_NAME", "GSLO", "GSHI", "SCHOOL_LEVEL", "SCHOOL_TYPE_TEXT",
               "SY_STATUS_TEXT", "CHARTER_TEXT", "VIRTUAL"]],
        on="NCESSCH",
        how="left",
        validate="one_to_one",
    )
    schools = pd.DataFrame(
        {
            "school_id": merged["NCESSCH"].astype("string"),
            "name": merged["NAME"].astype("string").str.strip(),
            "district": merged["LEA_NAME"].astype("string"),
            "district_id": merged["LEAID"].astype("string"),
            "street": merged["STREET"].astype("string"),
            "city": merged["CITY"].astype("string"),
            "zip": merged["ZIP"].astype("string"),
            "county": merged["NMCNTY"].astype("string"),
            "level": merged["SCHOOL_LEVEL"].astype("string"),
            "grade_low": merged["GSLO"].astype("string"),
            "grade_high": merged["GSHI"].astype("string"),
            "school_type": merged["SCHOOL_TYPE_TEXT"].astype("string"),
            "status": merged["SY_STATUS_TEXT"].astype("string"),
            "charter": merged["CHARTER_TEXT"].astype("string"),
            "virtual": merged["VIRTUAL"].astype("string"),
            "locale": merged["LOCALE"].astype("string"),
            "school_year": merged["SCHOOLYEAR"].astype("string"),
            # Geometry returned by the service is authoritative; LAT/LON
            # attributes are used only as a fallback.
            "lon": pd.to_numeric(merged["_lon"], errors="coerce").fillna(merged["LON"]),
            "lat": pd.to_numeric(merged["_lat"], errors="coerce").fillna(merged["LAT"]),
        }
    )

    reasons = pd.Series("", index=schools.index, dtype="string")
    minx, miny, maxx, maxy = GEORGIA_BOUNDS
    bad_coord = (
        schools["lon"].isna() | schools["lat"].isna()
        | ~schools["lon"].between(minx, maxx) | ~schools["lat"].between(miny, maxy)
    )
    reasons[bad_coord] = "coordinates missing or outside Georgia"
    # A full-time virtual school has no campus whose surrounding roads matter.
    is_virtual = schools["virtual"].fillna("").str.contains("Full Virtual|Exclusively virtual", case=False, regex=True)
    reasons[(reasons == "") & is_virtual] = "full-time virtual school (no physical campus)"
    inactive = schools["status"].isin(INACTIVE_STATUSES)
    reasons[(reasons == "") & inactive] = "school not operating in 2024-25"
    dup = schools.duplicated("school_id", keep="first")
    reasons[(reasons == "") & dup] = "duplicate NCES school id"

    quarantine = schools[reasons != ""].assign(reason=reasons[reasons != ""])
    keep = schools[reasons == ""].copy()
    gdf = gpd.GeoDataFrame(keep, geometry=gpd.points_from_xy(keep["lon"], keep["lat"]), crs=4326)
    INTERIM.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(SCHOOLS_TABLE, index=False)
    quarantine.to_parquet(QUARANTINE_TABLE, index=False)
    print(f"schools kept: {len(gdf):,}; quarantined: {len(quarantine):,}")
    if len(quarantine):
        print(quarantine["reason"].value_counts().to_string())
    return gdf, quarantine


def load_schools() -> gpd.GeoDataFrame:
    if not SCHOOLS_TABLE.exists():
        return build_schools()[0]
    return gpd.read_parquet(SCHOOLS_TABLE)


if __name__ == "__main__":
    gdf, q = build_schools()
    print(gdf[["name", "district", "city", "level", "virtual", "status"]].head(10).to_string())
    print(gdf["level"].value_counts(dropna=False).to_string())
    print(gdf["virtual"].value_counts(dropna=False).to_string())
