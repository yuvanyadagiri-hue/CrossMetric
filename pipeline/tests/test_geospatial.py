"""Intersections, segments, association, traffic and naming on SYNTHETIC networks."""

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import LineString, Point

from pipeline.config import ANALYSIS_CRS, INTERSECTION_INFLUENCE_M
from pipeline.geospatial.association import associate
from pipeline.geospatial.intersections import cluster_nodes, count_distinct, detect_nodes
from pipeline.geospatial.naming import Namer, fallback_name
from pipeline.geospatial.segments import build_segment_units, split_equal
from pipeline.geospatial.traffic import TrafficIndex
from pipeline.ingestion.roads import ROLE_ACCESS_CONTROLLED, ROLE_CONNECTOR, ROLE_RAMP, assign_role, decode_route_id

from .conftest import network, road

# Route ids follow GDOT's anatomy: function type, county, system, route code, suffix, direction.
MAIN = "1121200001000INC"
CROSS = "1121200002000INC"
OTHER = "1121200003000INC"
INTERSTATE = "1000100040100INC"
RAMP = "2000100040100INC"


def intersections_of(net):
    return cluster_nodes(detect_nodes(net))


# --------------------------------------------------------------- directions
def test_count_distinct_merges_close_bearings_and_wraps_the_circle():
    assert count_distinct([0, 90, 180, 270]) == 4
    assert count_distinct([0, 10, 180]) == 2
    assert count_distinct([355, 5, 180]) == 2
    assert count_distinct([]) == 0


# ------------------------------------------------------------ intersections
def test_four_way_crossing_is_one_intersection():
    net = network(road(MAIN, [(-200, 0), (200, 0)]), road(CROSS, [(0, -200), (0, 200)]))
    ints = intersections_of(net)
    assert len(ints) == 1
    assert ints.iloc[0].max_dirs == 4
    assert ints.iloc[0].geometry.distance(Point(0, 0)) < 0.5


def test_t_junction_with_tiny_gap_is_detected():
    # minor road ends 0.4 m short of the main road (common in real data)
    net = network(road(MAIN, [(-200, 0), (200, 0)]), road(CROSS, [(0, 0.4), (0, 200)]))
    ints = intersections_of(net)
    assert len(ints) == 1 and ints.iloc[0].max_dirs == 3


def test_segmentation_break_is_not_an_intersection():
    # same road split where an attribute changes: two directions only
    net = network(road(MAIN, [(-200, 0), (0, 0)]), road(MAIN, [(0, 0), (200, 0)], f_system=5))
    assert len(intersections_of(net)) == 0


def test_concurrent_overlapping_routes_do_not_double_count_directions():
    net = network(
        road(MAIN, [(-200, 0), (200, 0)]),
        road(OTHER, [(-200, 0), (200, 0)]),  # identical geometry (concurrent route)
    )
    assert len(intersections_of(net)) == 0


def test_interstate_overpass_is_not_an_intersection():
    net = network(
        road(MAIN, [(-200, 0), (200, 0)]),
        road(INTERSTATE, [(0, -500), (0, 500)], role=ROLE_ACCESS_CONTROLLED, f_system=1),
    )
    assert len(intersections_of(net)) == 0


def test_ramp_terminal_is_an_intersection_but_a_ramp_flyover_is_not():
    terminal = network(road(MAIN, [(-200, 0), (200, 0)]), road(RAMP, [(0, 0), (150, 150)], role=ROLE_RAMP, f_system=1))
    assert len(intersections_of(terminal)) == 1
    flyover = network(road(MAIN, [(-200, 0), (200, 0)]), road(RAMP, [(0, -150), (0, 150)], role=ROLE_RAMP, f_system=1))
    assert len(intersections_of(flyover)) == 0


def test_slip_lane_does_not_create_its_own_intersection():
    net = network(
        road(MAIN, [(-200, 0), (200, 0)]),
        road(CROSS, [(0, -200), (0, 200)]),
        road("8121200009000INC", [(-30, 0), (0, 30)], role=ROLE_CONNECTOR),
    )
    assert len(intersections_of(net)) == 1


def test_divided_highway_crossing_becomes_one_intersection():
    # two carriageways 20 m apart crossed by a street -> two nodes -> one cluster
    net = network(
        road(MAIN, [(-300, 0), (300, 0)]),
        road(MAIN[:-3] + "DEC", [(-300, 20), (300, 20)]),
        road(CROSS, [(0, -200), (0, 200)]),
    )
    nodes = detect_nodes(net)
    assert len(nodes) == 2
    ints = cluster_nodes(nodes)
    assert len(ints) == 1
    assert ints.iloc[0].n_nodes == 2


# ----------------------------------------------------------------- segments
def test_split_equal_produces_equal_units_under_the_maximum():
    parts = split_equal(LineString([(0, 0), (1000, 0)]), max_len=250)
    assert len(parts) == 4
    assert all(abs(p.length - 250) < 1e-6 for p in parts)
    parts = split_equal(LineString([(0, 0), (510, 0)]), max_len=250)
    assert len(parts) == 3 and all(abs(p.length - 170) < 1e-6 for p in parts)


def test_segment_units_exclude_intersection_zones_and_opposite_carriageway():
    net = network(
        road(MAIN, [(-600, 0), (600, 0)]),
        road(MAIN[:-3] + "DEC", [(-600, 20), (600, 20)]),
        road(CROSS, [(0, -300), (0, 300)]),
    )
    ints = intersections_of(net)
    units = build_segment_units(net, ints)
    assert set(units["route_key"]) == {MAIN[:-3], CROSS[:-3]}  # DEC never produces units
    center = ints.iloc[0].geometry
    for g in units.geometry:
        assert g.distance(center) >= INTERSECTION_INFLUENCE_M - 25  # nothing deep inside the zone
        assert g.length <= 250 + 1e-6


# -------------------------------------------------------------- association
def _setup_association():
    net = network(
        road(MAIN, [(-600, 0), (600, 0)]),
        road(CROSS, [(0, -600), (0, 600)]),
        road(OTHER, [(-600, 60), (600, 60)]),  # parallel street 60 m north, no junction with CROSS
        road(INTERSTATE, [(-600, -400), (600, -400)], role=ROLE_ACCESS_CONTROLLED, f_system=1),
    )
    # make OTHER stop short of CROSS so it is not a leg of the intersection
    net.loc[2, "geometry"] = LineString([(40, 60), (600, 60)])
    ints = intersections_of(net)
    ints["candidate_id"] = [f"I{i}" for i in range(len(ints))]
    ints["route_keys"] = [[MAIN[:-3], CROSS[:-3]] for _ in range(len(ints))]
    units = build_segment_units(net, ints)
    units["candidate_id"] = [f"S{i}" for i in range(len(units))]
    units["route_keys"] = [[k] for k in units["route_key"]]
    return net, ints, units


def test_crash_association_rules():
    net, ints, units = _setup_association()
    pts = np.array([
        Point(10, 5),      # near the MAIN/CROSS intersection, on MAIN
        Point(300, 4),     # mid-block on MAIN
        Point(60, 58),     # on OTHER, within 76 m of the intersection but OTHER is not a leg
        Point(300, -398),  # on the interstate (away from the street that passes under it)
        Point(300, 250),   # far from every road
    ])
    cand, status = associate(pts, net, ints, units)
    assert cand[0] == "I0" and status[0] == "assigned"
    assert cand[1].startswith("S") and status[1] == "assigned"
    on_other = units.set_index("candidate_id").loc[cand[2]]
    assert on_other["route_key"] == OTHER[:-3]
    assert status[3] == "limited_access" and cand[3] == ""
    assert status[4] == "off_network" and cand[4] == ""


def test_crash_on_opposite_carriageway_lands_on_the_inventory_unit():
    net = network(road(MAIN, [(-600, 0), (600, 0)]), road(MAIN[:-3] + "DEC", [(-600, 20), (600, 20)]))
    ints = intersections_of(net)
    units = build_segment_units(net, ints)
    units["candidate_id"] = [f"S{i}" for i in range(len(units))]
    units["route_keys"] = [[k] for k in units["route_key"]]
    ints["candidate_id"], ints["route_keys"] = [], []
    cand, status = associate(np.array([Point(100, 21)]), net, ints, units)
    assert status[0] == "assigned" and cand[0].startswith("S")


# ------------------------------------------------------------------ traffic
def test_traffic_matches_on_route_and_keeps_missing_as_missing():
    aadt = gpd.GeoDataFrame(
        {"route_id": [MAIN], "aadt": [27300.0], "aadt_year": [2023]},
        geometry=[LineString([(-600, 0), (600, 0)])],
        crs=ANALYSIS_CRS,
    )
    idx = TrafficIndex(aadt)
    seg = idx.for_segment(LineString([(100, 0), (300, 0)]), MAIN[:-3])
    assert seg.aadt == 27300 and seg.status == "measured" and seg.year == 2023
    # a parallel road 10 m away on a different route must NOT borrow the count
    other = idx.for_segment(LineString([(100, 10), (300, 10)]), OTHER[:-3])
    assert other.aadt is None and other.status == "unavailable"
    inter, per_road = idx.for_intersection(Point(0, 0), [MAIN[:-3], CROSS[:-3]])
    assert inter.status == "partial" and inter.aadt == 27300 and per_road == [27300.0, None]


# ------------------------------------------------------------------- naming
def test_name_conflation_prefers_the_aligned_road_not_the_cross_street():
    tiger = gpd.GeoDataFrame(
        {"name": ["Medlock Bridge Rd", "Parsons Rd"], "rttyp": ["M", "M"]},
        geometry=[LineString([(-500, 2), (500, 2)]), LineString([(0, -500), (0, 500)])],
        crs=ANALYSIS_CRS,
    )
    namer = Namer(tiger)
    short_unit = LineString([(-20, 0), (20, 0)])  # crosses Parsons Rd at its midpoint
    assert namer.name_for(short_unit) == "Medlock Bridge Rd"
    assert namer.name_for(LineString([(0, 100), (0, 140)])) == "Parsons Rd"
    assert namer.name_for(LineString([(300, 300), (340, 300)])) is None


def test_fallback_names():
    assert fallback_name("1000100014100", "1") == "SR 141"
    assert fallback_name("1121200008025", "2") == "Unnamed road"


# --------------------------------------------------------------- road roles
def test_route_id_decoding_and_roles():
    import pandas as pd

    d = decode_route_id(pd.Series(["1000100040100INC", "2000100040100DEC", "8121200009000INC"]))
    assert d["function_type"].tolist() == ["1", "2", "8"]
    assert d["direction"].tolist() == ["INC", "DEC", "INC"]
    assert d["route_key"].tolist() == ["1000100040100", "2000100040100", "8121200009000"]
    roles = assign_role(d["function_type"], pd.Series([1, 1, 4]))
    assert roles.tolist() == [ROLE_ACCESS_CONTROLLED, ROLE_RAMP, ROLE_CONNECTOR]
