"""MARTA transit stops and rail lines from the agency's public GTFS feed.

Used for the map's transit layer and to show which stops are near a trip's
origin and destination. CrossMetric does not compute transit schedules or
trip times.

    python -m pipeline.ingestion.transit
"""

from __future__ import annotations

import io
import zipfile
from datetime import datetime

import pandas as pd
import requests

from pipeline.config import RAW

GTFS_URL = "https://www.itsmarta.com/google_transit_feed/google_transit.zip"
GTFS_ZIP = RAW / "marta_gtfs" / "google_transit.zip"

RAIL_ROUTE_TYPES = {0, 1, 2}  # tram/streetcar, subway/metro, rail


def _zip() -> zipfile.ZipFile:
    if not GTFS_ZIP.exists():
        GTFS_ZIP.parent.mkdir(parents=True, exist_ok=True)
        resp = requests.get(GTFS_URL, timeout=300, headers={"User-Agent": "CrossMetric data pipeline"})
        resp.raise_for_status()
        GTFS_ZIP.write_bytes(resp.content)
    return zipfile.ZipFile(GTFS_ZIP)


def _read(zf: zipfile.ZipFile, name: str, usecols: list[str] | None = None) -> pd.DataFrame:
    with zf.open(name) as f:
        return pd.read_csv(io.TextIOWrapper(f, encoding="utf-8-sig"), dtype=str, usecols=usecols)


def build_transit() -> dict:
    zf = _zip()
    feed_date = datetime(*zf.getinfo("stops.txt").date_time).date().isoformat()
    agency = _read(zf, "agency.txt")
    routes = _read(zf, "routes.txt", ["route_id", "route_short_name", "route_long_name", "route_type", "route_color"])
    routes["route_type"] = routes["route_type"].astype(int)
    trips = _read(zf, "trips.txt", ["route_id", "trip_id", "shape_id"])
    stop_times = _read(zf, "stop_times.txt", ["trip_id", "stop_id"])
    stops = _read(zf, "stops.txt", ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station", "wheelchair_boarding"])

    # Which routes serve each boarding stop.
    served = (
        stop_times.drop_duplicates(["trip_id", "stop_id"])
        .merge(trips[["trip_id", "route_id"]], on="trip_id")
        .merge(routes[["route_id", "route_short_name", "route_type"]], on="route_id")
        .drop_duplicates(["stop_id", "route_id"])
    )
    by_stop = served.groupby("stop_id").agg(
        routes=("route_short_name", lambda s: sorted(set(s), key=lambda x: (len(x), x))),
        rail=("route_type", lambda t: bool(set(t) & RAIL_ROUTE_TYPES)),
    )
    boarding = stops[stops["location_type"].fillna("0").isin(["0", ""])].merge(by_stop, left_on="stop_id", right_index=True)
    boarding = boarding.sort_values("stop_id").reset_index(drop=True)

    # Rail lines as GeoJSON, one longest shape per rail route.
    rail_routes = routes[routes["route_type"].isin(RAIL_ROUTE_TYPES)]
    rail_shapes = trips[trips["route_id"].isin(rail_routes["route_id"])].drop_duplicates("shape_id")
    shapes = _read(zf, "shapes.txt", ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"])
    shapes = shapes[shapes["shape_id"].isin(rail_shapes["shape_id"])].copy()
    shapes["seq"] = shapes["shape_pt_sequence"].astype(int)
    features = []
    for route_id, group in rail_shapes.groupby("route_id"):
        best = None
        for shape_id in group["shape_id"]:
            pts = shapes[shapes["shape_id"] == shape_id].sort_values("seq")
            if best is None or len(pts) > len(best):
                best = pts
        if best is None or best.empty:
            continue
        r = rail_routes[rail_routes["route_id"] == route_id].iloc[0]
        coords = [[round(float(lon), 5), round(float(lat), 5)] for lat, lon in zip(best["shape_pt_lat"], best["shape_pt_lon"])]
        features.append({
            "type": "Feature",
            "properties": {"route": r["route_short_name"] or r["route_long_name"], "name": r["route_long_name"], "color": f"#{r['route_color']}"},
            "geometry": {"type": "LineString", "coordinates": coords},
        })

    print(f"MARTA GTFS ({feed_date}): {len(boarding):,} boarding stops, {int(boarding['rail'].sum())} rail platforms, {len(features)} rail lines")
    return {
        "agency": agency.iloc[0]["agency_name"],
        "agencyUrl": agency.iloc[0]["agency_url"],
        "feedDate": feed_date,
        "source": GTFS_URL,
        "stops": {
            "id": boarding["stop_id"].tolist(),
            "name": boarding["stop_name"].str.title().str.replace(r"\b(Ne|Nw|Se|Sw|Marta)\b", lambda m: m.group(1).upper(), regex=True).tolist(),
            "lon": boarding["stop_lon"].astype(float).round(6).tolist(),
            "lat": boarding["stop_lat"].astype(float).round(6).tolist(),
            "rail": boarding["rail"].astype(bool).tolist(),
            "wheelchair": (boarding["wheelchair_boarding"].fillna("0") == "1").tolist(),
            "routes": boarding["routes"].tolist(),
        },
        "railLines": {"type": "FeatureCollection", "features": features},
    }


if __name__ == "__main__":
    data = build_transit()
    print(data["stops"]["name"][:5])
