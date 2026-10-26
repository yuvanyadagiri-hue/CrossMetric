"""Load CrossMetric results into Supabase PostgreSQL + PostGIS.

    set DATABASE_URL=postgresql://...      (Supabase: Project Settings -> Database)
    python -m pipeline.publish.postgis               # web-app tables + reference analyses
    python -m pipeline.publish.postgis --with-roads  # also the GDOT road sections near schools
    python -m pipeline.publish.postgis --with-quarantine

Apply supabase/migrations/*.sql first (Supabase SQL editor or `supabase db push`).
Bulk tables are loaded with COPY; geography values are sent as EWKT, which
PostGIS parses on input.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import geopandas as gpd
import numpy as np
import pandas as pd

from pipeline.config import ANALYSIS_CRS, INTERIM, MAX_RADIUS_M, NETWORK_MARGIN_M, PUBLISHED
from pipeline.ingestion.reference_layers import AADT_TABLE
from pipeline.ingestion.roads import ROADS_TABLE
from pipeline.ingestion.schools import load_schools
from pipeline.run import BUILD_SUMMARY, CANDIDATES_TABLE, CRASHES_CLEAN_TABLE, QUARANTINE_CRASHES_TABLE
from pipeline.scoring.features import package_features
from pipeline.scoring.model import load_model, score_population


def ewkt(geom) -> str:
    return f"SRID=4326;{geom.wkt}"


def nn(v):
    """None for NaN/NA so COPY writes NULL."""
    if v is None:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    if v is pd.NA:
        return None
    return v


def copy_rows(cur, table: str, columns: list[str], rows) -> int:
    n = 0
    with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as cp:
        for row in rows:
            cp.write_row([nn(v) for v in row])
            n += 1
    print(f"  {table}: {n:,} rows")
    return n


def pg_array(values) -> str:
    return "{" + ",".join('"' + str(v).replace('"', '\\"') + '"' for v in values) + "}"


def load(url: str, with_roads: bool, with_quarantine: bool) -> None:
    import psycopg

    model = load_model()
    meta = json.loads((PUBLISHED / "meta.json").read_text(encoding="utf-8"))
    summary = json.loads(BUILD_SUMMARY.read_text(encoding="utf-8"))
    validation = json.loads((PUBLISHED / "validation.json").read_text(encoding="utf-8")) if (PUBLISHED / "validation.json").exists() else None
    packages = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in (PUBLISHED / "schools").glob("*.json")}
    index = json.loads((PUBLISHED / "index.json").read_text(encoding="utf-8"))
    counts = {row[0]: (row[7], row[8]) for row in index["schools"]}

    with psycopg.connect(url, autocommit=False) as conn, conn.cursor() as cur:
        print("clearing previous CrossMetric data")
        cur.execute(
            "truncate validation_runs, analysis_candidates, analyses, crash_quarantine, crashes, school_candidates, "
            "candidate_locations, traffic_counts, road_segments, schools, pipeline_runs, model_versions, data_sources restart identity cascade"
        )

        for s in meta["sources"]:
            cur.execute(
                "insert into data_sources (id, title, publisher, url, role, records, retrieved_on) values (%s,%s,%s,%s,%s,%s,%s)",
                (s["id"], s["title"], s["publisher"], s["url"], s["role"], s["records"], summary["snapshot"]),
            )
        cur.execute(
            "insert into model_versions (version, released, definition) values (%s,%s,%s)",
            (model["version"], model["released"], json.dumps(model)),
        )
        cur.execute(
            "insert into pipeline_runs (generated_at, data_snapshot, window_start, window_end, model_version, meta) values (%s,%s,%s,%s,%s,%s)",
            (meta["generatedAt"], meta["dataSnapshot"], meta["window"]["start"], meta["window"]["end"], model["version"], json.dumps(meta)),
        )

        schools = load_schools()
        copy_rows(
            cur,
            "schools",
            ["id", "name", "district", "district_id", "city", "county", "street", "zip", "level", "grade_low", "grade_high",
             "school_type", "school_year", "candidates_800", "crashes_1200", "quality", "geom"],
            (
                [s.school_id, s.name, s.district, s.district_id, s.city, s.county, s.street, s.zip, s.level, s.grade_low,
                 s.grade_high, s.school_type, s.school_year, counts.get(s.school_id, (0, 0))[0], counts.get(s.school_id, (0, 0))[1],
                 json.dumps(packages[s.school_id]["quality"]) if s.school_id in packages else "{}", ewkt(s.geometry)]
                for s in schools.itertuples(index=False)
            ),
        )

        if with_roads:
            roads = gpd.read_parquet(ROADS_TABLE)
            near = schools.to_crs(ANALYSIS_CRS).buffer(MAX_RADIUS_M + NETWORK_MARGIN_M)
            idx = np.unique(roads.sindex.query(near.values, predicate="intersects")[1])
            roads = roads.iloc[idx].to_crs(4326)
            copy_rows(
                cur, "road_segments",
                ["id", "route_id", "route_key", "direction", "function_type", "system_code", "f_system", "lanes", "role", "begin_mp", "end_mp", "geom"],
                ([r.road_id, r.route_id, r.route_key, r.direction, r.function_type, r.system_code, nn(r.f_system), nn(r.lanes),
                  r.role, nn(r.begin_mp), nn(r.end_mp), ewkt(r.geometry)] for r in roads.itertuples(index=False)),
            )

        aadt = gpd.read_parquet(AADT_TABLE)
        copy_rows(
            cur, "traffic_counts", ["route_id", "aadt", "aadt_year", "future_aadt", "source_id", "geom"],
            ([r.route_id, int(r.aadt), int(r.aadt_year), None if pd.isna(r.future_aadt) or r.future_aadt <= 0 else int(r.future_aadt),
              "gdot_aadt_2023", ewkt(r.geometry)] for r in aadt.itertuples(index=False)),
        )

        cands = gpd.read_parquet(CANDIDATES_TABLE).to_crs(4326)
        copy_rows(
            cur, "candidate_locations",
            ["id", "kind", "name", "context", "roads", "route_keys", "functional_class", "lanes", "length_m", "legs", "signalized",
             "aadt", "aadt_year", "aadt_status", "aadt_roads_counted", "aadt_roads_total", "geom"],
            ([c.candidate_id, c.kind, c.name, nn(c.context), pg_array(c.roads), pg_array(c.route_keys), int(c.f_system), nn(c.lanes),
              nn(c.length_m), nn(c.legs), True if c.signalized is True else None,
              None if pd.isna(c.aadt) else int(round(c.aadt)), None if pd.isna(c.aadt_year) else int(c.aadt_year),
              c.aadt_status, int(c.aadt_roads_counted), int(c.aadt_roads_total), ewkt(c.geometry)] for c in cands.itertuples(index=False)),
        )

        copy_rows(
            cur, "school_candidates", ["school_id", "candidate_id", "distance_m"],
            ([sid, c["id"], c["distanceM"]] for sid, pkg in packages.items() for c in pkg["candidates"]),
        )

        crashes = pd.read_parquet(CRASHES_CLEAN_TABLE)
        crashes = crashes[crashes["association"] != "outside_school_areas"]
        copy_rows(
            cur, "crashes",
            ["crash_id", "source_oid", "crash_date", "injuries", "fatalities", "vehicles", "injury_or_fatal", "fatal", "pedestrian",
             "bicyclist", "light", "low_light", "collision_type", "location_of_impact", "county", "candidate_id", "association", "geom"],
            ([k.crash_id, int(k.source_oid), k.crash_date, nn(k.injuries), nn(k.fatalities), nn(k.vehicles), bool(k.injury_or_fatal),
              bool(k.fatal), bool(k.pedestrian), bool(k.bicyclist), k.light, bool(k.low_light), nn(k.collision_type),
              nn(k.location_of_impact), nn(k.county), k.candidate_id or None, k.association, f"SRID=4326;POINT({k.lon} {k.lat})"]
             for k in crashes.itertuples(index=False)),
        )

        if with_quarantine:
            q = pd.read_parquet(QUARANTINE_CRASHES_TABLE)
            copy_rows(
                cur, "crash_quarantine", ["source_oid", "crash_id", "reason", "crash_date", "county"],
                ([int(r.source_oid), nn(r.crash_id), r.reason, r.crash_date, nn(r.county)] for r in q.itertuples(index=False)),
            )

        # Reference analyses (Python implementation, Standard scenario, default settings) so results
        # can be audited in SQL and compared with what the web app computes.
        n_an = 0
        for sid, pkg in packages.items():
            feats, _ = package_features(pkg, radius_m=800, period_years=3, crash_filter="all")
            cur.execute(
                "insert into analyses (school_id, model_version, radius_m, period_years, crash_filter, scenario, window_start, window_end, "
                "population, matched_crashes) values (%s,%s,800,3,'all','standard',%s,%s,%s,%s) returning id",
                (sid, model["version"], pkg["window"]["start"], pkg["window"]["end"], len(feats.ids), int(feats.crashes.sum())),
            )
            analysis_id = cur.fetchone()[0]
            if len(feats.ids) == 0:
                continue
            df = score_population(feats, "standard")
            f_by_id = {i: k for k, i in enumerate(feats.ids)}
            with cur.copy(
                "COPY analysis_candidates (analysis_id, candidate_id, rank, priority, band, score_crash, score_injury, score_pedestrian, "
                "score_traffic, score_proximity, crashes, injury_crashes, pedestrian_crashes, best_rank, worst_rank, stability) FROM STDIN"
            ) as cp:
                for r in df.itertuples():
                    k = f_by_id[r.id]
                    cp.write_row([analysis_id, r.id, int(r.rank), float(r.priority), r.band] +
                                 [nn(float(getattr(r, f"score_{c}"))) for c in ("crash", "injury", "pedestrian", "traffic", "proximity")] +
                                 [int(feats.crashes[k]), int(feats.injury_crashes[k]), int(feats.pedestrian_crashes[k]),
                                  int(r.best_rank), int(r.worst_rank), r.stability])
            n_an += 1
        print(f"  analyses: {n_an:,} reference analyses")

        if validation:
            for exp in validation["experiments"]:
                cur.execute(
                    "insert into validation_runs (experiment, model_version, run_at, title, reference, description, metrics) values (%s,%s,%s,%s,%s,%s,%s)",
                    (exp["id"], validation["modelVersion"], validation["generatedAt"], exp["title"], exp["reference"], exp["description"], json.dumps(exp["metrics"])),
                )
        conn.commit()
    print("PostGIS load complete")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-roads", action="store_true")
    ap.add_argument("--with-quarantine", action="store_true")
    args = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set. See docs/DATA_SETUP.md.")
    load(url, args.with_roads, args.with_quarantine)


if __name__ == "__main__":
    main()
