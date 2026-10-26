"""Smaller statewide layers: traffic signals, AADT, count stations, ARC HIN.

    python -m pipeline.ingestion.reference_layers
"""

from __future__ import annotations

import geopandas as gpd
import pandas as pd

from pipeline.config import INTERIM, RAW
from pipeline.sources.arcgis import ArcGISLayer
from pipeline.sources.catalog import (
    ARC_HIGH_INJURY_NETWORK,
    GDOT_AADT_2023,
    GDOT_SIGNALS,
    GDOT_STATIONS_2017,
)

SIGNALS_TABLE = INTERIM / "signals.parquet"
AADT_TABLE = INTERIM / "aadt_2023.parquet"
STATIONS_TABLE = INTERIM / "aadt_stations_2017.parquet"
HIN_TABLE = INTERIM / "arc_hin.parquet"


def _fetch(spec, where: str = "1=1") -> gpd.GeoDataFrame:
    layer = ArcGISLayer(spec)
    print(layer.validate_schema(strict=True).describe())
    gdf = layer.to_geodataframe(where=where, cache_dir=RAW / spec.key)
    before = len(gdf)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    print(f"  {spec.key}: {before:,} records, {before - len(gdf):,} without geometry dropped")
    return gdf


def build_signals() -> gpd.GeoDataFrame:
    gdf = _fetch(GDOT_SIGNALS)
    out = gpd.GeoDataFrame(
        {
            "signal_id": gdf["SIGNALS_ID"].astype("string"),
            "status": gdf["SIGNALS_STATUS_NAME"].astype("string"),
            "main_street": gdf["MAIN_STREET_LOCAL_NM"].astype("string"),
            "cross_street": gdf["CROSS_ST_LOCAL_NM"].astype("string"),
            "county": gdf["COUNTY_NAME"].astype("string"),
        },
        geometry=gdf.geometry,
        crs=4326,
    )
    out.to_parquet(SIGNALS_TABLE, index=False)
    print(out["status"].value_counts(dropna=False).head(10).to_string())
    return out


def build_aadt() -> gpd.GeoDataFrame:
    gdf = _fetch(GDOT_AADT_2023)
    aadt = pd.to_numeric(gdf["AADT"], errors="coerce")
    out = gpd.GeoDataFrame(
        {
            "route_id": gdf["ROUTE_ID"].astype("string"),
            "aadt": aadt,
            "aadt_year": pd.to_numeric(gdf["YEAR"], errors="coerce").astype("Int16"),
            "future_aadt": pd.to_numeric(gdf["Future_AAD"], errors="coerce"),
        },
        geometry=gdf.geometry,
        crs=4326,
    )
    # AADT of zero or below is not a real count; treat it as unavailable.
    invalid = out["aadt"].isna() | (out["aadt"] <= 0)
    print(f"  AADT: {invalid.sum():,} segments with missing/non-positive AADT quarantined")
    out = out[~invalid]
    out.to_parquet(AADT_TABLE, index=False)
    print(out["aadt"].describe().to_string())
    return out


def build_stations() -> gpd.GeoDataFrame:
    gdf = _fetch(GDOT_STATIONS_2017)
    out = gpd.GeoDataFrame(
        {
            "station_id": gdf["Station_ID"].astype("string"),
            "functional_class": gdf["Functional_Class"].astype("string"),
            "aadt_2017": pd.to_numeric(gdf["AADT_2017"], errors="coerce"),
            "aadt_2016": pd.to_numeric(gdf["AADT_2016"], errors="coerce"),
            "aadt_2015": pd.to_numeric(gdf["AADT_2015"], errors="coerce"),
        },
        geometry=gdf.geometry,
        crs=4326,
    )
    out.to_parquet(STATIONS_TABLE, index=False)
    return out


def build_hin() -> gpd.GeoDataFrame:
    gdf = _fetch(ARC_HIGH_INJURY_NETWORK)
    out = gpd.GeoDataFrame(
        {
            "route_id": gdf["GA_2023_Routes_SplitLineAtPo_RO"].astype("string"),
            "epdo": pd.to_numeric(gdf["ePDO"], errors="coerce"),
            "severity_score": pd.to_numeric(gdf["ServerityScore"], errors="coerce"),
            "fatalities": pd.to_numeric(gdf["Number_of_Fatalities"], errors="coerce"),
            "serious_injuries": pd.to_numeric(gdf["Number_of_Serious_Injuries"], errors="coerce"),
            "nonmotorized_fatalities": pd.to_numeric(gdf["Num_of_NMotorizedFatalities"], errors="coerce"),
            "nonmotorized_serious_injuries": pd.to_numeric(gdf["NumofNMotorizedSeriousInjuries"], errors="coerce"),
            "ownership": gdf["Ownership"].astype("string"),
        },
        geometry=gdf.geometry,
        crs=4326,
    )
    out.to_parquet(HIN_TABLE, index=False)
    return out


if __name__ == "__main__":
    build_signals()
    build_aadt()
    build_stations()
    build_hin()
