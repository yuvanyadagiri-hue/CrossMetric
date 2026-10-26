"""Per-school analysis packages (the data contract with the web app).

The TypeScript types for this format live in packages/engine/src/types.ts
(``SchoolPackage``). Bump PACKAGE_SCHEMA_VERSION when the shape changes.
"""

from __future__ import annotations

import json
import math
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

PACKAGE_SCHEMA_VERSION = 1

# Crash flags (bitmask) — must match CRASH_FLAG in packages/engine/src/types.ts
FLAG_INJURY = 1
FLAG_FATAL = 2
FLAG_PEDESTRIAN = 4
FLAG_BICYCLIST = 8
FLAG_LOW_LIGHT = 16

COLLISION_TYPES = [
    ("01-Angle", "Angle"),
    ("02-Head On", "Head-on"),
    ("03-Rear End", "Rear end"),
    ("04-Sideswipe-Same Direction", "Sideswipe, same direction"),
    ("05-Sideswipe-Opposite Direction", "Sideswipe, opposite direction"),
    ("06-Not A Collision with Motor Vehicle", "Not with another vehicle"),
]
COLLISION_CODE = {raw: i for i, (raw, _) in enumerate(COLLISION_TYPES)}
COLLISION_LABELS = [label for _, label in COLLISION_TYPES] + ["Not recorded"]

LIGHT_TYPES = [
    ("daylight", "Daylight"),
    ("dawn", "Dawn"),
    ("dusk", "Dusk"),
    ("dark_lighted", "Dark, lighted"),
    ("dark_unlighted", "Dark, not lighted"),
]
LIGHT_CODE = {raw: i for i, (raw, _) in enumerate(LIGHT_TYPES)}
LIGHT_LABELS = [label for _, label in LIGHT_TYPES] + ["Not recorded"]


def crash_flags(df: pd.DataFrame) -> np.ndarray:
    flags = np.zeros(len(df), dtype=int)
    flags |= np.where(df["injury_or_fatal"].to_numpy(dtype=bool), FLAG_INJURY, 0)
    flags |= np.where(df["fatal"].to_numpy(dtype=bool), FLAG_FATAL, 0)
    flags |= np.where(df["pedestrian"].to_numpy(dtype=bool), FLAG_PEDESTRIAN, 0)
    flags |= np.where(df["bicyclist"].to_numpy(dtype=bool), FLAG_BICYCLIST, 0)
    flags |= np.where(df["low_light"].to_numpy(dtype=bool), FLAG_LOW_LIGHT, 0)
    return flags


def _clean(value: Any) -> Any:
    """JSON-safe scalar: NaN/NA -> None, numpy -> python."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if value is pd.NA:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        f = float(value)
        return None if math.isnan(f) else f
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value


def _round_coords(coords, ndigits: int = 6):
    if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (list, tuple)):
        return [_round_coords(c, ndigits) for c in coords]
    return [round(float(c), ndigits) for c in coords]


def geometry_json(geom) -> dict[str, Any]:
    mapping = geom.__geo_interface__
    return {"type": mapping["type"], "coordinates": _round_coords(mapping["coordinates"])}


def school_record(s: pd.Series) -> dict[str, Any]:
    return {
        "id": s["school_id"],
        "name": s["name"],
        "district": _clean(s.get("district")),
        "city": _clean(s.get("city")),
        "county": _clean(s.get("county")),
        "street": _clean(s.get("street")),
        "zip": _clean(s.get("zip")),
        "level": _clean(s.get("level")),
        "gradeLow": _clean(s.get("grade_low")),
        "gradeHigh": _clean(s.get("grade_high")),
        "schoolType": _clean(s.get("school_type")),
        "schoolYear": _clean(s.get("school_year")),
        "lon": round(float(s["lon"]), 6),
        "lat": round(float(s["lat"]), 6),
    }


def candidate_record(c: pd.Series, distance_m: float) -> dict[str, Any]:
    return {
        "id": c["candidate_id"],
        "kind": c["kind"],
        "name": c["name"],
        "context": _clean(c["context"]),
        "roads": list(c["roads"]),
        "distanceM": round(float(distance_m), 1),
        "functionalClass": int(c["f_system"]),
        "lanes": _clean(c["lanes"]),
        "lengthM": None if _clean(c["length_m"]) is None else round(float(c["length_m"]), 1),
        "legs": _clean(c["legs"]),
        "signal": "gdot-permitted" if c["signalized"] is True else "no-record",
        "traffic": {
            "aadt": None if _clean(c["aadt"]) is None else int(round(float(c["aadt"]))),
            "year": _clean(c["aadt_year"]),
            "status": c["aadt_status"],
            "roadsCounted": int(c["aadt_roads_counted"]),
            "roadsTotal": int(c["aadt_roads_total"]),
        },
        "geometry": geometry_json(c["geometry_wgs84"]),
    }


def build_package(
    school: pd.Series,
    candidates: pd.DataFrame,
    distances: np.ndarray,
    crashes: pd.DataFrame,
    window_start: date,
    window_end: date,
    quality: dict[str, int],
    model_version: str,
    generated_at: str,
) -> dict[str, Any]:
    order = np.argsort(distances, kind="stable")
    candidates = candidates.iloc[order]
    distances = distances[order]
    index = {cid: i for i, cid in enumerate(candidates["candidate_id"])}
    crashes = crashes[crashes["candidate_id"].isin(index)].sort_values(["crash_date", "crash_id"])
    day = (pd.to_datetime(crashes["crash_date"]) - pd.Timestamp(window_start)).dt.days.to_numpy()
    return {
        "schemaVersion": PACKAGE_SCHEMA_VERSION,
        "modelVersion": model_version,
        "generatedAt": generated_at,
        "school": school_record(school),
        "window": {"start": window_start.isoformat(), "end": window_end.isoformat()},
        "candidates": [candidate_record(c, d) for (_, c), d in zip(candidates.iterrows(), distances)],
        "crashes": {
            "id": crashes["crash_id"].astype(str).tolist(),
            "candidate": [index[c] for c in crashes["candidate_id"]],
            "day": day.astype(int).tolist(),
            "flags": crash_flags(crashes).tolist(),
            "collision": [COLLISION_CODE.get(v, len(COLLISION_TYPES)) for v in crashes["collision_type"].fillna("")],
            "light": [LIGHT_CODE.get(v, len(LIGHT_TYPES)) for v in crashes["light"]],
            "lon": crashes["lon"].round(5).tolist(),
            "lat": crashes["lat"].round(5).tolist(),
        },
        "quality": quality,
    }


def write_json(path: Path, payload: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    path.write_text(text, encoding="utf-8")
    return len(text)
