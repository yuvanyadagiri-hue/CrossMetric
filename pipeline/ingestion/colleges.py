"""Georgia colleges and universities from IPEDS (NCES) Institutional Characteristics.

Source: the IPEDS "HD" (directory) file for 2024-25, which carries each
institution's UNITID, name, address, sector and geocoded coordinates.

Kept: active (CYACTIVE = 1), degree-granting (DEGGRANT = 1) institutions in
Georgia in sectors 1-6 (public, private nonprofit and private for-profit,
4-year and 2-year). Administrative offices (sector 0) and non-degree
institutions (sectors 7-9) are excluded because they are not campuses that
students travel to for a degree program.

    python -m pipeline.ingestion.colleges
"""

from __future__ import annotations

import io
import zipfile

import geopandas as gpd
import pandas as pd
import requests

from pipeline.config import GEORGIA_BOUNDS, INTERIM, RAW

HD_URL = "https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip"
HD_ZIP = RAW / "ipeds" / "HD2024.zip"
COLLEGES_TABLE = INTERIM / "colleges.parquet"
SCHOOL_YEAR = "2024-25"

SECTORS = {
    "1": "Public, 4-year or above",
    "2": "Private nonprofit, 4-year or above",
    "3": "Private for-profit, 4-year or above",
    "4": "Public, 2-year",
    "5": "Private nonprofit, 2-year",
    "6": "Private for-profit, 2-year",
}


def _read_hd() -> pd.DataFrame:
    if not HD_ZIP.exists():
        HD_ZIP.parent.mkdir(parents=True, exist_ok=True)
        resp = requests.get(HD_URL, timeout=120, headers={"User-Agent": "CrossMetric data pipeline"})
        resp.raise_for_status()
        HD_ZIP.write_bytes(resp.content)
    with zipfile.ZipFile(HD_ZIP) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        raw = zf.read(name)
    # The file is UTF-8 with a byte-order mark on most releases, Latin-1 on some.
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(raw), dtype=str, encoding=encoding, keep_default_na=False)
        except UnicodeDecodeError:
            continue
    raise ValueError("IPEDS HD file could not be decoded")


def build_colleges() -> gpd.GeoDataFrame:
    hd = _read_hd()
    ga = hd[hd["STABBR"] == "GA"]
    keep = ga[(ga["CYACTIVE"] == "1") & (ga["DEGGRANT"] == "1") & ga["SECTOR"].isin(list(SECTORS))].copy()
    lon = pd.to_numeric(keep["LONGITUD"], errors="coerce")
    lat = pd.to_numeric(keep["LATITUDE"], errors="coerce")
    minx, miny, maxx, maxy = GEORGIA_BOUNDS
    ok = lon.between(minx, maxx) & lat.between(miny, maxy)
    dropped = keep[~ok]
    if len(dropped):
        print(f"dropped {len(dropped)} institutions without usable coordinates: {dropped['INSTNM'].tolist()}")
    keep, lon, lat = keep[ok], lon[ok], lat[ok]
    four_year = keep["SECTOR"].isin(["1", "2", "3"])
    colleges = pd.DataFrame(
        {
            "school_id": keep["UNITID"].str.strip(),
            "name": keep["INSTNM"].str.strip(),
            # Common names people search for, e.g. "Georgia Tech" (IPEDS IALIAS; may list several, separated by | or ,).
            "alias": keep["IALIAS"].str.strip().replace({"": None}),
            # The "district" slot carries the governing system (e.g. University System of Georgia).
            "district": keep["F1SYSNAM"].str.strip().replace({"-2": None, "-1": None, "": None}),
            "street": keep["ADDR"].str.strip(),
            "city": keep["CITY"].str.strip(),
            "zip": keep["ZIP"].str.slice(0, 5),
            "county": keep["COUNTYNM"].str.replace(r"\s+County$", "", regex=True).str.strip(),
            "level": four_year.map({True: "University or 4-year college", False: "2-year college"}),
            "grade_low": None,
            "grade_high": None,
            "school_type": keep["SECTOR"].map(SECTORS),
            "school_year": SCHOOL_YEAR,
            "website": keep["WEBADDR"].str.strip(),
            "hbcu": keep["HBCU"] == "1",
            "lon": lon.round(6),
            "lat": lat.round(6),
        }
    ).reset_index(drop=True)
    gdf = gpd.GeoDataFrame(colleges, geometry=gpd.points_from_xy(colleges["lon"], colleges["lat"]), crs=4326)
    INTERIM.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(COLLEGES_TABLE, index=False)
    print(f"colleges kept: {len(gdf):,} of {len(ga):,} Georgia IPEDS records")
    print(gdf["school_type"].value_counts().to_string())
    return gdf


def load_colleges() -> gpd.GeoDataFrame:
    if not COLLEGES_TABLE.exists():
        return build_colleges()
    return gpd.read_parquet(COLLEGES_TABLE)


if __name__ == "__main__":
    build_colleges()
