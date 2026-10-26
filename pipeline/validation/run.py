"""CrossMetric validation experiments.

    python -m pipeline.validation.run

None of these experiments was used to choose model weights: the model file is
fixed before validation runs, and results are published as they come out.

1. hin_agreement   — do CrossMetric's top locations around metro-Atlanta
                     schools fall on ARC's independent Regional High Injury
                     Network (built from 2019-2023 crashes, a different period)?
2. persistence     — score with only the first 24 months, then check whether
                     the top-ranked locations kept accumulating crashes in the
                     held-out final months.
3. aadt_crosscheck — does the 2023 AADT segment layer agree with GDOT's own
                     2017 count-station values at the same places?
4. robustness      — statewide, how often do Standard top-5 locations stay in
                     the top 5 under every alternate scenario?
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from shapely.strtree import STRtree

from pipeline.config import ANALYSIS_CRS, PUBLISHED
from pipeline.ingestion.reference_layers import AADT_TABLE, HIN_TABLE, STATIONS_TABLE
from pipeline.publish.package import write_json
from pipeline.scoring.features import package_features
from pipeline.scoring.model import load_model, score_population

HIN_MATCH_M = 25.0
TOP_N = 5
SPLIT_DAY = 731  # first 24 months of the window (2023-10-03 .. 2025-10-02)


def load_packages() -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((PUBLISHED / "schools").glob("*.json"))]


def metric(label: str, value: float | None, display: str, note: str | None = None) -> dict:
    out = {"label": label, "value": None if value is None or not np.isfinite(value) else round(float(value), 4), "display": display}
    if note:
        out["note"] = note
    return out


def pct(x: float) -> str:
    return f"{100 * x:.1f}%"


# ----------------------------------------------------------------------------
def spearman(a, b) -> float:
    """Spearman rank correlation = Pearson correlation of average ranks (no SciPy needed)."""
    ra = pd.Series(np.asarray(a, dtype=float)).rank()
    rb = pd.Series(np.asarray(b, dtype=float)).rank()
    return float(ra.corr(rb))


def rank_auc(scores: np.ndarray, positive: np.ndarray) -> tuple[float, int]:
    """P(random positive outranks random negative); ties count half. Returns (auc, pairs)."""
    pos = scores[positive]
    neg = scores[~positive]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan"), 0
    greater = (pos[:, None] > neg[None, :]).sum()
    ties = (pos[:, None] == neg[None, :]).sum()
    pairs = len(pos) * len(neg)
    return (greater + 0.5 * ties) / pairs, pairs


def hin_agreement(packages: list[dict]) -> dict:
    hin = gpd.read_parquet(HIN_TABLE).to_crs(ANALYSIS_CRS)
    study_area = shapely.convex_hull(shapely.union_all(hin.geometry.values)).buffer(1000)
    hin_tree = STRtree(hin.geometry.values)
    to_ac = gpd.GeoSeries([], crs=4326)

    rows = {"crossmetric": [], "crash_only": [], "proximity_only": []}
    total_cands = on_hin_total = schools_used = 0
    auc_num = {k: 0.0 for k in rows}
    auc_den = {k: 0 for k in rows}
    for pkg in packages:
        school_pt = gpd.GeoSeries(gpd.points_from_xy([pkg["school"]["lon"]], [pkg["school"]["lat"]]), crs=4326).to_crs(ANALYSIS_CRS).values[0]
        if not study_area.contains(school_pt):
            continue
        feats, members = package_features(pkg, radius_m=800)
        if len(members) < 10:
            continue
        geoms = to_ac._constructor([shape(pkg["candidates"][i]["geometry"]) for i in members], crs=4326).to_crs(ANALYSIS_CRS).values
        probe = np.array([g if g.geom_type == "Point" else g.interpolate(0.5, normalized=True) for g in geoms])
        near = hin_tree.query(probe, predicate="dwithin", distance=HIN_MATCH_M)
        on_hin = np.zeros(len(members), dtype=bool)
        on_hin[np.unique(near[0])] = True
        if on_hin.sum() == 0:
            continue
        schools_used += 1
        total_cands += len(members)
        on_hin_total += int(on_hin.sum())
        scored = score_population(feats, "standard").set_index("id")
        prio = scored.loc[feats.ids, "priority"].to_numpy()
        rankings = {
            "crossmetric": prio,
            "crash_only": feats.crashes + 1e-6 * (-feats.distance_m),  # tie-break by proximity
            "proximity_only": -feats.distance_m,
        }
        for name, s in rankings.items():
            top = np.argsort(-s, kind="stable")[:TOP_N]
            rows[name].append(on_hin[top].mean())
            auc, pairs = rank_auc(s, on_hin)
            if pairs:
                auc_num[name] += auc * pairs
                auc_den[name] += pairs
    base = on_hin_total / max(total_cands, 1)
    prec = {k: float(np.mean(v)) if v else float("nan") for k, v in rows.items()}
    auc = {k: auc_num[k] / auc_den[k] if auc_den[k] else float("nan") for k in rows}
    return {
        "id": "hin_agreement",
        "title": "Agreement with an independent High Injury Network",
        "reference": "Atlanta Regional Commission, Regional High Injury Network (fatal and serious-injury crashes, 2019–2023)",
        "description": (
            f"For {schools_used} metro-Atlanta schools (800 m, Standard scenario), we checked whether CrossMetric's top {TOP_N} locations lie on ARC's "
            f"High Injury Network. ARC built its network from 2019–2023 crashes; CrossMetric uses Oct 2023 onward, so the two share almost no crash records. "
            f"CrossMetric also weighs school proximity, which a High Injury Network ignores, so perfect agreement is neither expected nor desired. "
            f"Two simple baselines show the range: ranking by crash count only, and by distance only."
        ),
        "metrics": [
            metric("Schools evaluated", schools_used, f"{schools_used:,}"),
            metric("Base rate (all candidates on the HIN)", base, pct(base), "What a random choice would achieve."),
            metric(f"CrossMetric top-{TOP_N} on the HIN", prec["crossmetric"], pct(prec["crossmetric"]), f"{prec['crossmetric'] / base:.1f}× the base rate."),
            metric(f"Crash-count-only top-{TOP_N} on the HIN", prec["crash_only"], pct(prec["crash_only"]), f"{prec['crash_only'] / base:.1f}× the base rate."),
            metric(f"Distance-only top-{TOP_N} on the HIN", prec["proximity_only"], pct(prec["proximity_only"]), f"{prec['proximity_only'] / base:.1f}× the base rate."),
            metric("Ranking AUC vs HIN membership (CrossMetric)", auc["crossmetric"], f"{auc['crossmetric']:.3f}", "0.5 = no better than chance; 1.0 = every HIN location ranked above every non-HIN location."),
            metric("Ranking AUC (crash count only)", auc["crash_only"], f"{auc['crash_only']:.3f}"),
            metric("Ranking AUC (distance only)", auc["proximity_only"], f"{auc['proximity_only']:.3f}"),
        ],
    }


# ----------------------------------------------------------------------------
def persistence(packages: list[dict]) -> dict:
    top_b = rest_b = 0.0
    top_n = rest_n = 0
    share_top_crashes = []
    share_top_cands = []
    rhos = []
    for pkg in packages:
        feats_a, members = package_features(pkg, radius_m=800, day_range=(0, SPLIT_DAY))
        if len(members) < 10:
            continue
        feats_b, _ = package_features(pkg, radius_m=800, day_range=(SPLIT_DAY, 10**9))
        if feats_b.crashes.sum() == 0:
            continue
        scored = score_population(feats_a, "standard").set_index("id")
        prio = scored.loc[feats_a.ids, "priority"].to_numpy()
        order = np.argsort(-prio, kind="stable")
        top = order[:TOP_N]
        mask = np.zeros(len(members), dtype=bool)
        mask[top] = True
        top_b += feats_b.crashes[mask].sum()
        rest_b += feats_b.crashes[~mask].sum()
        top_n += mask.sum()
        rest_n += (~mask).sum()
        share_top_crashes.append(feats_b.crashes[mask].sum() / feats_b.crashes.sum())
        share_top_cands.append(mask.mean())
        rho = spearman(prio, feats_b.crashes)
        if np.isfinite(rho):
            rhos.append(rho)
    mean_top = top_b / max(top_n, 1)
    mean_rest = rest_b / max(rest_n, 1)
    return {
        "id": "persistence",
        "title": "Evidence persistence (held-out months)",
        "reference": "CrossMetric's own data, split in time: Oct 2023 – Oct 2025 to score, Oct 2025 – Aug 2026 to check",
        "description": (
            "CrossMetric does not predict crashes, but its evidence should reflect lasting patterns rather than noise. We re-scored every school "
            "using only the first 24 months of crashes, then counted crashes in the remaining months, which the scoring never saw."
        ),
        "metrics": [
            metric("Schools evaluated", len(share_top_crashes), f"{len(share_top_crashes):,}"),
            metric(f"Held-out crashes per top-{TOP_N} location", mean_top, f"{mean_top:.2f}"),
            metric("Held-out crashes per other location", mean_rest, f"{mean_rest:.2f}", f"Top locations saw {mean_top / max(mean_rest, 1e-9):.1f}× as many."),
            metric(f"Share of held-out crashes at the top {TOP_N}", float(np.mean(share_top_crashes)), pct(float(np.mean(share_top_crashes))), f"while being {pct(float(np.mean(share_top_cands)))} of locations (school average)."),
            metric("Median within-school Spearman correlation", float(np.median(rhos)), f"{np.median(rhos):.2f}", "Between earlier priority and later crash counts."),
        ],
    }


# ----------------------------------------------------------------------------
def aadt_crosscheck() -> dict:
    aadt = gpd.read_parquet(AADT_TABLE).to_crs(ANALYSIS_CRS)
    st = gpd.read_parquet(STATIONS_TABLE).to_crs(ANALYSIS_CRS)
    st = st[st["aadt_2017"].notna() & (st["aadt_2017"] > 0)]
    tree = STRtree(aadt.geometry.values)
    (i_st, i_seg), _ = tree.query_nearest(st.geometry.values, max_distance=20, return_distance=True, all_matches=False)
    a2017 = st["aadt_2017"].to_numpy()[i_st]
    a2023 = aadt["aadt"].to_numpy()[i_seg]
    rho = spearman(a2017, a2023)
    ratio = a2023 / a2017
    within = np.mean(np.abs(np.log(ratio)) <= np.log(1.25))
    return {
        "id": "aadt_crosscheck",
        "title": "Traffic data cross-check",
        "reference": "GDOT count-station AADT, 2017 (separate copy of GDOT station data)",
        "description": (
            "The 2023 AADT segments come from an ArcGIS Online republication of GDOT data (GDOT's own server was unreachable). To verify them, each "
            "GDOT count station was matched to the 2023 segment within 20 m and the two values compared. Traffic changes over six years, so close — "
            "not identical — agreement is the expected result for genuine GDOT counts."
        ),
        "metrics": [
            metric("Stations matched", len(i_st), f"{len(i_st):,}"),
            metric("Spearman rank correlation", rho, f"{rho:.3f}"),
            metric("Median ratio, 2023 / 2017", float(np.median(ratio)), f"{np.median(ratio):.2f}"),
            metric("Within ±25% of the 2017 value", float(within), pct(float(within))),
        ],
    }


# ----------------------------------------------------------------------------
def robustness(packages: list[dict]) -> dict:
    model = load_model()
    stay_all = []
    levels = {"high": 0, "moderate": 0, "low": 0}
    schools = 0
    for pkg in packages:
        feats, members = package_features(pkg, radius_m=800)
        if len(members) < 10:
            continue
        schools += 1
        base = score_population(feats, "standard")
        top = set(base["id"].head(TOP_N))
        for lvl in base.head(TOP_N)["stability"]:
            levels[lvl] += 1
        keep = set(top)
        for s in model["scenarios"]:
            keep &= set(score_population(feats, s["id"])["id"].head(TOP_N))
        stay_all.append(len(keep) / TOP_N)
    total = sum(levels.values())
    return {
        "id": "robustness",
        "title": "Ranking robustness across scenarios",
        "reference": "CrossMetric sensitivity analysis (four weighting scenarios)",
        "description": (
            f"For every school with at least 10 candidates (800 m), we took the Standard top {TOP_N} and checked how many remain in the top {TOP_N} "
            "under all four weighting scenarios, and how the stability rule classifies them."
        ),
        "metrics": [
            metric("Schools evaluated", schools, f"{schools:,}"),
            metric(f"Top-{TOP_N} locations kept under every scenario", float(np.mean(stay_all)), pct(float(np.mean(stay_all)))),
            metric("Top locations with High stability", levels["high"] / total, pct(levels["high"] / total)),
            metric("Top locations with Moderate stability", levels["moderate"] / total, pct(levels["moderate"] / total)),
            metric("Top locations with Low stability", levels["low"] / total, pct(levels["low"] / total)),
        ],
    }


def main() -> None:
    packages = load_packages()
    print(f"loaded {len(packages):,} packages")
    experiments = []
    for fn in (lambda: hin_agreement(packages), lambda: persistence(packages), aadt_crosscheck, lambda: robustness(packages)):
        exp = fn()
        experiments.append(exp)
        print(f"\n== {exp['title']}")
        for m in exp["metrics"]:
            print(f"   {m['label']}: {m['display']}" + (f"  ({m['note']})" if m.get("note") else ""))
    write_json(PUBLISHED / "validation.json", {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "modelVersion": load_model()["version"],
        "experiments": experiments,
    })


if __name__ == "__main__":
    main()
