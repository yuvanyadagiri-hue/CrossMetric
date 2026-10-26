"""Campus buildings, entrances and parking geometry from OpenStreetMap.

For each campus in data/commute/<campus>.json this writes
data/published/commute/campus-<campus>.json with:

  buildings  named buildings inside the campus area(s), with OSM-mapped
             entrances (entrance=main/yes; exit-only, emergency, service and
             private doors are left out). A building without a mapped entrance
             keeps `entrances: []`; the app then says the entrance is unverified.
  parking    geometry for every parking place the rule file names (GT: explicit
             OSM ids; UGA: every OSM lot whose name starts with an official lot
             code that the enforcement table covers, plus named decks and
             park-and-ride lots).

Geometry is OpenStreetMap data (c) OpenStreetMap contributors, ODbL. Entrances
are as mapped in OSM, not verified on site.

    python -m pipeline.commute.campus
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import polygonize, unary_union

from pipeline.commute.osm import area_id, query
from pipeline.config import DATA, PUBLISHED

RULES = DATA / "commute"
OUT = PUBLISHED / "commute"

SIMPLIFY_DEG = 0.00001  # ~1 m
ENTRANCE_OK = {"main", "yes", "home", "staircase", "secondary"}
LOT_CODE = re.compile(r"^(1PP|TSL|HSC|SSB|CSC|VMC|[NSEW]\d{2})([A-Z])?\b")
ALIAS_TAGS = ("short_name", "alt_name", "official_name", "old_name", "loc_name")
# Not class destinations: garages and sheds are mapped as buildings too.
NOT_DESTINATIONS = {"parking", "garage", "garages", "carport", "roof", "shed", "service", "storage_tank", "transformer_tower", "hut"}


def _r(v: float) -> float:
    return round(v, 6)


def _ring(coords) -> list[list[float]]:
    return [[_r(x), _r(y)] for x, y in coords]


def _way_polygon(geom: list[dict]) -> Polygon | None:
    pts = [(g["lon"], g["lat"]) for g in geom]
    if len(pts) < 4 or pts[0] != pts[-1]:
        return None
    poly = Polygon(pts)
    return poly if poly.is_valid and poly.area > 0 else poly.buffer(0) if poly.area > 0 else None


def _relation_polygon(rel: dict) -> Polygon | MultiPolygon | None:
    outers = [LineString([(g["lon"], g["lat"]) for g in m["geometry"]]) for m in rel.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
    inners = [LineString([(g["lon"], g["lat"]) for g in m["geometry"]]) for m in rel.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
    if not outers:
        return None
    shell = unary_union(list(polygonize(unary_union(outers))))
    if inners:
        holes = unary_union(list(polygonize(unary_union(inners))))
        shell = shell.difference(holes)
    return shell if not shell.is_empty else None


def _geometry(el: dict) -> Polygon | MultiPolygon | None:
    if el["type"] == "way":
        return _way_polygon(el.get("geometry", []))
    if el["type"] == "relation":
        return _relation_polygon(el)
    return None


def _polygons(geom) -> list[list[list[list[float]]]]:
    """GeoJSON-style polygon list (outer ring only; holes are not needed for display)."""
    geom = geom.simplify(SIMPLIFY_DEG, preserve_topology=True)
    parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    return [[_ring(p.exterior.coords)] for p in parts if not p.is_empty]


def _aliases(tags: dict) -> list[str]:
    out: list[str] = []
    for key in ALIAS_TAGS:
        for v in (tags.get(key) or "").split(";"):
            v = v.strip()
            if v and v != tags.get("name") and v not in out:
                out.append(v)
    return out


def build_buildings(cfg: dict) -> tuple[list[dict], str]:
    areas = "".join(f"area(id:{area_id(a)})->.a{i};" for i, a in enumerate(cfg["osmAreas"]))
    sets = "".join(f'wr(area.a{i})["building"]["name"];' for i in range(len(cfg["osmAreas"])))
    ql = f"""[out:json][timeout:240];
{areas}
({sets})->.b;
.b out body geom;
(way(r.b); way.b;)->.outl;
node(w.outl)["entrance"];
out body;"""
    data = query(ql)
    stamp = data.get("osm3s", {}).get("timestamp_osm_base", "")
    elements = data["elements"]
    entrances = {e["id"]: e for e in elements if e["type"] == "node"}
    buildings = []
    for el in elements:
        if el["type"] not in ("way", "relation") or "tags" not in el or "building" not in el["tags"]:
            continue
        tags = el["tags"]
        if tags.get("building") in NOT_DESTINATIONS or tags.get("amenity") == "parking":
            continue
        geom = _geometry(el)
        if geom is None:
            continue
        node_ids: list[int] = list(el.get("nodes", []))
        if el["type"] == "relation":
            # Entrance nodes sit on the member ways; match them by position on the outline instead.
            outline = geom.boundary
            node_ids = [nid for nid, n in entrances.items() if outline.distance(Point(n["lon"], n["lat"])) < 0.000005]
        doors = []
        for nid in dict.fromkeys(node_ids):
            n = entrances.get(nid)
            if not n:
                continue
            t = n.get("tags", {})
            if t.get("entrance") not in ENTRANCE_OK or t.get("access") in ("private", "no"):
                continue
            doors.append(
                {
                    "lon": _r(n["lon"]),
                    "lat": _r(n["lat"]),
                    "kind": "main" if t.get("entrance") == "main" else "door",
                    "wheelchair": t.get("wheelchair") if t.get("wheelchair") in ("yes", "no", "limited") else None,
                    "label": t.get("name") or t.get("ref") or None,
                    "osm": f"node/{nid}",
                }
            )
        doors.sort(key=lambda d: d["kind"] != "main")
        rp = geom.representative_point()
        buildings.append(
            {
                "id": f"{el['type'][0]}{el['id']}",
                "name": tags["name"].strip(),
                "aliases": _aliases(tags),
                "ref": tags.get("ref") or None,
                "center": [_r(rp.x), _r(rp.y)],
                "outline": _polygons(geom),
                "entrances": doors,
                "osm": f"{el['type']}/{el['id']}",
            }
        )
    # The same building can be mapped twice (e.g. a way inside a relation); keep the one with entrances.
    by_name: dict[str, dict] = {}
    for b in buildings:
        key = b["name"].lower()
        if key not in by_name or len(b["entrances"]) > len(by_name[key]["entrances"]):
            by_name[key] = b
    out = sorted(by_name.values(), key=lambda b: b["name"].lower())
    return out, stamp


def _fetch_ids(refs: list[str]) -> dict[str, dict]:
    ways = [r.split("/")[1] for r in refs if r.startswith("way/")]
    rels = [r.split("/")[1] for r in refs if r.startswith("relation/")]
    parts = ""
    if ways:
        parts += f"way(id:{','.join(ways)});"
    if rels:
        parts += f"relation(id:{','.join(rels)});"
    data = query(f"[out:json][timeout:120];({parts});out body geom;")
    return {f"{e['type']}/{e['id']}": e for e in data["elements"] if e["type"] in ("way", "relation")}


def _place(pid: str, code: str, name: str, kind: str, geoms: list, osm: list[str]) -> dict | None:
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return None
    union = unary_union(geoms)
    largest = max(list(union.geoms) if isinstance(union, MultiPolygon) else [union], key=lambda p: p.area)
    rp = largest.representative_point()
    return {"id": pid, "code": code, "name": name, "kind": kind, "center": [_r(rp.x), _r(rp.y)], "polygons": _polygons(union), "osm": osm}


def build_parking_gt(cfg: dict) -> list[dict]:
    places = cfg["parking"]["places"]
    found = _fetch_ids([ref for p in places for ref in p["osm"]])
    out = []
    for p in places:
        geoms = [_geometry(found[ref]) for ref in p["osm"] if ref in found]
        place = _place(p["id"], p["code"], p["name"], p["kind"], geoms, p["osm"])
        if place is None:
            raise RuntimeError(f"No OSM geometry for {p['id']} ({p['osm']})")
        out.append(place)
    return out


def build_parking_uga(cfg: dict) -> list[dict]:
    park = cfg["parking"]
    cats = park["lotCategories"]
    known = set(cats["registeredAfterHours"]) | set(cats["permitOnlyAfterHours"]) | set(cats["anyVehicleAfterHours"])
    areas = "".join(f"area(id:{area_id(a)})->.a{i};" for i, a in enumerate(cfg["osmAreas"]))
    sets = "".join(f'wr(area.a{i})["amenity"="parking"];' for i in range(len(cfg["osmAreas"])))
    (w, s), (e, n) = cfg["bounds"]
    data = query(f'[out:json][timeout:240];{areas}({sets}wr["amenity"="parking"]({s},{w},{n},{e}););out body geom;')
    elements = [el for el in data["elements"] if el["type"] in ("way", "relation") and "tags" in el]

    by_code: dict[str, list] = {}
    deck_names = {d["osmName"]: d for d in park["decks"]}
    decks: dict[str, list] = {}
    for el in elements:
        name = (el["tags"].get("name") or "").strip()
        if name in deck_names:
            decks.setdefault(deck_names[name]["code"], []).append(el)
            continue
        m = LOT_CODE.match(name) or LOT_CODE.match((el["tags"].get("ref") or "").strip())
        if m and m.group(1) in known:
            by_code.setdefault(m.group(1), []).append(el)

    out = []
    for d in park["decks"]:
        els = decks.get(d["code"], [])
        place = _place(f"uga-{d['code']}", d["code"], d["name"], "deck", [_geometry(el) for el in els], [f"{el['type']}/{el['id']}" for el in els])
        if place is None:
            raise RuntimeError(f"No OSM geometry for UGA deck {d['code']} ({d['osmName']})")
        out.append(place)
    extra = park.get("extraPlaces", [])
    found = _fetch_ids([ref for x in extra for ref in x["osm"]]) if extra else {}
    extra_codes = {x["code"] for x in extra}
    for x in extra:
        geoms = [_geometry(found[ref]) for ref in x["osm"] if ref in found]
        geoms += [_geometry(el) for el in by_code.get(x["code"], [])]
        place = _place(f"uga-{x['code']}", x["code"], x["name"], "lot", geoms, x["osm"])
        if place:
            out.append(place)
    deck_codes = {d["code"] for d in park["decks"]}
    for code, els in sorted(by_code.items()):
        if code in extra_codes or code in deck_codes:
            continue
        place = _place(f"uga-{code}", code, f"Lot {code}", "lot", [_geometry(el) for el in els], [f"{el['type']}/{el['id']}" for el in els])
        if place:
            out.append(place)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for path in sorted(RULES.glob("*.json")):
        cfg = json.loads(path.read_text(encoding="utf-8"))
        cid = cfg["campus"]
        buildings, stamp = build_buildings(cfg)
        parking = build_parking_gt(cfg) if "places" in cfg["parking"] else build_parking_uga(cfg)
        doc = {
            "campus": cid,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "osmTimestamp": stamp,
            "attribution": "© OpenStreetMap contributors (ODbL)",
            "buildings": buildings,
            "parking": parking,
        }
        (OUT / f"campus-{cid}.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        with_doors = sum(1 for b in buildings if b["entrances"])
        print(f"{cid}: {len(buildings)} buildings ({with_doors} with mapped entrances), {len(parking)} parking places, OSM {stamp}")


if __name__ == "__main__":
    main()
