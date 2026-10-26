"""Python reference implementation of the CrossMetric Priority model.

The web app scores candidates in TypeScript (packages/engine) so that every
control responds instantly. This module implements the *same* arithmetic, in
the same order, from the same model file. It is used for validation
experiments and for the analyses stored in PostGIS, and it generates the
parity fixture that the TypeScript test-suite checks against — if the two
implementations ever disagree, the tests fail.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd

from pipeline.config import MODEL_FILE


@lru_cache(maxsize=1)
def load_model() -> dict:
    return json.loads(MODEL_FILE.read_text(encoding="utf-8"))


def round_half_up(x: float) -> int:
    """Same as JavaScript Math.round for the non-negative values used here."""
    return int(math.floor(x + 0.5))


def percentile_scores(values: np.ndarray, available: np.ndarray, *, lower_is_priority: bool, evidence: bool) -> np.ndarray:
    """Empirical-percentile normalization.

    score(v) = 100 * (number of available candidates with value <= v) / N_available
    For lower-is-priority measures the comparison is reversed (value >= v).
    For evidence measures a value of zero scores 0.
    Unavailable values get NaN (the component is then excluded for that candidate).
    """
    out = np.full(len(values), np.nan)
    vals = values[available]
    n = len(vals)
    if n == 0:
        return out
    sorted_vals = np.sort(vals)
    if lower_is_priority:
        # count of values >= v
        counts = n - np.searchsorted(sorted_vals, vals, side="left")
    else:
        counts = np.searchsorted(sorted_vals, vals, side="right")
    scores = 100.0 * counts / n
    if evidence:
        scores = np.where(vals == 0, 0.0, scores)
    out[available] = scores
    return out


def band_for(priority: float) -> str:
    shown = round_half_up(priority)
    for band in load_model()["bands"]:
        if shown >= band["min"]:
            return band["id"]
    return load_model()["bands"][-1]["id"]


@dataclass(frozen=True)
class Features:
    """Raw indicator values for every candidate in one analysis population."""

    ids: np.ndarray
    crashes: np.ndarray
    injury_crashes: np.ndarray
    pedestrian_crashes: np.ndarray
    aadt: np.ndarray  # NaN where unavailable
    distance_m: np.ndarray

    def measure(self, name: str) -> np.ndarray:
        return {
            "crashes": self.crashes,
            "injuryCrashes": self.injury_crashes,
            "pedestrianCrashes": self.pedestrian_crashes,
            "aadt": self.aadt,
            "distanceM": self.distance_m,
        }[name]


def component_scores(f: Features) -> dict[str, np.ndarray]:
    out = {}
    for comp in load_model()["components"]:
        values = f.measure(comp["measure"]).astype(float)
        available = ~np.isnan(values)
        out[comp["id"]] = percentile_scores(
            values,
            available,
            lower_is_priority=comp["direction"] == "lower-is-priority",
            evidence=comp["kind"] == "evidence",
        )
    return out


def priorities(components: dict[str, np.ndarray], scenario_id: str) -> np.ndarray:
    model = load_model()
    weights = next(s for s in model["scenarios"] if s["id"] == scenario_id)["weights"]
    n = len(next(iter(components.values())))
    num = np.zeros(n)
    den = np.zeros(n)
    for comp in model["components"]:  # fixed order => identical float sums to TypeScript
        s = components[comp["id"]]
        w = float(weights[comp["id"]])
        ok = ~np.isnan(s)
        num = np.where(ok, num + w * np.nan_to_num(s), num)
        den = np.where(ok, den + w, den)
    return np.where(den > 0, num / np.where(den > 0, den, 1.0), 0.0)


def rank(f: Features, priority: np.ndarray) -> np.ndarray:
    """1-based ranks using the model's tie-break order."""
    order = sorted(
        range(len(priority)),
        key=lambda i: (-priority[i], -f.crashes[i], f.distance_m[i], str(f.ids[i])),
    )
    ranks = np.empty(len(priority), dtype=int)
    for r, i in enumerate(order, start=1):
        ranks[i] = r
    return ranks


def stability(ranks_by_scenario: list[np.ndarray], n: int) -> tuple[np.ndarray, np.ndarray, list[str]]:
    cfg = load_model()["stability"]
    stack = np.vstack(ranks_by_scenario)
    best, worst = stack.min(axis=0), stack.max(axis=0)
    spread = worst - best
    high_tol = max(cfg["high"]["minPositions"], math.ceil(cfg["high"]["shareOfCandidates"] * n))
    mod_tol = max(cfg["moderate"]["minPositions"], math.ceil(cfg["moderate"]["shareOfCandidates"] * n))
    labels = ["high" if s <= high_tol else "moderate" if s <= mod_tol else "low" for s in spread]
    return best, worst, labels


def score_population(f: Features, scenario_id: str = "standard") -> pd.DataFrame:
    comps = component_scores(f)
    prio = priorities(comps, scenario_id)
    ranks = rank(f, prio)
    all_ranks = [rank(f, priorities(comps, s["id"])) for s in load_model()["scenarios"]]
    best, worst, stab = stability(all_ranks, len(f.ids))
    df = pd.DataFrame({"id": f.ids, "priority": prio, "rank": ranks, "best_rank": best, "worst_rank": worst, "stability": stab})
    for cid, s in comps.items():
        df[f"score_{cid}"] = s
    df["band"] = [band_for(p) for p in prio]
    return df.sort_values("rank").reset_index(drop=True)
