"""Features from a published school package (mirror of packages/engine/src/features.ts)."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from dateutil.relativedelta import relativedelta

from pipeline.publish.package import FLAG_INJURY, FLAG_LOW_LIGHT, FLAG_PEDESTRIAN
from pipeline.scoring.model import Features

FILTER_FLAG = {"all": None, "injury": FLAG_INJURY, "pedestrian": FLAG_PEDESTRIAN, "lowLight": FLAG_LOW_LIGHT}


def period_start_day(pkg: dict, period_years: int) -> int:
    start = date.fromisoformat(pkg["window"]["start"])
    end = date.fromisoformat(pkg["window"]["end"])
    candidate = end - relativedelta(months=12 * period_years) + timedelta(days=1)
    return max(0, (max(candidate, start) - start).days)


def package_features(
    pkg: dict,
    radius_m: int = 800,
    period_years: int = 3,
    crash_filter: str = "all",
    day_range: tuple[int, int] | None = None,
) -> tuple[Features, list[int]]:
    """Return Features for candidates within ``radius_m`` and their package indices.

    ``day_range`` (inclusive start, exclusive end, in days since the window
    start) overrides the period — used by the out-of-sample validation.
    """
    cands = pkg["candidates"]
    members = [i for i, c in enumerate(cands) if c["distanceM"] <= radius_m]
    pos = {ci: k for k, ci in enumerate(members)}
    n = len(members)
    crashes = np.zeros(n)
    injury = np.zeros(n)
    ped = np.zeros(n)
    lo, hi = day_range if day_range else (period_start_day(pkg, period_years), 10**9)
    flag = FILTER_FLAG[crash_filter]
    k = pkg["crashes"]
    for cand, day, flags in zip(k["candidate"], k["day"], k["flags"]):
        p = pos.get(cand)
        if p is None or day < lo or day >= hi:
            continue
        if flag is not None and not flags & flag:
            continue
        crashes[p] += 1
        if flags & FLAG_INJURY:
            injury[p] += 1
        if flags & FLAG_PEDESTRIAN:
            ped[p] += 1
    aadt = np.array([np.nan if cands[i]["traffic"]["aadt"] is None else float(cands[i]["traffic"]["aadt"]) for i in members])
    dist = np.array([float(cands[i]["distanceM"]) for i in members])
    ids = np.array([cands[i]["id"] for i in members])
    return Features(ids, crashes, injury, ped, aadt, dist), members

