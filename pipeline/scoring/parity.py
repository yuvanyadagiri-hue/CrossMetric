"""Write the Python/TypeScript parity fixture.

    python -m pipeline.scoring.parity

Takes a few real published school packages, scores them with the Python
reference implementation under several configurations, and writes both the
packages and the expected results to packages/engine/test/fixtures/parity.json.
The TypeScript test (packages/engine/test/parity.test.ts) recomputes every
configuration and must match exactly.
"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline.config import PUBLISHED, ROOT
from pipeline.scoring.features import package_features
from pipeline.scoring.model import score_population

OUT = ROOT / "packages" / "engine" / "test" / "fixtures" / "parity.json"
CONFIGS = [
    {"radiusM": 800, "periodYears": 3, "crashFilter": "all", "scenario": "standard"},
    {"radiusM": 400, "periodYears": 3, "crashFilter": "all", "scenario": "crash"},
    {"radiusM": 1200, "periodYears": 1, "crashFilter": "injury", "scenario": "injury"},
    {"radiusM": 1200, "periodYears": 3, "crashFilter": "pedestrian", "scenario": "pedestrian"},
    {"radiusM": 800, "periodYears": 1, "crashFilter": "lowLight", "scenario": "standard"},
]


def choose_packages(n: int = 3) -> list[dict]:
    """Smallest packages that still exercise every code path (peds, missing AADT, ties)."""
    chosen = []
    for path in sorted((PUBLISHED / "schools").glob("*.json"), key=lambda p: p.stat().st_size):
        pkg = json.loads(path.read_text(encoding="utf-8"))
        c = pkg["candidates"]
        flags = pkg["crashes"]["flags"]
        if len(c) < 25 or len(flags) < 40:
            continue
        has_ped = any(f & 4 for f in flags)
        has_missing = any(x["traffic"]["aadt"] is None for x in c)
        has_aadt = any(x["traffic"]["aadt"] is not None for x in c)
        if has_ped and has_missing and has_aadt:
            chosen.append(pkg)
        if len(chosen) == n:
            break
    return chosen


def main() -> None:
    packages = choose_packages()
    cases = []
    for pkg in packages:
        for cfg in CONFIGS:
            feats, _ = package_features(pkg, cfg["radiusM"], cfg["periodYears"], cfg["crashFilter"])
            if len(feats.ids) == 0:
                continue
            df = score_population(feats, cfg["scenario"])
            cases.append(
                {
                    "schoolId": pkg["school"]["id"],
                    "config": cfg,
                    "expected": [
                        {
                            "id": r.id,
                            "priority": float(r.priority),
                            "rank": int(r.rank),
                            "band": r.band,
                            "bestRank": int(r.best_rank),
                            "worstRank": int(r.worst_rank),
                            "stability": r.stability,
                            "scores": {k: (None if v != v else float(v)) for k, v in
                                       {c: getattr(r, f"score_{c}") for c in ("crash", "injury", "pedestrian", "traffic", "proximity")}.items()},
                        }
                        for r in df.itertuples()
                    ],
                }
            )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "note": "Real published CrossMetric packages and the Python reference results for them. Regenerate with: python -m pipeline.scoring.parity",
        "packages": packages,
        "cases": cases,
    }, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(cases)} parity cases for {len(packages)} schools -> {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
