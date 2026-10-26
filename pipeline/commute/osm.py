"""Small Overpass API client with retries and an on-disk cache.

Queries are cached in data/raw/osm/ by content hash, so rebuilding the campus
files does not hit the public Overpass servers again. Delete the cache folder
to refresh from OpenStreetMap.
"""

from __future__ import annotations

import hashlib
import json
import time

import requests

from pipeline.config import RAW

CACHE = RAW / "osm"
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "CrossMetric data pipeline (student commuter project)"


def query(ql: str) -> dict:
    """Run an Overpass QL query (JSON output). Returns the parsed response with `osm3s` timestamps."""
    key = hashlib.sha256(ql.encode()).hexdigest()[:24]
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    last = ""
    for attempt in range(8):
        endpoint = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            resp = requests.post(endpoint, data={"data": ql}, headers={"User-Agent": USER_AGENT}, timeout=240)
            if resp.status_code == 200 and resp.text.lstrip().startswith("{"):
                data = resp.json()
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data), encoding="utf-8")
                return data
            last = f"{endpoint}: HTTP {resp.status_code} {resp.text[:160]!r}"
        except requests.RequestException as err:
            last = f"{endpoint}: {err}"
        time.sleep(6 * (attempt + 1))
    raise RuntimeError(f"Overpass query failed: {last}")


def area_id(ref: str) -> int:
    """Overpass area id for an OSM way or relation reference like 'relation/3341535'."""
    kind, num = ref.split("/")
    return (3600000000 if kind == "relation" else 2400000000) + int(num)
