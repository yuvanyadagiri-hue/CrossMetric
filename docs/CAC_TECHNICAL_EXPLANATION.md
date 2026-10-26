# Technical explanation

## Technologies and what each contributes

| Technology | Role in CrossMetric |
|---|---|
| **Python 3** | The offline data pipeline: ingestion, cleaning, geospatial processing, validation |
| **pandas / NumPy** | Tabular processing of 1.25 million crash records; vectorized statistics |
| **GeoPandas / Shapely 2** | Geometry: projecting, buffering, intersecting lines, measuring distances, spatial indexes (STRtree) |
| **pyproj** | Coordinate-system transformations into the Georgia Statewide Lambert projection |
| **pyogrio (GDAL)** | Reading GDOT's 1.1 GB Esri File Geodatabase |
| **ArcGIS REST APIs** | Live access to NCES, GDOT, Census and ARC data, with schema validation |
| **PostgreSQL + PostGIS (Supabase)** | Durable geographic storage with geography types, GiST spatial indexes and constraints |
| **TypeScript** | The scoring engine, shared by the browser; strict mode, no `any` |
| **Next.js 16 / React 19** | Server-rendered pages, API routes, and the interactive analysis workspace |
| **MapLibre GL JS 6** | WebGL vector map with interactive, data-driven layers |
| **Tailwind CSS 4** | Design tokens derived from the CrossMetric brand |
| **Vitest, pytest, Playwright** | Unit, parity, integration, data-contract and end-to-end tests |

## How a result is produced

1. **Ingest.** Schools (NCES), crashes, signals and traffic (GDOT), names (Census), validation data (ARC). Every source's live schema is checked first.
2. **Clean.** Nine quality rules; 203,500 crash records quarantined with reasons (e.g. 50,708 at county centroids, 136,331 in parking lots).
3. **Project.** Everything to Georgia Statewide Lambert in meters (Web Mercator would overstate distances by 20%).
4. **Build candidates.** 111,010 intersections (detected by counting distinct travel directions) and 124,856 mid-block segment units of at most 250 m.
5. **Associate.** Each crash is matched to at most one location (≤ 30 m snap, 76.2 m intersection zone, same-road rule); AADT is matched by GDOT route ID.
6. **Publish.** One compact data package per school; optionally loaded into PostGIS.
7. **Score in the browser.** Percentiles → weighted priority → rank → stability under four scenarios → explanation → planner. Changing any control recomputes in milliseconds.

## What is original

- Turning statewide crash, road and traffic data into **school-centered candidate locations** with stable identities.
- The **direction-counting intersection rule** that handles overpasses, ramps, divided highways and LRS segmentation in one definition.
- **Evidence-tested data cleaning**, such as the stack-isolation test that separates placeholder coordinates from busy intersections.
- **Explainability without AI**: every sentence is generated from computed values.
- **Sensitivity and robustness** built into the product, not just reported.
- A **Resource Planner** that turns rankings into a capacity-limited decision, with geographic de-duplication.
- **Cross-language parity**: the browser engine and the validated Python reference produce bit-identical results.

## Testing

- 53 engine tests (TypeScript), including 15 parity cases on real school packages
- 37 pipeline tests (Python), including synthetic-geometry geospatial tests and a data contract on the real output
- 16 web unit and integration tests calling the real API routes
- 2 end-to-end browser tests covering the full demonstration flow
