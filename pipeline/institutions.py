"""Analysis packages for Georgia colleges and universities.

Colleges use exactly the same candidate builder, crash association and
package format as K-12 schools (pipeline/run.py). They are built in their own
pass, over their own regions, so adding colleges never changes a K-12
school's candidates, crash assignments or rankings.

    python -m pipeline.institutions            # build + publish
    python -m pipeline.institutions --publish-only

Outputs:
    data/interim/college_candidates.parquet
    data/interim/college_crash_assignments.parquet
    data/published/colleges.json                 search index (same row format as index.json)
    data/published/colleges/<UNITID>.json        one package per institution
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import date, datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.strtree import STRtree

from pipeline.config import ANALYSIS_CRS, INTERIM, MAX_RADIUS_M, PUBLISHED
from pipeline.geospatial.association import UNASSIGNED_REASONS, associate
from pipeline.geospatial.candidates import Context, build_regions, process_region
from pipeline.geospatial.naming import Namer
from pipeline.geospatial.traffic import TrafficIndex
from pipeline.ingestion.colleges import load_colleges
from pipeline.ingestion.reference_layers import AADT_TABLE, SIGNALS_TABLE
from pipeline.ingestion.roads import load_roads
from pipeline.ingestion.tiger_names import load_tiger_roads
from pipeline.publish.package import _clean as clean_value, build_package, write_json
from pipeline.run import BUILD_SUMMARY, CRASHES_CLEAN_TABLE, log
from pipeline.scoring.model import load_model

CANDIDATES_TABLE = INTERIM / "college_candidates.parquet"
ASSIGNMENTS_TABLE = INTERIM / "college_crash_assignments.parquet"
INDEX_FILE = PUBLISHED / "colleges.json"
PACKAGE_DIR = PUBLISHED / "colleges"


def _crash_points(clean: pd.DataFrame) -> np.ndarray:
    return gpd.GeoSeries(gpd.points_from_xy(clean["lon"], clean["lat"]), crs=4326).to_crs(ANALYSIS_CRS).values


def build() -> None:
    t0 = time.time()
    colleges = load_colleges()
    colleges_ac = colleges.to_crs(ANALYSIS_CRS)
    roads = load_roads()
    tiger = load_tiger_roads()
    aadt = gpd.read_parquet(AADT_TABLE).to_crs(ANALYSIS_CRS)
    signals = gpd.read_parquet(SIGNALS_TABLE)
    signals = signals[signals["status"] != "Out of Service"].to_crs(ANALYSIS_CRS)
    clean = pd.read_parquet(CRASHES_CLEAN_TABLE, columns=["source_oid", "crash_id", "lon", "lat"])
    crash_geoms = _crash_points(clean)
    crash_tree = STRtree(crash_geoms)
    log(f"inputs: {len(colleges):,} colleges, {len(clean):,} clean crashes", t0)

    regions = build_regions(colleges_ac)
    regions.sort(key=lambda g: -g.area)
    roads_tree = STRtree(roads.geometry.values)
    tiger_tree = STRtree(tiger.geometry.values)
    signals_tree = STRtree(signals.geometry.values)
    traffic = TrafficIndex(aadt)
    log(f"{len(regions):,} college analysis regions", t0)

    assignment = np.full(len(clean), "", dtype=object)
    status = np.full(len(clean), "outside_college_areas", dtype=object)
    frames = []
    for i, region in enumerate(regions, start=1):
        tiger_sub = tiger.iloc[tiger_tree.query(region.buffer(100), predicate="intersects")]
        ctx = Context(roads=roads, roads_tree=roads_tree, namer=Namer(tiger_sub), traffic=traffic, signals_tree=signals_tree)
        region_roads, ints, segs = process_region(ctx, region)
        idx = crash_tree.query(region, predicate="intersects")
        cid, st = associate(crash_geoms[idx], region_roads, ints, segs)
        assignment[idx], status[idx] = cid, st
        frames.extend(f for f in (ints, segs) if len(f))
        log(f"region {i}/{len(regions)}: {len(ints):,} intersections, {len(segs):,} segments, {len(idx):,} crashes", t0)

    candidates = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs=ANALYSIS_CRS)
    candidates = candidates[~candidates.duplicated("candidate_id")].reset_index(drop=True)
    INTERIM.mkdir(parents=True, exist_ok=True)
    candidates.to_parquet(CANDIDATES_TABLE, index=False)
    pd.DataFrame({"source_oid": clean["source_oid"], "candidate_id": assignment, "association": status}).to_parquet(
        ASSIGNMENTS_TABLE, index=False
    )
    log(f"college candidates: {len(candidates):,}", t0)


def publish() -> None:
    t0 = time.time()
    model = load_model()
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    summary = json.loads(BUILD_SUMMARY.read_text(encoding="utf-8"))
    window_start = date.fromisoformat(summary["windowStart"])
    window_end = date.fromisoformat(summary["windowEnd"])
    colleges = load_colleges()
    colleges_ac = colleges.to_crs(ANALYSIS_CRS)
    candidates = gpd.read_parquet(CANDIDATES_TABLE)
    candidates["geometry_wgs84"] = candidates.geometry.to_crs(4326).values
    clean = pd.read_parquet(CRASHES_CLEAN_TABLE).drop(columns=["candidate_id", "association"])
    assignments = pd.read_parquet(ASSIGNMENTS_TABLE)
    clean = clean.merge(assignments, on="source_oid", how="left", validate="one_to_one")
    status = clean["association"].to_numpy()
    crash_tree = STRtree(_crash_points(clean))
    cand_tree = STRtree(candidates.geometry.values)
    assigned = clean[clean["candidate_id"] != ""]
    by_candidate = {k: v for k, v in assigned.groupby("candidate_id")}

    rows = []
    total = 0
    for s, geom in zip(colleges.itertuples(index=False), colleges_ac.geometry.values):
        s_series = pd.Series(s._asdict())
        idx = cand_tree.query(geom, predicate="dwithin", distance=MAX_RADIUS_M)
        cands = candidates.iloc[idx]
        dist = shapely.distance(cands.geometry.values, geom)
        near = crash_tree.query(geom, predicate="dwithin", distance=MAX_RADIUS_M)
        quality = {k: 0 for k in ["assigned", *UNASSIGNED_REASONS.keys()]}
        for k, v in pd.Series(status[near]).value_counts().items():
            if k in quality:
                quality[k] = int(v)
        quality["recordedNearby"] = int(len(near))
        cids = set(cands["candidate_id"])
        parts = [by_candidate[c] for c in cids if c in by_candidate]
        crashes = pd.concat(parts) if parts else clean.iloc[0:0]
        pkg = build_package(s_series, cands, dist, crashes, window_start, window_end, quality, model["version"], generated_at)
        pkg["school"]["institutionType"] = "college"
        pkg["school"]["website"] = clean_value(s.website) or None
        total += write_json(PACKAGE_DIR / f"{s.school_id}.json", pkg)
        rows.append([
            s.school_id, s.name, clean_value(s.city), clean_value(s.district), clean_value(s.level),
            round(float(s.lon), 6), round(float(s.lat), 6), int((dist <= 800).sum()), int(len(crashes)),
        ])
    write_json(INDEX_FILE, {
        "generatedAt": generated_at,
        "modelVersion": model["version"],
        "window": {"start": window_start.isoformat(), "end": window_end.isoformat()},
        "fields": ["id", "name", "city", "district", "level", "lon", "lat", "candidates800", "crashes1200"],
        "source": "IPEDS Institutional Characteristics (HD) 2024-25, National Center for Education Statistics",
        "schools": rows,
        "aliases": {s.school_id: s.alias for s in colleges.itertuples(index=False) if isinstance(s.alias, str) and s.alias},
    })
    log(f"published {len(rows):,} college packages ({total / 1e6:.1f} MB)", t0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish-only", action="store_true")
    args = ap.parse_args()
    if not args.publish_only:
        build()
    publish()
