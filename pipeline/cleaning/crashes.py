"""Crash quality rules.

Every crash either passes or is quarantined with exactly one reason (the first
rule it fails, in the order below). Quarantined records are kept in their own
table and counted in the published data-quality report, so nothing disappears
silently.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from pipeline.config import GEORGIA_BOUNDS

COUNTY_CENTROID = "Primary County Centroid from FIPS"
PRIVATE_PROPERTY = "16-Private Property"

# Default (placeholder) locations.
#
# Many crash reports legitimately share one exact coordinate: GEARS snaps a
# large share of reports to points on the road network (82-91% of stacked
# coordinates lie within ~2.5 m of a centerline, in a single county). A blanket
# "N reports at one point" rule would therefore delete real crashes at the
# busiest intersections. Instead, a coordinate is treated as a default only
# when it has a signature no real location can have:
#
# 1. crashes from 3+ different counties share it (a point is in one county);
# 2. it is a round-number coordinate (<= 2 decimal places, e.g. -84.0, 33.0);
# 3. it is an isolated stack: 25+ reports at the point but more than 25x the
#    reports found at all other coordinates within 100 m. Real busy locations
#    are surrounded by GPS scatter (median stack/scatter ratio 2.5 among the
#    215 coordinates holding 100+ crashes); defaults are not (ratios 95-459).
DEFAULT_MIN_COUNTIES = 3
DEFAULT_ROUND_MIN_STACK = 10
ISOLATED_MIN_STACK = 25
ISOLATED_RATIO = 25.0
ISOLATION_RADIUS_M = 100.0
STACKED_COORDINATE_THRESHOLD = ISOLATED_MIN_STACK

# Disagreement between the service geometry and the report's own X/Y fields
# beyond ~0.002 degrees (~200 m) means the location cannot be trusted.
XY_DISAGREEMENT_DEG = 0.002


@dataclass(frozen=True)
class Rule:
    reason: str
    description: str


RULES: tuple[Rule, ...] = (
    Rule("no_coordinates", "Crash has no usable coordinates."),
    Rule("county_centroid", "Location was set to the county centroid because the true location was unknown."),
    Rule("outside_georgia", "Coordinates fall outside Georgia."),
    Rule("xy_mismatch", "Service geometry disagrees with the report's own X/Y fields by more than ~200 m."),
    Rule(
        "default_location",
        "Placeholder coordinate: shared by crashes from 3+ counties, a round-number coordinate, "
        "or an isolated stack of 25+ reports with almost no crashes around it.",
    ),
    Rule("missing_date", "Crash date is missing or unreadable."),
    Rule("future_date", "Crash date is after the data snapshot (data-entry error)."),
    Rule("duplicate_report", "Same GEARS accident ID appears more than once; first record kept."),
    Rule("private_property", "Crash occurred on private property (e.g. a parking lot), not a public roadway."),
)
RULE_DESCRIPTIONS = {r.reason: r.description for r in RULES}


def _decimals(x: float) -> int:
    s = f"{x:.6f}".rstrip("0")
    return len(s.split(".")[1]) if "." in s else 0


def default_location_mask(crashes: pd.DataFrame, eligible: pd.Series) -> pd.Series:
    """True for crashes sitting on a placeholder coordinate (see module notes)."""
    import geopandas as gpd
    from shapely.strtree import STRtree

    from pipeline.config import ANALYSIS_CRS

    sub = crashes[eligible & crashes["lon"].notna() & crashes["lat"].notna()]
    out = pd.Series(False, index=crashes.index)
    if sub.empty:
        return out
    key = sub["lon"].round(6).astype("string") + "," + sub["lat"].round(6).astype("string")
    stacks = (
        pd.DataFrame({"key": key, "lon": sub["lon"], "lat": sub["lat"], "county": sub["county"]})
        .groupby("key")
        .agg(n=("lon", "size"), lon=("lon", "first"), lat=("lat", "first"), counties=("county", "nunique"))
    )
    multi_county = stacks["counties"] >= DEFAULT_MIN_COUNTIES
    round_number = (stacks["n"] >= DEFAULT_ROUND_MIN_STACK) & np.array(
        [min(_decimals(a), _decimals(b)) <= 2 for a, b in zip(stacks["lon"], stacks["lat"])], dtype=bool
    )
    isolated = pd.Series(False, index=stacks.index)
    big = stacks[stacks["n"] >= ISOLATED_MIN_STACK]
    if len(big):
        pts = gpd.GeoSeries(gpd.points_from_xy(stacks["lon"], stacks["lat"]), crs=4326).to_crs(ANALYSIS_CRS).values
        tree = STRtree(pts)
        pos = {k: i for i, k in enumerate(stacks.index)}
        counts = stacks["n"].to_numpy()
        big_pts = pts[[pos[k] for k in big.index]]
        q_big, q_all = tree.query(big_pts, predicate="dwithin", distance=ISOLATION_RADIUS_M)
        around = np.bincount(q_big, weights=counts[q_all], minlength=len(big)) - big["n"].to_numpy()
        isolated.loc[big.index] = big["n"].to_numpy() > ISOLATED_RATIO * (around + 1)
    bad_keys = set(stacks.index[multi_county | round_number | isolated])
    out.loc[sub.index] = key.isin(bad_keys).to_numpy()
    return out


def quarantine_reasons(crashes: pd.DataFrame, snapshot: date) -> pd.Series:
    """Return the first failed rule for each crash ('' when the crash passes)."""
    reason = pd.Series("", index=crashes.index, dtype="string")

    def mark(mask: pd.Series, code: str) -> None:
        reason[(reason == "") & mask.fillna(False)] = code

    minx, miny, maxx, maxy = GEORGIA_BOUNDS
    mark(crashes["lon"].isna() | crashes["lat"].isna(), "no_coordinates")
    mark(crashes["geometry_source"] == COUNTY_CENTROID, "county_centroid")
    mark(~crashes["lon"].between(minx, maxx) | ~crashes["lat"].between(miny, maxy), "outside_georgia")
    has_xy = crashes["attr_x"].notna() & crashes["attr_y"].notna() & (crashes["attr_x"] != 0)
    disagree = ((crashes["attr_x"] - crashes["lon"]).abs() > XY_DISAGREEMENT_DEG) | (
        (crashes["attr_y"] - crashes["lat"]).abs() > XY_DISAGREEMENT_DEG
    )
    mark(has_xy & disagree, "xy_mismatch")

    mark(default_location_mask(crashes, reason == ""), "default_location")

    mark(crashes["crash_date"].isna(), "missing_date")
    future = pd.to_datetime(crashes["crash_date"], errors="coerce") > pd.Timestamp(snapshot)
    mark(future, "future_date")

    # Duplicates are judged only among otherwise-valid records so a bad copy
    # cannot cause a good copy to be dropped.
    candidates = reason == ""
    dup = crashes.loc[candidates].sort_values("source_oid").duplicated("crash_id", keep="first")
    mark(dup.reindex(crashes.index, fill_value=False), "duplicate_report")

    mark(crashes["location_of_impact"] == PRIVATE_PROPERTY, "private_property")
    return reason


def split_clean(crashes: pd.DataFrame, snapshot: date) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Return (clean, quarantined, summary)."""
    reasons = quarantine_reasons(crashes, snapshot)
    clean = crashes[reasons == ""].copy()
    quarantined = crashes[reasons != ""].assign(reason=reasons[reasons != ""])
    counts = quarantined["reason"].value_counts()
    summary = pd.DataFrame(
        {
            "reason": [r.reason for r in RULES],
            "description": [r.description for r in RULES],
            "records": [int(counts.get(r.reason, 0)) for r in RULES],
        }
    )
    return clean, quarantined, summary
