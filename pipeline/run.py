"""CrossMetric pipeline entry point.

    python -m pipeline.run            # full statewide build
    python -m pipeline.run --limit 25 # quick build for the first 25 schools (development)

Inputs are fetched (or read from cache) by the ingestion modules. Outputs:

    data/interim/candidates.parquet        every candidate location (analysis CRS)
    data/interim/crash_assignments.parquet crash -> candidate / exclusion reason
    data/published/index.json              school search index
    data/published/schools/<NCESSCH>.json  one analysis package per school
    data/published/meta.json               sources, window, model version, quality report
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
from dateutil.relativedelta import relativedelta
from shapely.strtree import STRtree

from pipeline.cleaning.crashes import RULE_DESCRIPTIONS, split_clean
from pipeline.config import ANALYSIS_CRS, INTERIM, MAX_RADIUS_M, PUBLISHED
from pipeline.geospatial.association import UNASSIGNED_REASONS, associate
from pipeline.geospatial.candidates import Context, build_regions, process_region
from pipeline.geospatial.naming import Namer
from pipeline.geospatial.traffic import TrafficIndex
from pipeline.ingestion import crashes as crash_ingest
from pipeline.ingestion.reference_layers import AADT_TABLE, HIN_TABLE, SIGNALS_TABLE, STATIONS_TABLE
from pipeline.ingestion.roads import load_roads
from pipeline.ingestion.schools import QUARANTINE_TABLE, load_schools
from pipeline.ingestion.tiger_names import load_tiger_roads
from pipeline.publish.package import COLLISION_LABELS, LIGHT_LABELS, _clean as clean_value, build_package, write_json
from pipeline.scoring.model import load_model
from pipeline.sources import catalog

WINDOW_MONTHS = 36

CANDIDATES_TABLE = INTERIM / "candidates.parquet"
ASSIGNMENTS_TABLE = INTERIM / "crash_assignments.parquet"
CRASHES_CLEAN_TABLE = INTERIM / "crashes_clean.parquet"
QUARANTINE_CRASHES_TABLE = INTERIM / "crashes_quarantine.parquet"
BUILD_SUMMARY = INTERIM / "build_summary.json"


def log(msg: str, t0: float) -> None:
    print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)


def snapshot_date() -> date:
    """The day the crash data was retrieved (any later 'crash date' is an error)."""
    ts = crash_ingest.RAW_TABLE.stat().st_mtime
    return datetime.fromtimestamp(ts).date()


def analysis_window(clean: pd.DataFrame) -> tuple[date, date]:
    """Analysis window = up to 36 months ending on the last *complete* month.

    GDOT loads crash reports with a lag, so the newest month can hold only a
    handful of records (2026-09 had 23 vs ~30,000 in a normal month). A month
    counts as complete when it holds at least half the median monthly volume.
    The window never starts before the first crash the layer provides.
    """
    months = pd.to_datetime(clean["crash_date"]).dt.to_period("M").value_counts().sort_index()
    complete = months[months >= 0.5 * months.median()]
    last = complete.index.max()
    window_end = last.to_timestamp(how="end").date()
    first_day = min(d for d in clean["crash_date"] if d is not None)
    window_start = max(window_end - relativedelta(months=WINDOW_MONTHS) + relativedelta(days=1), first_day)
    return window_start, window_end


def build(limit: int | None = None) -> None:
    """Expensive stage: clean crashes, build candidates, associate crashes. Writes data/interim."""
    t0 = time.time()
    schools = load_schools()
    if limit:
        schools = schools.head(limit)
    schools_ac = schools.to_crs(ANALYSIS_CRS)
    roads = load_roads()
    tiger = load_tiger_roads()
    aadt = gpd.read_parquet(AADT_TABLE).to_crs(ANALYSIS_CRS)
    signals = gpd.read_parquet(SIGNALS_TABLE)
    signals = signals[signals["status"] != "Out of Service"].to_crs(ANALYSIS_CRS)
    log(f"inputs: {len(schools):,} schools, {len(roads):,} road sections, {len(tiger):,} TIGER names, "
        f"{len(aadt):,} AADT segments, {len(signals):,} active signals", t0)

    snapshot = snapshot_date()
    crashes = crash_ingest.normalize(crash_ingest.load_raw())
    clean, quarantined, cleaning = split_clean(crashes, snapshot)
    window_start, window_end = analysis_window(clean)
    dates = pd.to_datetime(clean["crash_date"])
    in_window = (dates >= pd.Timestamp(window_start)) & (dates <= pd.Timestamp(window_end))
    outside_window = int((~in_window).sum())
    clean = clean[in_window].reset_index(drop=True)
    log(f"crashes: {len(crashes):,} raw -> {len(clean):,} clean in window {window_start}..{window_end} "
        f"({len(quarantined):,} quarantined, {outside_window:,} outside window)", t0)
    print(cleaning.to_string(index=False))

    crash_geoms = gpd.GeoSeries(gpd.points_from_xy(clean["lon"], clean["lat"]), crs=4326).to_crs(ANALYSIS_CRS).values
    crash_tree = STRtree(crash_geoms)

    regions = build_regions(schools_ac)
    regions.sort(key=lambda g: -g.area)
    log(f"{len(regions):,} analysis regions (overlapping school areas merged)", t0)
    roads_tree = STRtree(roads.geometry.values)
    tiger_tree = STRtree(tiger.geometry.values)
    signals_tree = STRtree(signals.geometry.values)
    traffic = TrafficIndex(aadt)

    assignment = np.full(len(clean), "", dtype=object)
    status = np.full(len(clean), "outside_school_areas", dtype=object)
    frames = []
    for i, region in enumerate(regions, start=1):
        t_region = time.time()
        tiger_sub = tiger.iloc[tiger_tree.query(region.buffer(100), predicate="intersects")]
        ctx = Context(roads=roads, roads_tree=roads_tree, namer=Namer(tiger_sub), traffic=traffic, signals_tree=signals_tree)
        region_roads, ints, segs = process_region(ctx, region)
        idx = crash_tree.query(region, predicate="intersects")
        cid, st = associate(crash_geoms[idx], region_roads, ints, segs)
        assignment[idx], status[idx] = cid, st
        frames.extend(f for f in (ints, segs) if len(f))
        if i <= 5 or i % 100 == 0:
            log(f"region {i}/{len(regions)}: {len(ints):,} intersections, {len(segs):,} segments, "
                f"{len(idx):,} crashes ({time.time() - t_region:.1f}s)", t0)

    candidates = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs=ANALYSIS_CRS)
    dup = candidates.duplicated("candidate_id")
    if dup.any():
        log(f"WARNING: {int(dup.sum())} duplicate candidate ids dropped", t0)
        candidates = candidates[~dup].reset_index(drop=True)
    clean["candidate_id"] = assignment
    clean["association"] = status
    log(f"candidates: {len(candidates):,} ({(candidates['kind'] == 'intersection').sum():,} intersections); "
        f"crash association: {pd.Series(status).value_counts().to_dict()}", t0)

    INTERIM.mkdir(parents=True, exist_ok=True)
    candidates.to_parquet(CANDIDATES_TABLE, index=False)
    clean.drop(columns=["crash_ts"]).to_parquet(CRASHES_CLEAN_TABLE, index=False)
    clean[["source_oid", "crash_id", "candidate_id", "association"]].to_parquet(ASSIGNMENTS_TABLE, index=False)
    quarantined.drop(columns=["crash_ts"]).to_parquet(QUARANTINE_CRASHES_TABLE, index=False)
    BUILD_SUMMARY.write_text(json.dumps({
        "snapshot": snapshot.isoformat(),
        "windowStart": window_start.isoformat(),
        "windowEnd": window_end.isoformat(),
        "rawCrashes": int(len(crashes)),
        "outsideWindow": outside_window,
        "cleaning": [{**r, "records": int(r["records"])} for r in cleaning.to_dict(orient="records")],
        "limit": limit,
    }, indent=2), encoding="utf-8")
    log("build stage complete", t0)


def publish(limit: int | None = None) -> None:
    """Cheap stage: write per-school packages, the search index and meta.json from data/interim."""
    t0 = time.time()
    model = load_model()
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    summary = json.loads(BUILD_SUMMARY.read_text(encoding="utf-8"))
    window_start = date.fromisoformat(summary["windowStart"])
    window_end = date.fromisoformat(summary["windowEnd"])
    schools = load_schools()
    if limit:
        schools = schools.head(limit)
    schools_ac = schools.to_crs(ANALYSIS_CRS)
    candidates = gpd.read_parquet(CANDIDATES_TABLE)
    candidates["geometry_wgs84"] = candidates.geometry.to_crs(4326).values
    clean = pd.read_parquet(CRASHES_CLEAN_TABLE)
    status = clean["association"].to_numpy()
    crash_geoms = gpd.GeoSeries(gpd.points_from_xy(clean["lon"], clean["lat"]), crs=4326).to_crs(ANALYSIS_CRS).values
    crash_tree = STRtree(crash_geoms)
    log(f"publishing {len(schools):,} schools from {len(candidates):,} candidates and {len(clean):,} crashes", t0)

    cand_tree = STRtree(candidates.geometry.values)
    assigned = clean[clean["candidate_id"] != ""]
    by_candidate = {k: v for k, v in assigned.groupby("candidate_id")}
    index_rows = []
    total_bytes = 0
    schools_dir = PUBLISHED / "schools"
    for s, geom in zip(schools.itertuples(index=False), schools_ac.geometry.values):
        s_series = pd.Series(s._asdict())
        idx = cand_tree.query(geom, predicate="dwithin", distance=MAX_RADIUS_M)
        cands = candidates.iloc[idx]
        dist = shapely.distance(cands.geometry.values, geom)
        near = crash_tree.query(geom, predicate="dwithin", distance=MAX_RADIUS_M)
        quality = {k: 0 for k in ["assigned", *UNASSIGNED_REASONS.keys()]}
        for k, v in pd.Series(status[near]).value_counts().items():
            quality[k] = int(v)
        quality["recordedNearby"] = int(len(near))
        cids = set(cands["candidate_id"])
        rows = [by_candidate[c] for c in cids if c in by_candidate]
        school_crashes = pd.concat(rows) if rows else clean.iloc[0:0]
        pkg = build_package(s_series, cands, dist, school_crashes, window_start, window_end, quality,
                            model["version"], generated_at)
        total_bytes += write_json(schools_dir / f"{s.school_id}.json", pkg)
        index_rows.append([
            s.school_id, s.name, clean_value(s.city), clean_value(s.district), clean_value(s.level),
            round(float(s.lon), 6), round(float(s.lat), 6), int((dist <= 800).sum()), int(len(school_crashes)),
        ])
    write_json(PUBLISHED / "index.json", {
        "generatedAt": generated_at,
        "modelVersion": model["version"],
        "window": {"start": window_start.isoformat(), "end": window_end.isoformat()},
        "fields": ["id", "name", "city", "district", "level", "lon", "lat", "candidates800", "crashes1200"],
        "schools": index_rows,
    })
    log(f"published {len(index_rows):,} school packages ({total_bytes / 1e6:.1f} MB)", t0)
    write_meta(generated_at, summary, clean, candidates, status, schools)
    log("publish stage complete", t0)


def main(limit: int | None = None, publish_only: bool = False) -> None:
    if not publish_only:
        build(limit)
    publish(limit)


def write_meta(generated_at, summary, clean, candidates, status, schools) -> None:
    model = load_model()
    monthly = (
        pd.to_datetime(clean["crash_date"]).dt.to_period("M").value_counts().sort_index()
    )
    school_q = pd.read_parquet(QUARANTINE_TABLE) if QUARANTINE_TABLE.exists() else pd.DataFrame(columns=["reason"])
    traffic_cov = candidates["aadt_status"].value_counts().to_dict()
    unnamed = int(candidates["name"].str.contains("Unnamed", regex=False).sum())
    sources = [
        {"id": catalog.NCES_SCHOOL_LOCATIONS.key, "title": catalog.NCES_SCHOOL_LOCATIONS.title,
         "publisher": catalog.NCES_SCHOOL_LOCATIONS.publisher, "url": catalog.NCES_SCHOOL_LOCATIONS.url,
         "role": "School names and locations", "records": int(len(schools) + len(school_q))},
        {"id": catalog.NCES_SCHOOL_ADMIN.key, "title": catalog.NCES_SCHOOL_ADMIN.title,
         "publisher": catalog.NCES_SCHOOL_ADMIN.publisher, "url": catalog.NCES_SCHOOL_ADMIN.url,
         "role": "District, school level, operating status, virtual-school flag", "records": None},
        {"id": catalog.GDOT_CRASHES.key, "title": catalog.GDOT_CRASHES.title,
         "publisher": catalog.GDOT_CRASHES.publisher, "url": catalog.GDOT_CRASHES.url,
         "role": "Crash locations, dates, injuries, pedestrian involvement, lighting", "records": summary["rawCrashes"]},
        {"id": catalog.GDOT_ROAD_INVENTORY["key"], "title": catalog.GDOT_ROAD_INVENTORY["title"],
         "publisher": catalog.GDOT_ROAD_INVENTORY["publisher"], "url": catalog.GDOT_ROAD_INVENTORY["url"],
         "role": "Road geometry, functional class, lanes, ramps and divided highways", "records": None},
        {"id": catalog.GDOT_AADT_2023.key, "title": catalog.GDOT_AADT_2023.title,
         "publisher": catalog.GDOT_AADT_2023.publisher, "url": catalog.GDOT_AADT_2023.url,
         "role": "Traffic volume (AADT) by road segment", "records": None},
        {"id": catalog.GDOT_SIGNALS.key, "title": catalog.GDOT_SIGNALS.title,
         "publisher": catalog.GDOT_SIGNALS.publisher, "url": catalog.GDOT_SIGNALS.url,
         "role": "GDOT-permitted traffic signals (informational)", "records": None},
        {"id": "tiger_roads", "title": "TIGERweb Transportation (Primary, Secondary, Local Roads)",
         "publisher": "U.S. Census Bureau", "url": catalog.TIGER_ROADS[2].url.rsplit("/", 1)[0],
         "role": "Street names", "records": None},
        {"id": catalog.ARC_HIGH_INJURY_NETWORK.key, "title": catalog.ARC_HIGH_INJURY_NETWORK.title,
         "publisher": catalog.ARC_HIGH_INJURY_NETWORK.publisher, "url": catalog.ARC_HIGH_INJURY_NETWORK.url,
         "role": "Independent validation reference (not used in scoring)", "records": None},
    ]
    meta = {
        "generatedAt": generated_at,
        "dataSnapshot": summary["snapshot"],
        "modelVersion": model["version"],
        "window": {"start": summary["windowStart"], "end": summary["windowEnd"], "months": WINDOW_MONTHS},
        "sources": sources,
        "labels": {"collision": COLLISION_LABELS, "light": LIGHT_LABELS},
        "quality": {
            "crashCleaning": summary["cleaning"],
            "crashesRaw": summary["rawCrashes"],
            "crashesBeforeWindow": summary["outsideWindow"],
            "crashesClean": int(len(clean)),
            "association": {k: int(v) for k, v in pd.Series(status).value_counts().items()},
            "associationReasons": UNASSIGNED_REASONS,
            "schoolsQuarantined": school_q["reason"].value_counts().to_dict(),
            "candidates": int(len(candidates)),
            "intersections": int((candidates["kind"] == "intersection").sum()),
            "segments": int((candidates["kind"] == "segment").sum()),
            "trafficCoverage": {k: int(v) for k, v in traffic_cov.items()},
            "unnamedCandidates": unnamed,
            "monthlyCrashes": [{"month": str(k), "crashes": int(v)} for k, v in monthly.items()],
        },
        "ruleDescriptions": RULE_DESCRIPTIONS,
    }
    write_json(PUBLISHED / "meta.json", meta)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="process only the first N schools (development)")
    ap.add_argument("--publish-only", action="store_true", help="re-publish from data/interim without rebuilding")
    args = ap.parse_args()
    main(limit=args.limit, publish_only=args.publish_only)
