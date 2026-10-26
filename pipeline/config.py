"""Central configuration for the CrossMetric pipeline.

Geometric and data-quality parameters live here, in one place, with the
reason each value was chosen. Scoring weights do NOT live here: they live in
the shared, versioned model file (packages/engine/model/crossmetric-model.json)
so that Python and TypeScript use identical numbers.
"""

from __future__ import annotations

from pathlib import Path

from pyproj import CRS

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
INTERIM = DATA / "interim"
PUBLISHED = DATA / "published"
MODEL_FILE = ROOT / "packages" / "engine" / "model" / "crossmetric-model.json"

# ---------------------------------------------------------------------------
# Coordinate reference systems
# ---------------------------------------------------------------------------
# Sources arrive in three different CRSs:
#   NCES schools  -> EPSG:4269 (NAD83 geographic)
#   GDOT crashes  -> EPSG:3857 (Web Mercator) — requested as EPSG:4326
#   GDOT roads    -> EPSG:4326 (WGS84 geographic)
#
# None of these can measure distance in meters. Web Mercator *looks* metric
# but inflates distances by ~20% at Georgia's latitude (measured: 1.205x near
# Johns Creek), so an "800 m" buffer computed in EPSG:3857 would really cover
# ~664 m on the ground.
#
# All distance and buffer math therefore runs in the Georgia Statewide Lambert
# Conformal Conic projection (the parameters of ESRI:102604, which GDOT uses),
# with meters as the unit. Worst-case scale error inside Georgia: 0.059%.
ANALYSIS_CRS = CRS.from_proj4(
    "+proj=lcc +lat_0=0 +lon_0=-83.5 +lat_1=31.4166666666667 "
    "+lat_2=34.2833333333333 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs"
)
WGS84 = CRS.from_epsg(4326)

# Georgia bounding box (WGS84) used to reject coordinates that are clearly
# outside the state (e.g. swapped lat/lon or zeroed coordinates).
GEORGIA_BOUNDS = (-85.61, 30.35, -80.75, 35.01)  # (min lon, min lat, max lon, max lat)

# ---------------------------------------------------------------------------
# Analysis geometry
# ---------------------------------------------------------------------------
ANALYSIS_RADII_M = (400, 800, 1200)
MAX_RADIUS_M = max(ANALYSIS_RADII_M)

# Roads are gathered a little beyond the largest radius so that an
# intersection sitting just inside 1,200 m still sees all of its legs.
NETWORK_MARGIN_M = 150

# Crashes farther than this from any road centerline are not associated with
# a road. Police-reported GPS coordinates are typically within a few tens of
# meters of the roadway; 30 m (~100 ft) keeps parking-lot and off-road points
# out while tolerating ordinary GPS error.
CRASH_SNAP_TOLERANCE_M = 30.0

# Highway Safety Manual convention: a crash within 250 ft (76.2 m) of an
# intersection is treated as intersection-related.
INTERSECTION_INFLUENCE_M = 76.2

# Divided highways and offset junctions produce several network nodes for what
# a person would call one intersection. Nodes closer than this are merged into
# a single intersection candidate (this is also what stops the Resource Planner
# from spending two review slots on the same physical intersection).
INTERSECTION_CLUSTER_M = 35.0

# Mid-block road between intersections is cut into analysis units no longer
# than this, so a long road cannot outrank a short one simply by being long.
SEGMENT_UNIT_MAX_M = 250.0

# Units shorter than this (slivers between closely spaced intersections) are
# dropped; their crashes are already captured by the neighbouring
# intersection's influence area.
SEGMENT_UNIT_MIN_M = 30.0

# A GDOT traffic signal within this distance of an intersection centre marks
# the intersection as signalized (informational only; not scored).
SIGNAL_MATCH_M = 45.0

# Two road pieces are considered the same named road when a TIGER name covers
# at least this share of the GDOT piece's length inside a narrow buffer.
NAME_MATCH_BUFFER_M = 15.0
NAME_MATCH_MIN_SHARE = 0.4

# Functional systems (HPMS F_SYSTEM codes) that are access-controlled. They are
# kept in the network so that crashes on them are correctly absorbed, but they
# are never candidates and never form at-grade intersections.
#   1 = Interstate, 2 = Other Freeways & Expressways
ACCESS_CONTROLLED_F_SYSTEM = frozenset({1, 2})
