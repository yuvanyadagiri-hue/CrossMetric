"""Data-contract tests on the REAL pipeline output.

These assert that published data satisfies the same rules the PostGIS schema
enforces (supabase/migrations), so a load can't fail on constraint violations,
and that the web app never receives NaN/Infinity. Skipped when the pipeline
hasn't been run.
"""

import json
import math
import re

import pytest

from pipeline.config import INTERIM, PUBLISHED

pytestmark = pytest.mark.skipif(not (PUBLISHED / "index.json").exists(), reason="run python -m pipeline.run first")

CANDIDATE_ID = re.compile(r"^[IS][0-9a-f]{10}$")


@pytest.fixture(scope="module")
def sample_packages():
    files = sorted((PUBLISHED / "schools").glob("*.json"))
    step = max(1, len(files) // 120)
    return [json.loads(f.read_text(encoding="utf-8")) for f in files[::step]]


def _finite(obj, path="$"):
    if isinstance(obj, float):
        assert math.isfinite(obj), f"non-finite number at {path}"
    elif isinstance(obj, dict):
        for k, v in obj.items():
            _finite(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:50]):
            _finite(v, f"{path}[{i}]")


def test_index_covers_every_published_school():
    index = json.loads((PUBLISHED / "index.json").read_text(encoding="utf-8"))
    ids = {row[0] for row in index["schools"]}
    files = {p.stem for p in (PUBLISHED / "schools").glob("*.json")}
    assert ids == files
    assert all(re.fullmatch(r"\d{12}", i) for i in ids)


def test_packages_respect_schema_constraints(sample_packages):
    for pkg in sample_packages:
        _finite(pkg)
        assert pkg["schemaVersion"] == 1
        assert pkg["window"]["start"] <= pkg["window"]["end"]
        seen = set()
        last = -1.0
        for c in pkg["candidates"]:
            assert CANDIDATE_ID.match(c["id"]) and c["id"] not in seen
            seen.add(c["id"])
            assert 0 <= c["distanceM"] <= 1200
            assert c["distanceM"] >= last  # sorted nearest first
            last = c["distanceM"]
            assert 1 <= c["functionalClass"] <= 7
            assert (c["kind"] == "intersection") == (c["geometry"]["type"] == "Point")
            assert (c["kind"] == "segment") == (c["geometry"]["type"] == "LineString")
            if c["kind"] == "intersection":
                assert c["legs"] >= 3
            else:
                assert c["lengthM"] > 0
            t = c["traffic"]
            assert (t["aadt"] is None) == (t["status"] == "unavailable")  # missing is never stored as 0
            assert t["aadt"] is None or t["aadt"] > 0
            assert 0 <= t["roadsCounted"] <= t["roadsTotal"]
            assert c["roads"], "every candidate has at least one road name"
        k = pkg["crashes"]
        n = len(k["id"])
        assert all(len(k[col]) == n for col in ("candidate", "day", "flags", "collision", "light", "lon", "lat"))
        assert all(0 <= ci < len(pkg["candidates"]) for ci in k["candidate"])
        assert all(d >= 0 for d in k["day"])
        for f in k["flags"]:
            assert not (f & 2) or (f & 1), "fatal implies injury"
        q = pkg["quality"]
        assert q["assigned"] >= 0 and q["recordedNearby"] >= q["assigned"]


def test_crash_assignment_consistency():
    import pandas as pd

    path = INTERIM / "crash_assignments.parquet"
    if not path.exists():
        pytest.skip("interim tables not present")
    a = pd.read_parquet(path)
    assigned = a["association"] == "assigned"
    assert ((a["candidate_id"] != "") == assigned).all()
    assert a["crash_id"].is_unique
    assert set(a["association"]) <= {"assigned", "off_network", "limited_access", "ramp", "no_candidate", "outside_school_areas"}


def test_meta_and_validation_are_complete():
    meta = json.loads((PUBLISHED / "meta.json").read_text(encoding="utf-8"))
    assert {s["id"] for s in meta["sources"]} >= {"nces_school_locations", "gdot_crashes", "gdot_road_inventory_2025", "gdot_aadt_2023"}
    assert sum(r["records"] for r in meta["quality"]["crashCleaning"]) + meta["quality"]["crashesClean"] + meta["quality"]["crashesBeforeWindow"] == meta["quality"]["crashesRaw"]
    vpath = PUBLISHED / "validation.json"
    if vpath.exists():
        v = json.loads(vpath.read_text(encoding="utf-8"))
        assert {e["id"] for e in v["experiments"]} == {"hin_agreement", "persistence", "aadt_crosscheck", "robustness"}
