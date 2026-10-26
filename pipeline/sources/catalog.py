"""Catalog of every external data source CrossMetric reads.

Field lists and Esri types were taken from the live service metadata
(inspected 2026-10-03), not guessed. ``ArcGISLayer.validate_schema`` re-checks
them on every pipeline run.
"""

from __future__ import annotations

from .arcgis import FieldSpec, LayerSpec

S = "esriFieldTypeString"
D = "esriFieldTypeDouble"
I = "esriFieldTypeInteger"
DT = "esriFieldTypeDate"
OID = "esriFieldTypeOID"


def _f(*pairs: tuple[str, str]) -> tuple[FieldSpec, ...]:
    return tuple(FieldSpec(n, t) for n, t in pairs)


NCES_SCHOOL_LOCATIONS = LayerSpec(
    key="nces_school_locations",
    title="Public School Locations 2024-25 (EDGE geocodes)",
    publisher="National Center for Education Statistics (NCES)",
    url="https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2425/MapServer/0",
    geometry_type="esriGeometryPoint",
    fields=_f(
        ("OBJECTID", OID), ("NCESSCH", S), ("LEAID", S), ("NAME", S), ("STREET", S),
        ("CITY", S), ("STATE", S), ("ZIP", S), ("NMCNTY", S), ("LOCALE", S),
        ("LAT", D), ("LON", D), ("SCHOOLYEAR", S),
    ),
)

NCES_SCHOOL_ADMIN = LayerSpec(
    key="nces_school_admin",
    title="Public School Administrative Data 2024-25 (CCD)",
    publisher="National Center for Education Statistics (NCES)",
    url="https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1",
    geometry_type="esriGeometryPoint",
    fields=_f(
        ("OBJECTID", OID), ("NCESSCH", S), ("LEA_NAME", S), ("SCH_NAME", S), ("LCITY", S),
        ("LSTATE", S), ("GSLO", S), ("GSHI", S), ("SCHOOL_LEVEL", S), ("SCHOOL_TYPE_TEXT", S),
        ("SY_STATUS_TEXT", S), ("CHARTER_TEXT", S), ("VIRTUAL", S),
    ),
)

GDOT_CRASHES = LayerSpec(
    key="gdot_crashes",
    title="GeoPI Crashes (GEARS)",
    publisher="Georgia Department of Transportation (GDOT)",
    url="https://enterprisegis.dot.ga.gov/hosting/rest/services/GeoPI/GEOPI_APP/MapServer/3",
    geometry_type="esriGeometryPoint",
    fields=_f(
        ("OBJECTID", OID), ("ACCIDENT_ID", D), ("ACCIDENT_DATE", DT), ("FATALITIES", I),
        ("INJURIES", I), ("VEHICLES", I), ("VEHICLE_TYPE1", S), ("VEHICLE_TYPE2", S),
        ("LOCATION_OF_IMPACT", S), ("COLLISION_TYPE", S), ("LIGHT_CONDITION", S),
        ("SURFACE_CONDITION", S), ("PEDESTRIAN", S), ("GEOMETRY_SOURCE", S), ("X", D), ("Y", D),
        ("COUNTY_NAME", S), ("RCLINK", S), ("LAST_MODIFIED_DATE", DT),
    ),
)

GDOT_SIGNALS = LayerSpec(
    key="gdot_signals",
    title="GeoPI Traffic Signals",
    publisher="Georgia Department of Transportation (GDOT)",
    url="https://enterprisegis.dot.ga.gov/hosting/rest/services/GeoPI/GEOPI_APP/MapServer/4",
    geometry_type="esriGeometryPoint",
    fields=_f(
        ("OBJECTID", OID), ("SIGNALS_ID", S), ("SIGNALS_STATUS_NAME", S),
        ("MAIN_STREET_LOCAL_NM", S), ("CROSS_ST_LOCAL_NM", S), ("LATITUDE", D),
        ("LONGITUDE", D), ("COUNTY_NAME", S),
    ),
)

# GDOT's statewide 2023 AADT segment layer. GDOT's own GeoTRAQS server
# (gis10.dot.ga.gov) refused connections and TADA has no public bulk API, so
# this republication on ArcGIS Online is used. Its ROUTE_IDs follow GDOT's LRS
# and it is cross-checked against GDOT station counts in validation.
GDOT_AADT_2023 = LayerSpec(
    key="gdot_aadt_2023",
    title="GDOT Traffic Counts — AADT segments (2023 count year)",
    publisher="Georgia Department of Transportation (GDOT), via ArcGIS Online republication",
    url="https://services8.arcgis.com/1mrBokgqELDgSAOU/arcgis/rest/services/GA_Traffic_Counts_2022/FeatureServer/0",
    geometry_type="esriGeometryPolyline",
    oid_field="FID",
    fields=_f(
        ("FID", OID), ("YEAR", I), ("ROUTE_ID", S), ("AADT", D), ("Future_AAD", I),
        ("Latitude", D), ("Longitude", D),
    ),
)

# GDOT count-station AADT 2008-2017 (independent copy) — used only to
# cross-validate the 2023 segment AADT.
GDOT_STATIONS_2017 = LayerSpec(
    key="gdot_stations_2017",
    title="GDOT Traffic Counts (AADT and Truck Percent) 2008 to 2017",
    publisher="Georgia Department of Transportation (GDOT), via City of Sandy Springs",
    url="https://services5.arcgis.com/buITjRsK0rZsAXbQ/arcgis/rest/services/GDOT_AADT_and_TruckPct_2008to2017/FeatureServer/0",
    geometry_type="esriGeometryPoint",
    oid_field="ObjectId",
    fields=_f(
        ("ObjectId", OID), ("Station_ID", S), ("Functional_Class", S),
        ("AADT_2017", I), ("AADT_2016", I), ("AADT_2015", I),
    ),
)

_TIGER_FIELDS = _f(("OBJECTID", OID), ("NAME", S), ("MTFCC", S), ("RTTYP", S))
TIGER_ROADS = tuple(
    LayerSpec(
        key=f"tiger_{label}",
        title=f"TIGERweb {title}",
        publisher="U.S. Census Bureau (TIGER/Line)",
        url=f"https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/{layer_id}",
        geometry_type="esriGeometryPolyline",
        fields=_TIGER_FIELDS,
    )
    for label, title, layer_id in (
        ("primary", "Primary Roads", 2),
        ("secondary", "Secondary Roads", 6),
        ("local", "Local Roads", 8),
    )
)

ARC_HIGH_INJURY_NETWORK = LayerSpec(
    key="arc_high_injury_network",
    title="Regional High Injury Network (2019-2023 crashes)",
    publisher="Atlanta Regional Commission (ARC)",
    url="https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/Regional_High_Injury_Network_WFL1/FeatureServer/1",
    geometry_type="esriGeometryPolyline",
    fields=_f(
        ("OBJECTID", OID), ("GA_2023_Routes_SplitLineAtPo_RO", S), ("ePDO", D),
        ("ServerityScore", I), ("Number_of_Fatalities", I), ("Number_of_Serious_Injuries", I),
        ("Num_of_NMotorizedFatalities", I), ("NumofNMotorizedSeriousInjuries", I), ("Ownership", S),
    ),
)

GDOT_ROAD_INVENTORY = {
    "key": "gdot_road_inventory_2025",
    "title": "Road Inventory 2025 Geodatabase (HPMS data items)",
    "publisher": "Georgia Department of Transportation (GDOT), Office of Transportation Data",
    "url": "https://myfiles.dot.ga.gov/OTD/RoadAndTrafficData/Road_Inventory_Geodatabase.zip",
    "layers": ("GA_2025_Routes", "F_SYSTEM", "FACILITY_TYPE", "THROUGH_LANES"),
}
