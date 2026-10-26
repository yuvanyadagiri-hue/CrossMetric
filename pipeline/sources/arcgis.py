"""Minimal ArcGIS REST client with schema validation.

Every external layer CrossMetric reads is described by a ``LayerSpec`` that
lists the fields the pipeline depends on and their expected Esri types. Before
any data is used, ``validate_schema`` compares that expectation with the live
service metadata. A renamed field, a changed type or a missing field stops the
pipeline with a clear message instead of silently producing wrong numbers.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

USER_AGENT = "CrossMetric/1.0 (Congressional App Challenge student project; school-road safety analysis)"


@dataclass(frozen=True)
class FieldSpec:
    name: str
    esri_type: str  # e.g. "esriFieldTypeString"


@dataclass(frozen=True)
class LayerSpec:
    key: str
    title: str
    publisher: str
    url: str
    geometry_type: str
    fields: tuple[FieldSpec, ...]
    oid_field: str = "OBJECTID"


@dataclass
class SchemaReport:
    layer_key: str
    ok: bool
    missing: list[str] = field(default_factory=list)
    type_mismatches: list[str] = field(default_factory=list)
    geometry_mismatch: str | None = None
    unexpected: list[str] = field(default_factory=list)

    def describe(self) -> str:
        parts = [f"[{self.layer_key}] schema {'OK' if self.ok else 'INVALID'}"]
        if self.missing:
            parts.append(f"missing fields: {', '.join(self.missing)}")
        if self.type_mismatches:
            parts.append(f"type changes: {', '.join(self.type_mismatches)}")
        if self.geometry_mismatch:
            parts.append(self.geometry_mismatch)
        if self.unexpected:
            parts.append(f"new fields (ignored): {', '.join(self.unexpected)}")
        return "; ".join(parts)


class SchemaError(RuntimeError):
    pass


def compare_schema(spec: LayerSpec, metadata: dict[str, Any]) -> SchemaReport:
    """Pure comparison of a spec against ArcGIS layer metadata (unit-testable)."""
    live = {f["name"]: f["type"] for f in metadata.get("fields") or []}
    report = SchemaReport(layer_key=spec.key, ok=True)
    for fs in spec.fields:
        if fs.name not in live:
            report.missing.append(fs.name)
        elif live[fs.name] != fs.esri_type:
            report.type_mismatches.append(f"{fs.name} {fs.esri_type}->{live[fs.name]}")
    expected_names = {fs.name for fs in spec.fields}
    report.unexpected = sorted(
        n for n in live if n not in expected_names and live[n] != "esriFieldTypeGeometry"
    )
    live_geom = metadata.get("geometryType")
    if live_geom != spec.geometry_type:
        report.geometry_mismatch = f"geometry {spec.geometry_type}->{live_geom}"
    report.ok = not (report.missing or report.type_mismatches or report.geometry_mismatch)
    return report


class ArcGISLayer:
    def __init__(self, spec: LayerSpec, session: requests.Session | None = None, timeout: int = 180):
        self.spec = spec
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", USER_AGENT)
        self._metadata: dict[str, Any] | None = None

    # -- low level -----------------------------------------------------------
    def _request(self, path: str, params: dict[str, Any], method: str = "GET") -> dict[str, Any]:
        url = f"{self.spec.url}{path}"
        params = {**params, "f": "json"}
        last_error: Exception | None = None
        for attempt in range(5):
            try:
                if method == "POST":
                    resp = self.session.post(url, data=params, timeout=self.timeout)
                else:
                    resp = self.session.get(url, params=params, timeout=self.timeout)
                resp.raise_for_status()
                payload = resp.json()
                if "error" in payload:
                    raise RuntimeError(f"ArcGIS error from {self.spec.key}: {payload['error']}")
                return payload
            except (requests.RequestException, RuntimeError, ValueError) as exc:
                last_error = exc
                time.sleep(2 ** attempt)
        raise RuntimeError(f"{self.spec.key}: request failed after retries: {last_error}")

    # -- metadata / validation ----------------------------------------------
    def metadata(self) -> dict[str, Any]:
        if self._metadata is None:
            self._metadata = self._request("", {})
        return self._metadata

    def validate_schema(self, strict: bool = True) -> SchemaReport:
        report = compare_schema(self.spec, self.metadata())
        if strict and not report.ok:
            raise SchemaError(report.describe())
        return report

    @property
    def max_record_count(self) -> int:
        return int(self.metadata().get("maxRecordCount") or 1000)

    # -- queries ---------------------------------------------------------------
    def count(self, where: str = "1=1") -> int:
        return int(self._request("/query", {"where": where, "returnCountOnly": "true"})["count"])

    def object_ids(self, where: str = "1=1") -> list[int]:
        payload = self._request("/query", {"where": where, "returnIdsOnly": "true"}, method="POST")
        return sorted(payload.get("objectIds") or [])

    def statistics(self, where: str, stats: list[dict[str, str]], group_by: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"where": where, "outStatistics": json.dumps(stats)}
        if group_by:
            params["groupByFieldsForStatistics"] = group_by
        return [f["attributes"] for f in self._request("/query", params, method="POST").get("features", [])]

    def iter_pages(
        self,
        where: str = "1=1",
        out_fields: list[str] | None = None,
        out_sr: int = 4326,
        page_size: int | None = None,
        cache_dir: Path | None = None,
        progress: bool = True,
    ) -> Iterator[list[dict[str, Any]]]:
        """Yield pages of Esri JSON features.

        Pages are defined by contiguous runs of sorted OBJECTIDs, which keeps
        each request short and makes the harvest resumable: when ``cache_dir``
        is given every page is written to disk and re-used on the next run.
        """
        oid = self.spec.oid_field
        fields = out_fields or [fs.name for fs in self.spec.fields]
        if oid not in fields:
            fields = [oid, *fields]
        size = page_size or self.max_record_count
        ids = self.object_ids(where)
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)
        n_pages = (len(ids) + size - 1) // size
        for i in range(n_pages):
            chunk = ids[i * size : (i + 1) * size]
            lo, hi = chunk[0], chunk[-1]
            cache_file = cache_dir / f"page_{lo}_{hi}.json" if cache_dir else None
            if cache_file and cache_file.exists():
                yield json.loads(cache_file.read_text(encoding="utf-8"))
                continue
            page_where = f"({where}) AND {oid} >= {lo} AND {oid} <= {hi}"
            payload = self._request(
                "/query",
                {
                    "where": page_where,
                    "outFields": ",".join(fields),
                    "returnGeometry": "true",
                    "outSR": out_sr,
                },
                method="POST",
            )
            features = payload.get("features", [])
            if payload.get("exceededTransferLimit"):
                raise RuntimeError(f"{self.spec.key}: page {lo}-{hi} exceeded transfer limit; lower page_size")
            if cache_file:
                cache_file.write_text(json.dumps(features), encoding="utf-8")
            if progress:
                print(f"  {self.spec.key}: page {i + 1}/{n_pages} ({len(features)} features)", flush=True)
            yield features

    def to_geodataframe(self, where: str = "1=1", cache_dir: Path | None = None, progress: bool = False):
        """Fetch a whole layer (in WGS84) as a GeoDataFrame."""
        import geopandas as gpd

        rows: list[dict[str, Any]] = []
        geoms = []
        for page in self.iter_pages(where=where, out_sr=4326, cache_dir=cache_dir, progress=progress):
            for feature in page:
                rows.append(feature["attributes"])
                geoms.append(esri_geometry_to_shapely(feature.get("geometry")))
        return gpd.GeoDataFrame(rows, geometry=geoms, crs=4326)


def esri_geometry_to_shapely(geom: dict[str, Any] | None):
    """Convert an Esri JSON point/polyline into a Shapely geometry (or None)."""
    from shapely.geometry import LineString, MultiLineString, Point

    if not geom:
        return None
    if "x" in geom:
        if geom["x"] is None or geom["y"] is None:
            return None
        return Point(geom["x"], geom["y"])
    if "paths" in geom:
        paths = [[(pt[0], pt[1]) for pt in path] for path in geom["paths"] if len(path) >= 2]
        if not paths:
            return None
        return LineString(paths[0]) if len(paths) == 1 else MultiLineString(paths)
    raise ValueError(f"unsupported Esri geometry keys: {sorted(geom)}")
