# Data credibility

Every dataset CrossMetric uses, who publishes it, how it is accessed, and how it is checked.

| Dataset | Publisher | Access | Records | Purpose | Checks |
|---|---|---|---:|---|---|
| Public School Locations 2024-25 (EDGE geocodes) | National Center for Education Statistics | ArcGIS REST, `nces.ed.gov/opengis/.../EDGE_GEOCODE_PUBLICSCH_2425` | 2,349 GA | School names and coordinates | Live schema check; coordinates inside Georgia; 13 full-virtual schools excluded |
| Public School Administrative Data 2024-25 (CCD) | NCES | ArcGIS REST, `EDGE_ADMINDATA_PUBLICSCH_2425` | 2,329 GA | District, level, status, virtual flag | Joined on 12-digit NCES ID, one-to-one validated |
| GeoPI Crashes (GEARS) | Georgia Department of Transportation | ArcGIS REST, `enterprisegis.dot.ga.gov/.../GeoPI/GEOPI_APP/MapServer/3` | 1,251,087 | Crash location, date, injuries, unit types, lighting | Live schema check; 9 quality rules; 203,500 quarantined with reasons; semantic check of the `PEDESTRIAN` field |
| Road Inventory 2025 Geodatabase | GDOT Office of Transportation Data | Official download, `myfiles.dot.ga.gov/OTD/RoadAndTrafficData/` (data dictionary updated Apr 17 2026) | 210,810 sections | Road geometry, functional class, ramps, divided highways, lanes | Geometry validity repair; empty geometry dropped; Route ID decoded per GDOT dictionary |
| Traffic Counts, AADT segments (2023) | GDOT (republished on ArcGIS Online) | ArcGIS REST | 44,600 | Traffic exposure | Cross-checked against GDOT count stations: Spearman 0.984, median ratio 1.01 |
| GDOT count-station AADT 2008–2017 | GDOT (copy hosted by City of Sandy Springs) | ArcGIS REST | 26,927 | Only for verifying the 2023 AADT | n/a |
| GeoPI Traffic Signals | GDOT | ArcGIS REST, layer 4 | 4,024 | Informational signal flag | Out-of-service signals excluded; absence shown as "no GDOT record" |
| TIGERweb Transportation | U.S. Census Bureau | ArcGIS REST, tiles near schools | 234,607 named features | Street names | Name accepted only if the whole road piece is within 15 m |
| Regional High Injury Network (2019–2023) | Atlanta Regional Commission | ArcGIS REST | 3,351 | Independent validation only, never used in scoring | n/a |

## Notes on provenance

- **Crash data** comes directly from GDOT's GeoPI service. GDOT's older GeoTRAQS server refused connections during development; the GeoPI layer is the current public source.
- **AADT** is the one dataset not served by GDOT directly: GDOT's road inventory download contains no AADT, GDOT's traffic server was unreachable, and the TADA traffic application has no public bulk interface. The 2023 AADT segment layer used here carries GDOT route IDs and GDOT's "Future AADT" projection field, and its values match GDOT's own station counts closely (see Validation). The app labels it "GDOT traffic counts" and the Methodology page states how it was obtained.
- **Synthetic data** appears only in unit tests (clearly labeled hand-built geometries and records) and is never shown in the app.
- **Retrieval date:** October 3, 2026. The crash window used is October 3, 2023 – August 31, 2026 (the last complete month).
