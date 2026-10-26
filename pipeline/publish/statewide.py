"""Statewide indexes for CrossMetric's route intelligence and map layers.

The per-school packages (pipeline/run.py) only hold evidence within 1,200 m of
a school. Trips cross the whole state, so CrossScore needs statewide inputs:

    data/published/statewide/crashes.bin    every clean crash in the window
    data/published/statewide/roads.bin      GDOT major-road attributes (class, lanes, AADT)
    data/published/statewide/manifest.json  layouts, window, reference distributions, signals
    data/published/statewide/crash-grid.json  crash counts on a ~450 m grid (map layer)
    data/published/statewide/hin.json       ARC High Injury Network (map layer, not scored)
    data/published/statewide/transit.json   MARTA stops and rail lines (map layer)

Binary layouts are little-endian column blocks (all of column 1, then all of
column 2, ...) so the web server can wrap them in typed arrays without parsing.

    python -m pipeline.publish.statewide
"""

from __future__ import annotations

import json
import math
import time
from datetime import date, datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.ops import substring
from shapely.strtree import STRtree

from pipeline.config import ANALYSIS_CRS, CRASH_SNAP_TOLERANCE_M, INTERIM, PUBLISHED
from pipeline.geospatial.traffic import TrafficIndex
from pipeline.ingestion.reference_layers import AADT_TABLE, HIN_TABLE, SIGNALS_TABLE
from pipeline.ingestion.roads import ROLE_ACCESS_CONTROLLED, ROLE_CONNECTOR, ROLE_RAMP, ROLE_SURFACE, load_roads
from pipeline.ingestion.transit import build_transit
from pipeline.publish.package import crash_flags, write_json
from pipeline.run import BUILD_SUMMARY, CANDIDATES_TABLE, CRASHES_CLEAN_TABLE, log

OUT = PUBLISHED / "statewide"

# Crash flag set here in addition to the package flags (injury 1, fatal 2,
# pedestrian 4, bicyclist 8, low light 16): the crash's nearest road centerline
# (within 30 m) is an interstate/freeway mainline or a ramp.
FLAG_LIMITED_ACCESS = 32

# Same 30 m tolerance the school analysis uses to snap a crash to a road.
ROUTE_BUFFER_M = CRASH_SNAP_TOLERANCE_M

# Long GDOT sections are cut into pieces no longer than this before AADT is
# looked up, so a 10 km rural section does not carry one count end to end.
ROAD_PIECE_MAX_M = 400.0
ROAD_SIMPLIFY_M = 3.0

# Map grid: 0.005 deg longitude x 0.004 deg latitude is about 460 m x 445 m in Georgia.
GRID_DLON = 0.005
GRID_DLAT = 0.004

ROLE_CODE = {ROLE_SURFACE: 0, ROLE_ACCESS_CONTROLLED: 1, ROLE_RAMP: 2, ROLE_CONNECTOR: 3}

# Reference quantiles: 0, 0.5, 1, ... 100 (length-weighted).
QUANTILES = np.round(np.arange(0, 100.0001, 0.5), 1)


def _to_micro(values: np.ndarray) -> np.ndarray:
    return np.round(values * 1e6).astype("<i4")


def _segments(lines: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Explode lines into 2-point segments; returns (segments, index of the source line)."""
    coords, owner = shapely.get_coordinates(lines, return_index=True)
    same = owner[1:] == owner[:-1]
    starts = np.nonzero(same)[0]
    pairs = np.stack([coords[starts], coords[starts + 1]], axis=1)
    return shapely.linestrings(pairs), owner[starts]


def build_crash_index(clean: pd.DataFrame, roads: gpd.GeoDataFrame, window_start: date, t0: float) -> tuple[bytes, np.ndarray, np.ndarray]:
    pts = gpd.GeoSeries(gpd.points_from_xy(clean["lon"], clean["lat"]), crs=4326).to_crs(ANALYSIS_CRS).values
    # Two stages for speed: only crashes within 30 m of a freeway or ramp can be
    # "limited access"; for those, the nearest road of any kind decides. Trees
    # hold 2-point segments, not whole sections: long sections have huge
    # bounding boxes that make spatial queries slow.
    is_limited_road = roads["role"].isin([ROLE_ACCESS_CONTROLLED, ROLE_RAMP]).to_numpy()
    lim_segs, _ = _segments(roads.geometry.values[is_limited_road])
    near_limited = np.unique(STRtree(lim_segs).query(pts, predicate="dwithin", distance=ROUTE_BUFFER_M)[0])
    all_segs, owner = _segments(roads.geometry.values)
    sub_idx, seg_idx = STRtree(all_segs).query_nearest(pts[near_limited], max_distance=ROUTE_BUFFER_M, all_matches=False)
    limited = np.zeros(len(clean), dtype=bool)
    limited[near_limited[sub_idx]] = is_limited_road[owner[seg_idx]]
    log(f"crash index: {len(near_limited):,} crashes within {ROUTE_BUFFER_M:.0f} m of a freeway or ramp", t0)
    flags = crash_flags(clean) | np.where(limited, FLAG_LIMITED_ACCESS, 0)
    day = (pd.to_datetime(clean["crash_date"]) - pd.Timestamp(window_start)).dt.days.to_numpy()
    if day.min() < 0 or day.max() > 65535:
        raise ValueError("crash day offset out of uint16 range")
    blob = b"".join([
        _to_micro(clean["lon"].to_numpy()).tobytes(),
        _to_micro(clean["lat"].to_numpy()).tobytes(),
        day.astype("<u2").tobytes(),
        flags.astype("u1").tobytes(),
    ])
    log(f"crash index: {len(clean):,} crashes, {int(limited.sum()):,} on limited-access roads ({len(blob) / 1e6:.1f} MB)", t0)
    return blob, pts, flags


def _split(line, max_len: float) -> list:
    n = max(1, math.ceil(line.length / max_len))
    if n == 1:
        return [line]
    step = line.length / n
    return [substring(line, i * step, (i + 1) * step) for i in range(n)]


def build_road_index(roads: gpd.GeoDataFrame, t0: float) -> tuple[bytes, dict, gpd.GeoDataFrame]:
    """Major roads (functional class 1-6), multi-lane local roads and all ramps/connectors."""
    lanes = roads["lanes"].astype("float")
    keep = roads[(roads["f_system"] <= 6) | (lanes >= 3) | (roads["role"] != ROLE_SURFACE)].reset_index(drop=True)
    aadt = gpd.read_parquet(AADT_TABLE).to_crs(ANALYSIS_CRS)
    traffic = TrafficIndex(aadt)
    rows = []
    for r in keep.itertuples(index=False):
        geom = r.geometry
        if geom is None or geom.is_empty:
            continue
        for piece in _split(geom, ROAD_PIECE_MAX_M):
            if piece.length < 1:
                continue
            tv = traffic.for_segment(piece, str(r.route_key))
            rows.append((piece, int(r.f_system), r.lanes, ROLE_CODE.get(r.role, 0), tv.aadt))
    pieces = gpd.GeoDataFrame(
        {
            "f_system": [x[1] for x in rows],
            "lanes": [x[2] for x in rows],
            "role": [x[3] for x in rows],
            "aadt": [x[4] for x in rows],
        },
        geometry=[x[0] for x in rows],
        crs=ANALYSIS_CRS,
    )
    simplified = shapely.simplify(pieces.geometry.values, ROAD_SIMPLIFY_M)
    wgs = gpd.GeoSeries(simplified, crs=ANALYSIS_CRS).to_crs(4326).values
    coords_list = [np.asarray(g.coords) for g in wgs]
    counts = np.array([len(c) for c in coords_list], dtype="<u2")
    offsets = np.concatenate([[0], np.cumsum(counts[:-1], dtype=np.int64)]).astype("<u4")
    all_coords = np.concatenate(coords_list)
    lanes_u8 = pieces["lanes"].fillna(0).clip(0, 255).round().astype("u1").to_numpy()
    aadt_u4 = pieces["aadt"].fillna(0).clip(0, 4_000_000).round().astype("<u4").to_numpy()
    blob = b"".join([
        pieces["f_system"].astype("u1").to_numpy().tobytes(),
        lanes_u8.tobytes(),
        pieces["role"].astype("u1").to_numpy().tobytes(),
        aadt_u4.tobytes(),
        offsets.tobytes(),
        counts.tobytes(),
        _to_micro(all_coords[:, 0]).tobytes(),
        _to_micro(all_coords[:, 1]).tobytes(),
    ])
    layout = {"pieces": int(len(pieces)), "vertices": int(len(all_coords))}
    with_aadt = float((pieces["aadt"].notna() * pieces.geometry.length).sum() / pieces.geometry.length.sum())
    log(f"road index: {len(pieces):,} pieces, {len(all_coords):,} vertices, AADT on {with_aadt:.0%} of length ({len(blob) / 1e6:.1f} MB)", t0)
    layout["aadtLengthShare"] = round(with_aadt, 4)
    return blob, layout, pieces


def _weighted_quantiles(values: np.ndarray, weights: np.ndarray) -> list[float]:
    order = np.argsort(values, kind="stable")
    v = values[order]
    w = weights[order]
    cum = np.cumsum(w)
    cum = cum / cum[-1] * 100.0
    out = np.interp(QUANTILES, cum, v, left=v[0], right=v[-1])
    out[0] = v[0]
    return [round(float(x), 4) for x in out]


def _densities(lines: np.ndarray, crash_tree: STRtree, flags: np.ndarray, include: np.ndarray) -> dict[str, np.ndarray]:
    """Crashes per km within a flat-ended 30 m buffer of each line, by category."""
    buffers = shapely.buffer(lines, ROUTE_BUFFER_M, cap_style="flat")
    line_idx, crash_idx = crash_tree.query(buffers, predicate="intersects")
    ok = include[crash_idx]
    line_idx, crash_idx = line_idx[ok], crash_idx[ok]
    km = shapely.length(lines) / 1000.0
    f = flags[crash_idx]
    out = {}
    for key, mask in {
        "all": np.ones(len(f), dtype=bool),
        "injury": (f & 1) > 0,
        "pedestrian": (f & 4) > 0,
        "bicyclist": (f & 8) > 0,
    }.items():
        counts = np.bincount(line_idx[mask], minlength=len(lines))
        out[key] = counts / km
    return out


# Reference stretches are ~1 km, close to the scale of a real trip: shorter
# units are mostly zero-crash and would make any ordinary route look extreme.
REFERENCE_UNIT_M = 1000.0

# Setting = how busy the area around a point is: surface-street crashes in the
# 3 x 3 block of map-grid cells around it (about 1.4 km x 1.3 km, 3 years).
# Classes split Georgia's road mileage at the 50th, 75th, 90th and 97th
# percentiles of that activity, so a downtown walk is compared with other
# downtown streets rather than with rural roads.
ACTIVITY_SPLITS = (50.0, 75.0, 90.0, 97.0)
CONTEXTS = [
    ("quiet", "quieter areas"),
    ("moderate", "moderately busy areas"),
    ("busy", "busy areas"),
    ("veryBusy", "very busy areas"),
    ("urbanCore", "dense urban cores"),
]


def _grid_counts(lon: np.ndarray, lat: np.ndarray) -> dict[tuple[int, int], int]:
    gx = np.floor(lon / GRID_DLON).astype(np.int64)
    gy = np.floor(lat / GRID_DLAT).astype(np.int64)
    s = pd.Series(1, index=pd.MultiIndex.from_arrays([gx, gy])).groupby(level=[0, 1]).sum()
    return {(int(a), int(b)): int(v) for (a, b), v in s.items()}


def activity_at(grid: dict[tuple[int, int], int], lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    gx = np.floor(lon / GRID_DLON).astype(np.int64)
    gy = np.floor(lat / GRID_DLAT).astype(np.int64)
    out = np.zeros(len(lon), dtype=np.int64)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            out += np.array([grid.get((int(x) + dx, int(y) + dy), 0) for x, y in zip(gx, gy)], dtype=np.int64)
    return out


def _units(lines: np.ndarray) -> np.ndarray:
    out = []
    for g in lines:
        if g is None or g.is_empty:
            continue
        n = max(1, round(g.length / REFERENCE_UNIT_M))
        out.extend(p for p in _split(g, g.length / n + 1e-6) if p.length >= 1)
    return np.array(out, dtype=object)


def build_references(clean: pd.DataFrame, crash_pts: np.ndarray, flags: np.ndarray, roads: gpd.GeoDataFrame, t0: float) -> dict:
    crash_tree = STRtree(crash_pts)
    limited = (flags & FLAG_LIMITED_ACCESS) > 0
    grid = _grid_counts(clean["lon"].to_numpy()[~limited], clean["lat"].to_numpy()[~limited])

    surface_units = _units(roads[roads["role"] == ROLE_SURFACE].geometry.values)
    lengths = shapely.length(surface_units)
    mids = gpd.GeoSeries(shapely.line_interpolate_point(surface_units, 0.5, normalized=True), crs=ANALYSIS_CRS).to_crs(4326)
    activity = activity_at(grid, mids.x.to_numpy(), mids.y.to_numpy())
    order = np.argsort(activity, kind="stable")
    cum = np.cumsum(lengths[order]) / lengths.sum() * 100
    thresholds = [int(activity[order][np.searchsorted(cum, q)]) for q in ACTIVITY_SPLITS]
    cls = np.searchsorted(np.array(thresholds), activity, side="right")
    densities = _densities(surface_units, crash_tree, flags, ~limited)
    log(f"references: {len(surface_units):,} surface stretches; activity thresholds {thresholds}", t0)

    contexts = {}
    for k, (cid, label) in enumerate(CONTEXTS):
        m = cls == k
        km = lengths[m].sum() / 1000
        contexts[cid] = {
            "label": label,
            "units": int(m.sum()),
            "km": round(float(km), 1),
            # Average crashes per km = all crashes on these stretches / their total length.
            "mean": {cat: round(float((v[m] * lengths[m] / 1000).sum() / km), 5) for cat, v in densities.items()},
            "quantiles": {cat: _weighted_quantiles(v[m], lengths[m]) for cat, v in densities.items()},
        }
        q = contexts[cid]["quantiles"]
        mean = contexts[cid]["mean"]
        log(f"  {cid:9s} {contexts[cid]['km']:>9,.0f} km  mean all={mean['all']:.2f} injury={mean['injury']:.2f} "
            f"ped={mean['pedestrian']:.3f} bike={mean['bicyclist']:.3f} per km; all p90={q['all'][180]:.2f}", t0)

    fw_units = _units(roads[roads["role"] == ROLE_ACCESS_CONTROLLED].geometry.values)
    fw_len = shapely.length(fw_units)
    fw = _densities(fw_units, crash_tree, flags, limited)
    fw_km = fw_len.sum() / 1000
    contexts["freeway"] = {
        "label": "Georgia interstates and freeways",
        "units": int(len(fw_units)),
        "km": round(float(fw_km), 1),
        "mean": {cat: round(float((v * fw_len / 1000).sum() / fw_km), 5) for cat, v in fw.items()},
        "quantiles": {cat: _weighted_quantiles(v, fw_len) for cat, v in fw.items()},
    }
    return {
        "levels": QUANTILES.tolist(),
        "bufferM": ROUTE_BUFFER_M,
        "unit": "crashes per km over the analysis window",
        "population": "Georgia public roads in the GDOT Road Inventory, cut into ~1 km stretches",
        "activity": {"cell": {"dLon": GRID_DLON, "dLat": GRID_DLAT}, "neighborhood": 3, "thresholds": thresholds,
                     "definition": "Surface-street crashes in the 3 x 3 block of grid cells around a point (about 1.4 x 1.3 km) over the data window"},
        "contexts": contexts,
    }


def build_crash_grid(clean: pd.DataFrame, flags: np.ndarray) -> dict:
    gx = np.floor(clean["lon"].to_numpy() / GRID_DLON).astype(np.int64)
    gy = np.floor(clean["lat"].to_numpy() / GRID_DLAT).astype(np.int64)
    df = pd.DataFrame({
        "gx": gx, "gy": gy,
        "all": 1,
        "surface": ((flags & FLAG_LIMITED_ACCESS) == 0).astype(int),
        "injury": ((flags & 1) > 0).astype(int),
        "pedestrian": ((flags & 4) > 0).astype(int),
        "bicyclist": ((flags & 8) > 0).astype(int),
    })
    g = df.groupby(["gx", "gy"], sort=True).sum().reset_index()
    return {
        "cell": {"dLon": GRID_DLON, "dLat": GRID_DLAT},
        "lon": np.round((g["gx"] + 0.5) * GRID_DLON, 5).tolist(),
        "lat": np.round((g["gy"] + 0.5) * GRID_DLAT, 5).tolist(),
        "gx": g["gx"].astype(int).tolist(),
        "gy": g["gy"].astype(int).tolist(),
        "all": g["all"].astype(int).tolist(),
        "surface": g["surface"].astype(int).tolist(),
        "injury": g["injury"].astype(int).tolist(),
        "pedestrian": g["pedestrian"].astype(int).tolist(),
        "bicyclist": g["bicyclist"].astype(int).tolist(),
    }


def build_hin() -> dict:
    hin = gpd.read_parquet(HIN_TABLE).to_crs(ANALYSIS_CRS)
    hin["geometry"] = shapely.simplify(hin.geometry.values, 8.0)
    hin = hin.to_crs(4326)
    features = []
    for r in hin.itertuples(index=False):
        g = r.geometry
        if g is None or g.is_empty:
            continue
        parts = list(shapely.get_parts(g)) if g.geom_type.startswith("Multi") else [g]
        for p in parts:
            features.append({
                "type": "Feature",
                "properties": {"severity": round(float(r.severity_score), 2) if pd.notna(r.severity_score) else None},
                "geometry": {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in p.coords]},
            })
    return {"type": "FeatureCollection", "features": features}


def main(references_only: bool = False) -> None:
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    summary = json.loads(BUILD_SUMMARY.read_text(encoding="utf-8"))
    window_start = date.fromisoformat(summary["windowStart"])
    clean = pd.read_parquet(
        CRASHES_CLEAN_TABLE,
        columns=["lon", "lat", "crash_date", "injury_or_fatal", "fatal", "pedestrian", "bicyclist", "low_light"],
    )
    roads = load_roads()
    log(f"inputs: {len(clean):,} crashes, {len(roads):,} road sections", t0)

    crash_blob, crash_pts, flags = build_crash_index(clean, roads, window_start, t0)
    if references_only:
        manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
        manifest["references"] = build_references(clean, crash_pts, flags, roads, t0)
        write_json(OUT / "manifest.json", manifest)
        log("reference distributions updated", t0)
        return
    (OUT / "crashes.bin").write_bytes(crash_blob)

    road_blob, road_layout, _ = build_road_index(roads, t0)
    (OUT / "roads.bin").write_bytes(road_blob)

    references = build_references(clean, crash_pts, flags, roads, t0)

    signals = gpd.read_parquet(SIGNALS_TABLE)
    signals = signals[signals["status"] != "Out of Service"].to_crs(4326)
    signal_coords = [[round(p.x, 6), round(p.y, 6)] for p in signals.geometry.values if p is not None and not p.is_empty]

    write_json(OUT / "crash-grid.json", build_crash_grid(clean, flags))
    write_json(OUT / "hin.json", build_hin())
    transit = build_transit()
    write_json(OUT / "transit.json", transit)
    log("map layers written (crash grid, HIN, transit)", t0)

    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "window": {"start": summary["windowStart"], "end": summary["windowEnd"]},
        "crashes": {
            "file": "crashes.bin",
            "count": int(len(clean)),
            "layout": ["lon:int32e6", "lat:int32e6", "day:uint16", "flags:uint8"],
            "flags": {"injury": 1, "fatal": 2, "pedestrian": 4, "bicyclist": 8, "lowLight": 16, "limitedAccess": FLAG_LIMITED_ACCESS},
        },
        "roads": {
            "file": "roads.bin",
            **road_layout,
            "layout": ["fSystem:uint8", "lanes:uint8", "role:uint8", "aadt:uint32", "vertexOffset:uint32", "vertexCount:uint16", "lon:int32e6", "lat:int32e6"],
            "roles": {"surface": 0, "accessControlled": 1, "ramp": 2, "connector": 3},
            "selection": "Functional class 1-6, any road with 3+ through lanes, and all ramps/connectors (GDOT Road Inventory 2025)",
        },
        "signals": signal_coords,
        "references": references,
        "transit": {"agency": transit["agency"], "feedDate": transit["feedDate"], "stops": len(transit["stops"]["id"])},
    }
    write_json(OUT / "manifest.json", manifest)
    log("statewide indexes complete", t0)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--references-only", action="store_true", help="recompute only the reference distributions in manifest.json")
    main(references_only=ap.parse_args().references_only)
