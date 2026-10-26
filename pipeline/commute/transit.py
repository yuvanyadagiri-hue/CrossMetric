"""Compact transit timetables for arrive-by planning.

Networks:
    gt   MARTA (rail and bus). GT Stinger has no current public GTFS, so it is not included.
    uga  UGA Campus Transit (Passio) + Athens-Clarke County Transit.

Each network becomes data/published/commute/transit-<network>.json:

    stops      parallel arrays (id, name, lon, lat, feed, wheelchair, parent)
                 wheelchair: GTFS wheelchair_boarding (1 accessible, 2 not, 0 no information),
                 inherited from the parent station when the platform says 0
                 parent: the parent station id ("" when none)
    stations   parallel arrays (id, name, lon, lat) of parent stations (e.g. MARTA rail stations)
    routes     short/long name, colour, type, feed
    services   weekly pattern, date range, added/removed dates per GTFS service
    patterns   one per distinct stop sequence of a route:
                 stops     stop indexes
                 profiles  distinct running-time profiles [arr0, dep0, arr1, dep1, ...] in seconds from the trip start
                 trips     [start_seconds, profile, service, headway_seconds] sorted by start
                           headway > 0 marks a trip expanded from frequencies.txt without exact
                           times: the bus runs about every `headway` seconds, not to the minute.
                 shape     simplified [lon, lat] line, and stopDist (metres along it per stop)
                 access    GTFS wheelchair_accessible shared by every trip of the pattern
                           (1 accessible, 2 not, 0 no information); trips are split by it
    footpaths  [from, to, metres] between boarding stops up to 250 m apart (straight line)

Times keep GTFS semantics: seconds after "noon minus 12 h" of the service day, so
times past 24:00:00 stay on the day the trip started.

    python -m pipeline.commute.transit
"""

from __future__ import annotations

import io
import json
import math
import zipfile
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from shapely.geometry import LineString, Point

from pipeline.config import PUBLISHED, RAW

OUT = PUBLISHED / "commute"

FEEDS = {
    "marta": {"zip": RAW / "marta_gtfs" / "google_transit.zip", "url": "https://www.itsmarta.com/google_transit_feed/google_transit.zip", "name": "MARTA", "tracker": "https://www.itsmarta.com/"},
    "uga": {"zip": RAW / "uga_gtfs" / "google_transit.zip", "url": "https://passio3.com/uga/passioTransit/gtfs/google_transit.zip", "name": "UGA Campus Transit", "tracker": "https://routes.uga.edu/"},
    "acc": {"zip": RAW / "acc_gtfs" / "google_transit.zip", "url": "https://bustracker.accgov.com/InfoPoint/GTFS-Zip.ashx", "name": "Athens-Clarke County Transit", "tracker": "https://bustracker.accgov.com/InfoPoint/"},
}
NETWORKS = {"gt": ["marta"], "uga": ["uga", "acc"]}

FOOTPATH_MAX_M = 250.0
SHAPE_SIMPLIFY_DEG = 0.00004  # ~4 m


def _download(feed: dict) -> None:
    import requests

    if feed["zip"].exists():
        return
    feed["zip"].parent.mkdir(parents=True, exist_ok=True)
    resp = requests.get(feed["url"], timeout=300, headers={"User-Agent": "CrossMetric data pipeline"})
    resp.raise_for_status()
    feed["zip"].write_bytes(resp.content)


def _read(zf: zipfile.ZipFile, name: str) -> pd.DataFrame | None:
    if name not in zf.namelist():
        return None
    with zf.open(name) as f:
        df = pd.read_csv(io.TextIOWrapper(f, encoding="utf-8-sig"), dtype=str, keep_default_na=False)
    df.columns = [c.strip() for c in df.columns]
    return df.apply(lambda s: s.str.strip())


def _secs(v: pd.Series) -> pd.Series:
    parts = v.str.split(":", expand=True)
    ok = v != ""
    out = pd.Series(np.nan, index=v.index)
    out[ok] = parts.loc[ok, 0].astype(int) * 3600 + parts.loc[ok, 1].astype(int) * 60 + parts.loc[ok, 2].astype(int)
    return out


def _metres(lon1, lat1, lon2, lat2) -> np.ndarray:
    k = np.cos(np.radians((np.asarray(lat1) + np.asarray(lat2)) / 2))
    return np.hypot((np.asarray(lon2) - np.asarray(lon1)) * k, np.asarray(lat2) - np.asarray(lat1)) * 111_195.0


def _interpolate(st: pd.DataFrame) -> pd.DataFrame:
    """Fill missing stop times linearly between timepoints, by shape distance when present, else by stop order."""
    st = st.sort_values(["trip_id", "seq"]).copy()
    dist = pd.to_numeric(st.get("shape_dist_traveled", pd.Series("", index=st.index)), errors="coerce")
    st["x"] = dist.where(dist.notna(), st["seq"].astype(float))
    for col in ("arr", "dep"):
        filled = []
        for _, g in st.groupby("trip_id", sort=False):
            y = g[col].to_numpy(dtype=float)
            x = g["x"].to_numpy(dtype=float)
            known = ~np.isnan(y)
            if known.sum() >= 2 and not known.all():
                y = y.copy()
                y[~known] = np.interp(x[~known], x[known], y[known])
            filled.append(pd.Series(y, index=g.index))
        st[col] = pd.concat(filled)
    st["arr"] = st["arr"].fillna(st["dep"])
    st["dep"] = st["dep"].fillna(st["arr"])
    return st.dropna(subset=["arr", "dep"])


def _load_feed(fid: str) -> dict:
    feed = FEEDS[fid]
    _download(feed)
    zf = zipfile.ZipFile(feed["zip"])
    info = _read(zf, "feed_info.txt")
    stops = _read(zf, "stops.txt")
    routes = _read(zf, "routes.txt")
    trips = _read(zf, "trips.txt")
    st = _read(zf, "stop_times.txt")
    cal = _read(zf, "calendar.txt")
    cal_dates = _read(zf, "calendar_dates.txt")
    freqs = _read(zf, "frequencies.txt")
    shapes = _read(zf, "shapes.txt")

    st = st.rename(columns={"stop_sequence": "seq"})
    st["seq"] = st["seq"].astype(int)
    st["arr"] = _secs(st["arrival_time"])
    st["dep"] = _secs(st["departure_time"])
    if st["arr"].isna().any() or st["dep"].isna().any():
        st = _interpolate(st)
    st = st.sort_values(["trip_id", "seq"])
    stamp = datetime(*zf.getinfo("stops.txt").date_time).date().isoformat()
    meta = {
        "id": fid,
        "name": feed["name"],
        "url": feed["url"],
        "tracker": feed["tracker"],
        "fileDate": stamp,
        "feedStart": info["feed_start_date"].iloc[0] if info is not None and "feed_start_date" in info else None,
        "feedEnd": info["feed_end_date"].iloc[0] if info is not None and "feed_end_date" in info else None,
        "calendarDates": cal_dates is not None and len(cal_dates) > 0,
        "frequencyBased": freqs is not None and len(freqs) > 0,
    }
    return {"meta": meta, "stops": stops, "routes": routes, "trips": trips, "st": st, "cal": cal, "cal_dates": cal_dates, "freqs": freqs, "shapes": shapes}


def _services(fid: str, cal: pd.DataFrame | None, cal_dates: pd.DataFrame | None) -> dict:
    out: dict[str, dict] = {}
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    if cal is not None:
        for _, r in cal.iterrows():
            out[f"{fid}:{r['service_id']}"] = {"days": [int(r[d]) for d in days], "start": r["start_date"], "end": r["end_date"], "added": [], "removed": []}
    if cal_dates is not None:
        for _, r in cal_dates.iterrows():
            key = f"{fid}:{r['service_id']}"
            svc = out.setdefault(key, {"days": [0] * 7, "start": None, "end": None, "added": [], "removed": []})
            (svc["added"] if r["exception_type"] == "1" else svc["removed"]).append(r["date"])
    return out


def _shape_index(shapes: pd.DataFrame | None) -> dict[str, list[tuple[float, float]]]:
    if shapes is None:
        return {}
    s = shapes.assign(seq=shapes["shape_pt_sequence"].astype(int), x=shapes["shape_pt_lon"].astype(float), y=shapes["shape_pt_lat"].astype(float))
    s = s.sort_values(["shape_id", "seq"])
    return {sid: list(zip(g["x"], g["y"])) for sid, g in s.groupby("shape_id", sort=False)}


def _shape_for(shapes: dict[str, list[tuple[float, float]]], shape_id: str, stop_pts: list[tuple[float, float]]) -> tuple[list, list]:
    pts = shapes.get(shape_id or "", [])
    if len(pts) >= 2:
        line = LineString(pts)
    else:
        line = LineString(stop_pts) if len(stop_pts) > 1 else None
    if line is None:
        return [], []
    line = line.simplify(SHAPE_SIMPLIFY_DEG, preserve_topology=False)
    coords = list(line.coords)
    lat0 = coords[0][1]
    k = math.cos(math.radians(lat0)) * 111_195.0
    # Distance along the line for each stop, forced to be non-decreasing (loops revisit the same streets).
    dists = []
    last = 0.0
    for lon, lat in stop_pts:
        d = line.project(Point(lon, lat))
        if d < last:
            # Search forward of the previous stop for loop routes.
            d = last
        dists.append(d)
        last = d
    return [[round(x, 5), round(y, 5)] for x, y in coords], [round(d * k, 1) for d in dists]


def build_network(network: str) -> dict:
    stops_out = {"id": [], "name": [], "lon": [], "lat": [], "feed": [], "wheelchair": [], "parent": []}
    stations_out = {"id": [], "name": [], "lon": [], "lat": []}
    stop_index: dict[str, int] = {}
    routes_out: list[dict] = []
    services: dict[str, dict] = {}
    patterns: list[dict] = []
    feeds_meta = []
    service_index: dict[str, int] = {}

    for fid in NETWORKS[network]:
        f = _load_feed(fid)
        feeds_meta.append(f["meta"])
        services.update(_services(fid, f["cal"], f["cal_dates"]))
        stops = f["stops"]
        loc = stops.get("location_type", pd.Series("", index=stops.index))
        boarding = stops[loc.isin(["", "0"])]
        wheel = stops.get("wheelchair_boarding", pd.Series("", index=stops.index))
        parents = stops.get("parent_station", pd.Series("", index=stops.index))
        station_rows = stops[loc == "1"]
        parent_wheel = {r["stop_id"]: wheel.loc[i] for i, r in station_rows.iterrows()}
        for _, r in station_rows.iterrows():
            stations_out["id"].append(f"{fid}:{r['stop_id']}")
            stations_out["name"].append(r["stop_name"])
            stations_out["lon"].append(round(float(r["stop_lon"]), 6))
            stations_out["lat"].append(round(float(r["stop_lat"]), 6))
        for i, s in boarding.iterrows():
            stop_index[f"{fid}:{s['stop_id']}"] = len(stops_out["id"])
            stops_out["id"].append(f"{fid}:{s['stop_id']}")
            stops_out["name"].append(s["stop_name"])
            stops_out["lon"].append(round(float(s["stop_lon"]), 6))
            stops_out["lat"].append(round(float(s["stop_lat"]), 6))
            stops_out["feed"].append(fid)
            parent = parents.loc[i] or ""
            w = wheel.loc[i] or "0"
            # GTFS: a platform with 0 inherits its parent station's value.
            if w == "0" and parent:
                w = parent_wheel.get(parent, "0") or "0"
            stops_out["wheelchair"].append(int(w) if w in ("0", "1", "2") else 0)
            stops_out["parent"].append(f"{fid}:{parent}" if parent else "")

        route_idx: dict[str, int] = {}
        for _, r in f["routes"].iterrows():
            route_idx[r["route_id"]] = len(routes_out)
            routes_out.append(
                {
                    "id": f"{fid}:{r['route_id']}",
                    "feed": fid,
                    "short": r.get("route_short_name", "") or "",
                    "long": r.get("route_long_name", "") or "",
                    "color": "#" + (r.get("route_color") or "2855D9"),
                    "text": "#" + (r.get("route_text_color") or "FFFFFF"),
                    "type": int(r.get("route_type") or 3),
                }
            )

        trips = f["trips"].set_index("trip_id")
        shape_index = _shape_index(f["shapes"])
        st = f["st"]
        st = st[st["stop_id"].map(lambda x: f"{fid}:{x}" in stop_index)]
        freqs = f["freqs"]
        freq_by_trip: dict[str, list[tuple[int, int, int, bool]]] = {}
        if freqs is not None:
            for _, r in freqs.iterrows():
                start = int(_secs(pd.Series([r["start_time"]])).iloc[0])
                end = int(_secs(pd.Series([r["end_time"]])).iloc[0])
                exact = (r.get("exact_times") or "0") == "1"
                freq_by_trip.setdefault(r["trip_id"], []).append((start, end, int(r["headway_secs"]), exact))

        by_key: dict[tuple, dict] = {}
        for trip_id, g in st.groupby("trip_id", sort=False):
            if trip_id not in trips.index:
                continue
            t = trips.loc[trip_id]
            stop_ids = tuple(stop_index[f"{fid}:{x}"] for x in g["stop_id"])
            if len(stop_ids) < 2:
                continue
            wc = str(t.get("wheelchair_accessible", "") or "0")
            wc = int(wc) if wc in ("0", "1", "2") else 0
            key = (fid, t["route_id"], stop_ids, wc)
            pat = by_key.get(key)
            if pat is None:
                pts = [(stops_out["lon"][i], stops_out["lat"][i]) for i in stop_ids]
                shape, stop_dist = _shape_for(shape_index, t.get("shape_id", ""), pts)
                pat = {
                    "route": route_idx[t["route_id"]],
                    "stops": list(stop_ids),
                    "headsign": t.get("trip_headsign", "") or "",
                    "profiles": [],
                    "_profiles": {},
                    "trips": [],
                    "shape": shape,
                    "stopDist": stop_dist,
                    "access": wc,
                }
                by_key[key] = pat
            arr = g["arr"].to_numpy(dtype=float)
            dep = g["dep"].to_numpy(dtype=float)
            t0 = dep[0]
            prof = tuple(int(round(v)) for pair in zip(arr - t0, dep - t0) for v in pair)
            p_idx = pat["_profiles"].get(prof)
            if p_idx is None:
                p_idx = len(pat["profiles"])
                pat["_profiles"][prof] = p_idx
                pat["profiles"].append(list(prof))
            svc_key = f"{fid}:{t['service_id']}"
            s_idx = service_index.setdefault(svc_key, len(service_index))
            windows = freq_by_trip.get(trip_id)
            if windows:
                for start, end, headway, exact in windows:
                    dep_t = start
                    while dep_t < end:
                        pat["trips"].append([dep_t, p_idx, s_idx, 0 if exact else headway])
                        dep_t += headway
            else:
                pat["trips"].append([int(round(t0)), p_idx, s_idx, 0])
        for pat in by_key.values():
            del pat["_profiles"]
            pat["trips"].sort()
            patterns.append(pat)

    # Footpaths between nearby boarding stops (straight-line metres; the app applies a detour factor).
    lon = np.array(stops_out["lon"])
    lat = np.array(stops_out["lat"])
    cell = 0.003
    grid: dict[tuple[int, int], list[int]] = {}
    for i, (x, y) in enumerate(zip(lon, lat)):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(i)
    foot = []
    for i, (x, y) in enumerate(zip(lon, lat)):
        cx, cy = int(x // cell), int(y // cell)
        cand = [j for dx in (-1, 0, 1) for dy in (-1, 0, 1) for j in grid.get((cx + dx, cy + dy), []) if j != i]
        if not cand:
            continue
        d = _metres(x, y, lon[cand], lat[cand])
        for j, m in zip(cand, d):
            if m <= FOOTPATH_MAX_M:
                foot.append([i, int(j), round(float(m), 1)])

    svc_list = [None] * len(service_index)
    for key, idx in service_index.items():
        svc = services.get(key, {"days": [0] * 7, "start": None, "end": None, "added": [], "removed": []})
        svc_list[idx] = {"id": key, **svc}
    return {
        "network": network,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "feeds": feeds_meta,
        "stops": stops_out,
        "stations": stations_out,
        "routes": routes_out,
        "services": svc_list,
        "patterns": patterns,
        "footpaths": foot,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for network in NETWORKS:
        doc = build_network(network)
        path = OUT / f"transit-{network}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        n_trips = sum(len(p["trips"]) for p in doc["patterns"])
        print(f"{network}: {len(doc['stops']['id'])} stops, {len(doc['patterns'])} patterns, {n_trips} trips, {len(doc['footpaths'])} footpaths, {path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
