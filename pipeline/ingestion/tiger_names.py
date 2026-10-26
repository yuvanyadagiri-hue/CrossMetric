"""Road names from Census TIGERweb, fetched only where schools are.

GDOT's road inventory has no street names, so names are conflated from TIGER
(see pipeline/geospatial/naming.py). Tiles of 0.05 degrees (~5 km) that touch
any school's analysis area are requested from three TIGERweb layers; each tile
response is cached so the step is resumable.

    python -m pipeline.ingestion.tiger_names
"""

from __future__ import annotations

import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import box

from pipeline.config import ANALYSIS_CRS, INTERIM, MAX_RADIUS_M, NETWORK_MARGIN_M, RAW
from pipeline.ingestion.schools import load_schools
from pipeline.sources.arcgis import USER_AGENT, ArcGISLayer, esri_geometry_to_shapely
from pipeline.sources.catalog import TIGER_ROADS

TILE_DEG = 0.05
CACHE = RAW / "tiger_tiles"
NAMES_TABLE = INTERIM / "tiger_roads.parquet"


def school_tiles() -> list[tuple[int, int]]:
    schools = load_schools().to_crs(ANALYSIS_CRS)
    areas = schools.buffer(MAX_RADIUS_M + NETWORK_MARGIN_M + 50).to_crs(4326)
    tiles: set[tuple[int, int]] = set()
    for minx, miny, maxx, maxy in areas.bounds.itertuples(index=False):
        for ix in range(math.floor(minx / TILE_DEG), math.floor(maxx / TILE_DEG) + 1):
            for iy in range(math.floor(miny / TILE_DEG), math.floor(maxy / TILE_DEG) + 1):
                tiles.add((ix, iy))
    return sorted(tiles)


def _fetch_tile(session: requests.Session, spec, ix: int, iy: int) -> Path:
    out = CACHE / spec.key / f"{ix}_{iy}.json"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    env = {
        "xmin": ix * TILE_DEG, "ymin": iy * TILE_DEG,
        "xmax": (ix + 1) * TILE_DEG, "ymax": (iy + 1) * TILE_DEG,
        "spatialReference": {"wkid": 4326},
    }
    params = {
        "where": "1=1",
        "geometry": json.dumps(env),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "OBJECTID,NAME,MTFCC,RTTYP",
        "returnGeometry": "true",
        "outSR": 4326,
        "f": "json",
    }
    last = None
    for attempt in range(5):
        try:
            resp = session.post(f"{spec.url}/query", data=params, timeout=180)
            resp.raise_for_status()
            payload = resp.json()
            if "error" in payload:
                raise RuntimeError(payload["error"])
            if payload.get("exceededTransferLimit"):
                raise RuntimeError(f"tile {ix},{iy} exceeded transfer limit")
            out.write_text(json.dumps(payload.get("features", [])), encoding="utf-8")
            return out
        except Exception as exc:  # retried below
            last = exc
    raise RuntimeError(f"{spec.key} tile {ix},{iy} failed: {last}")


def fetch_all(workers: int = 6) -> None:
    for spec in TIGER_ROADS:
        print(ArcGISLayer(spec).validate_schema(strict=True).describe())
    tiles = school_tiles()
    jobs = [(spec, ix, iy) for spec in TIGER_ROADS for ix, iy in tiles]
    print(f"{len(tiles)} tiles x {len(TIGER_ROADS)} layers = {len(jobs)} requests")
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_fetch_tile, session, spec, ix, iy) for spec, ix, iy in jobs]
        for fut in as_completed(futures):
            fut.result()
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(jobs)} tiles", flush=True)


def assemble() -> gpd.GeoDataFrame:
    frames = []
    for spec in TIGER_ROADS:
        rows, geoms = [], []
        for f in sorted((CACHE / spec.key).glob("*.json")):
            for feat in json.loads(f.read_text(encoding="utf-8")):
                rows.append(feat["attributes"])
                geoms.append(esri_geometry_to_shapely(feat.get("geometry")))
        gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs=4326)
        gdf["layer"] = spec.key
        frames.append(gdf)
    roads = pd.concat(frames, ignore_index=True)
    roads = gpd.GeoDataFrame(roads, geometry="geometry", crs=4326)
    roads = roads[roads.geometry.notna() & roads["NAME"].notna() & (roads["NAME"].str.strip() != "")]
    # The same TIGER edge appears in every tile it touches.
    roads = roads.drop_duplicates(subset=["layer", "OBJECTID"])
    roads = roads.rename(columns={"NAME": "name", "MTFCC": "mtfcc", "RTTYP": "rttyp", "OBJECTID": "tiger_oid"})
    roads = roads.to_crs(ANALYSIS_CRS)
    roads[["tiger_oid", "name", "mtfcc", "rttyp", "layer", "geometry"]].to_parquet(NAMES_TABLE, index=False)
    print(f"TIGER named road features: {len(roads):,}")
    return roads


def load_tiger_roads() -> gpd.GeoDataFrame:
    if not NAMES_TABLE.exists():
        fetch_all()
        return assemble()
    return gpd.read_parquet(NAMES_TABLE)


if __name__ == "__main__":
    fetch_all()
    assemble()
