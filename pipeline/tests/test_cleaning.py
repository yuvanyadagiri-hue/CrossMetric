"""Crash quality rules — SYNTHETIC crash records."""

from datetime import date

import numpy as np
import pandas as pd

from pipeline.cleaning.crashes import COUNTY_CENTROID, PRIVATE_PROPERTY, split_clean
from pipeline.ingestion.crashes import LOW_LIGHT, normalize

SNAPSHOT = date(2026, 10, 3)


def crashes(n: int, **overrides) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    df = pd.DataFrame(
        {
            "source_oid": np.arange(n),
            "crash_id": [str(1000 + i) for i in range(n)],
            "crash_date": [date(2025, 5, 1)] * n,
            "lon": -84.2 + rng.uniform(0, 0.05, n),
            "lat": 34.0 + rng.uniform(0, 0.05, n),
            "attr_x": np.nan,
            "attr_y": np.nan,
            "geometry_source": "Longitude and Latitude",
            "location_of_impact": "01-On Roadway - Non-Intersection",
            "county": "Fulton",
        }
    )
    df["attr_x"], df["attr_y"] = df["lon"], df["lat"]
    for k, v in overrides.items():
        df[k] = v
    return df


def reasons(df):
    _, q, _ = split_clean(df, SNAPSHOT)
    return q.set_index("crash_id")["reason"].to_dict()


def test_valid_crashes_pass():
    clean, q, summary = split_clean(crashes(20), SNAPSHOT)
    assert len(clean) == 20 and len(q) == 0
    assert summary["records"].sum() == 0


def test_county_centroid_geocodes_are_quarantined():
    df = crashes(3)
    df.loc[1, "geometry_source"] = COUNTY_CENTROID
    assert reasons(df) == {"1001": "county_centroid"}


def test_outside_georgia_and_future_dates_and_private_property():
    df = crashes(4)
    df.loc[0, ["lon", "attr_x"]] = -90.0
    df.loc[1, "crash_date"] = date(2027, 1, 1)
    df.loc[2, "location_of_impact"] = PRIVATE_PROPERTY
    assert reasons(df) == {"1000": "outside_georgia", "1001": "future_date", "1002": "private_property"}


def test_geometry_that_disagrees_with_reported_xy():
    df = crashes(2)
    df.loc[0, "attr_x"] = df.loc[0, "lon"] + 0.01
    assert reasons(df) == {"1000": "xy_mismatch"}


def test_duplicate_reports_keep_first():
    df = crashes(3)
    df.loc[2, "crash_id"] = "1000"
    assert reasons(df) == {"1000": "duplicate_report"}
    clean, _, _ = split_clean(df, SNAPSHOT)
    assert sorted(clean["source_oid"]) == [0, 1]


def test_coordinate_shared_by_three_counties_is_a_default():
    df = crashes(6)
    df.loc[:, ["lon", "attr_x"]] = -83.962042
    df.loc[:, ["lat", "attr_y"]] = 33.054271
    df["county"] = ["Chatham", "Chatham", "Bibb", "Jones", "Chatham", "Chatham"]
    assert set(reasons(df).values()) == {"default_location"}


def test_round_number_coordinates_are_defaults():
    df = crashes(12)
    df.loc[:, ["lon", "attr_x"]] = -84.0
    df.loc[:, ["lat", "attr_y"]] = 33.0
    assert len(reasons(df)) == 12


def test_isolated_stack_is_a_default_but_a_busy_intersection_is_not():
    # Isolated: 40 reports on one point with nothing around it.
    iso = crashes(40)
    iso.loc[:, ["lon", "attr_x"]] = -84.292511
    iso.loc[:, ["lat", "attr_y"]] = 33.769944
    # Busy intersection: 40 reports snapped to one point, plus 40 scattered
    # GPS points within ~60 m (what real locations look like).
    rng = np.random.default_rng(1)
    busy_stack = crashes(40, crash_id=[f"B{i}" for i in range(40)])
    busy_stack.loc[:, ["lon", "attr_x"]] = -84.150011
    busy_stack.loc[:, ["lat", "attr_y"]] = 33.950017
    scatter = crashes(40, crash_id=[f"S{i}" for i in range(40)])
    scatter["lon"] = -84.150011 + rng.uniform(-0.0005, 0.0005, 40)
    scatter["lat"] = 33.950017 + rng.uniform(-0.0005, 0.0005, 40)
    scatter["attr_x"], scatter["attr_y"] = scatter["lon"], scatter["lat"]
    df = pd.concat([iso, busy_stack, scatter], ignore_index=True)
    df["source_oid"] = np.arange(len(df))
    r = reasons(df)
    assert sum(1 for k in r if k.startswith("10")) == 40  # isolated stack removed
    assert not any(k.startswith("B") or k.startswith("S") for k in r)  # busy location kept


def test_normalize_derives_pedestrian_from_unit_types_not_the_gdot_flag():
    raw = pd.DataFrame(
        {
            "OBJECTID": [1, 2, 3],
            "ACCIDENT_ID": [10.0, 11.0, 12.0],
            "ACCIDENT_DATE": [1717000000000] * 3,
            "FATALITIES": [0, 1, 0],
            "INJURIES": [0, 2, 0],
            "VEHICLES": [1, 2, 1],
            "VEHICLE_TYPE1": ["01-Passenger Car", "00-Pedestrian", "01-Passenger Car"],
            "VEHICLE_TYPE2": ["00-Pedestrian", "01-Passenger Car", "19-Pedacycle, Bicycle"],
            "LIGHT_CONDITION": ["05-DarkNot Lighted", "01-Daylight", None],
            "LOCATION_OF_IMPACT": [None] * 3,
            "COLLISION_TYPE": [None] * 3,
            "GEOMETRY_SOURCE": ["Longitude and Latitude"] * 3,
            "COUNTY_NAME": ["Fulton"] * 3,
            "PEDESTRIAN": ["1", "1", "1"],  # GDOT flag is "1" on 99% of crashes
            "X": [-84.2] * 3,
            "Y": [34.0] * 3,
            "_geom_x": [-84.2] * 3,
            "_geom_y": [34.0] * 3,
        }
    )
    n = normalize(raw)
    assert n["pedestrian"].tolist() == [True, True, False]
    assert n["bicyclist"].tolist() == [False, False, True]
    assert n["injury_or_fatal"].tolist() == [False, True, False]
    assert n["fatal"].tolist() == [False, True, False]
    assert n["light"].tolist() == ["dark_unlighted", "daylight", "unknown"]
    assert n["low_light"].tolist() == [True, False, False]
    assert "dark_unlighted" in LOW_LIGHT
