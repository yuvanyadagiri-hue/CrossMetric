from pyproj import Geod, Transformer

from pipeline.config import ANALYSIS_CRS
from pipeline.sources.arcgis import FieldSpec, LayerSpec, compare_schema, esri_geometry_to_shapely

SPEC = LayerSpec(
    key="test_layer",
    title="t",
    publisher="p",
    url="https://example.invalid/layer/0",
    geometry_type="esriGeometryPoint",
    fields=(FieldSpec("OBJECTID", "esriFieldTypeOID"), FieldSpec("INJURIES", "esriFieldTypeInteger")),
)


def meta(fields, geometry="esriGeometryPoint"):
    return {"geometryType": geometry, "fields": [{"name": n, "type": t} for n, t in fields]}


def test_schema_ok_and_new_fields_are_informational():
    r = compare_schema(SPEC, meta([("OBJECTID", "esriFieldTypeOID"), ("INJURIES", "esriFieldTypeInteger"), ("NEW", "esriFieldTypeString")]))
    assert r.ok
    assert r.unexpected == ["NEW"]


def test_schema_detects_missing_field():
    r = compare_schema(SPEC, meta([("OBJECTID", "esriFieldTypeOID")]))
    assert not r.ok and r.missing == ["INJURIES"]


def test_schema_detects_type_change():
    r = compare_schema(SPEC, meta([("OBJECTID", "esriFieldTypeOID"), ("INJURIES", "esriFieldTypeString")]))
    assert not r.ok and "INJURIES" in r.type_mismatches[0]


def test_schema_detects_geometry_change():
    r = compare_schema(SPEC, meta([("OBJECTID", "esriFieldTypeOID"), ("INJURIES", "esriFieldTypeInteger")], "esriGeometryPolyline"))
    assert not r.ok and r.geometry_mismatch


def test_esri_geometry_conversion():
    assert esri_geometry_to_shapely({"x": -84.2, "y": 34.0}).wkt == "POINT (-84.2 34)"
    line = esri_geometry_to_shapely({"paths": [[[0, 0], [1, 1]]]})
    assert line.geom_type == "LineString"
    multi = esri_geometry_to_shapely({"paths": [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]})
    assert multi.geom_type == "MultiLineString"
    assert esri_geometry_to_shapely(None) is None
    assert esri_geometry_to_shapely({"x": None, "y": None}) is None


def test_analysis_crs_measures_true_meters_across_georgia():
    geod = Geod(ellps="GRS80")
    t = Transformer.from_crs(4326, ANALYSIS_CRS, always_xy=True)
    for lon, lat in [(-85.4, 30.6), (-84.2, 34.0), (-81.1, 32.0), (-83.5, 34.9)]:
        x1, y1 = t.transform(lon, lat)
        x2, y2 = t.transform(lon + 0.01, lat + 0.01)
        projected = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        _, _, true = geod.inv(lon, lat, lon + 0.01, lat + 0.01)
        assert abs(projected / true - 1) < 0.001  # better than 0.1 %


def test_web_mercator_would_inflate_distances_in_georgia():
    """Documents why EPSG:3857 is never used for distance (see config.py)."""
    geod = Geod(ellps="GRS80")
    t = Transformer.from_crs(4326, 3857, always_xy=True)
    x1, _ = t.transform(-84.2, 34.0)
    x2, _ = t.transform(-84.19, 34.0)
    _, _, true = geod.inv(-84.2, 34.0, -84.19, 34.0)
    assert (x2 - x1) / true > 1.19
