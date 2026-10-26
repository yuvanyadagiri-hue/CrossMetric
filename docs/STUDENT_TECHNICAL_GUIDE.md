# Student technical guide

Plain-language explanations of every major system in CrossMetric, so you can explain the project to a judge yourself. For each system: what it does, why it exists, inputs, processing, output, the key algorithm, important files, and edge cases.

---

## 1. Data ingestion

**What it does.** Downloads schools, crashes, signals, traffic counts and validation data from government map servers (ArcGIS REST APIs), plus GDOT's road inventory file.

**Why it exists.** CrossMetric only uses authoritative public data, and it has to notice when a publisher changes its data format.

**Inputs.** Service URLs and the list of fields CrossMetric depends on, with their expected types (`pipeline/sources/catalog.py`).

**Processing.**
1. Fetch the layer's metadata and compare it with the expected fields (`compare_schema`). Missing or retyped fields stop the run.
2. Ask the server for every record ID, sort them, and download them in pages of up to 5,000 contiguous IDs.
3. Save each page to disk, so a failed download resumes where it stopped.
4. Convert ("adapt") the publisher's field names into CrossMetric's own names, e.g. `ACCIDENT_DATE` → `crash_date`.

**Output.** Parquet tables in `data/interim/`.

**Edge cases.** A server error is retried 5 times with growing waits; Esri geometry can be missing (the record is dropped and counted).

**Files.** `pipeline/sources/arcgis.py`, `pipeline/ingestion/*.py`.

---

## 2. Cleaning

**What it does.** Removes crash records that can't be trusted and records why.

**Key idea.** Each crash fails at most one rule, checked in order: no coordinates, county centroid, outside Georgia, geometry disagreeing with the report's own X/Y, placeholder coordinate, missing date, future date, duplicate report, private property.

**The placeholder rule (worth explaining).** Many crashes share an exact coordinate because GEARS snaps reports to road points; that's normal. A coordinate is a placeholder only if it spans 3+ counties, is a round number, or is an "isolated stack" with almost no crashes nearby. See Engineering Challenge 3 for why the first version of this rule was wrong.

**Files.** `pipeline/cleaning/crashes.py`.

---

## 3. GeoPandas and Shapely

**GeoPandas** is pandas (a table library) where one column holds shapes: points, lines, polygons. **Shapely** does the geometry math: distances, buffers ("everything within 30 m"), intersections, splitting lines. An **STRtree** is a spatial index, like a book index for locations, that answers "which roads are near this point?" without checking all 210,810 roads.

---

## 4. Coordinate systems

Latitude/longitude are angles, not distances. To measure meters you must *project* the Earth onto a flat plane, and every projection distorts something. Web Mercator (what most web maps use) stretches distances by about 20% in Georgia. CrossMetric uses the Georgia Statewide Lambert projection, designed for Georgia, with at most 0.059% error. Every buffer and distance in the pipeline is computed there.

**Files.** `pipeline/config.py` (`ANALYSIS_CRS`).

---

## 5. Building candidate locations

**Intersections.** For every place two roads meet or a road ends, CrossMetric measures which directions you can drive away from that point. Three or more distinct directions make an intersection. Interstates don't count (so bridges aren't intersections), ramps count only at their ends, and points within 35 m merge (so a divided highway crossing a street is one intersection).

**Segments.** Road length more than 76.2 m (250 ft) from any intersection is "mid-block." It is cut into equal pieces no longer than 250 m, so a long road can't outrank a short one just by being long.

**Names.** GDOT has no street names, so names come from the Census TIGER map. A name is accepted only if the whole piece of road lies within 15 m of it.

**Files.** `pipeline/geospatial/intersections.py`, `segments.py`, `naming.py`, `candidates.py`.

---

## 6. Spatial joins: matching crashes and traffic

A **spatial join** connects records by location instead of by an ID. CrossMetric's rules:
1. Snap the crash to the nearest road centerline within 30 m. Farther away → "off network."
2. On an interstate mainline → excluded (pedestrians aren't there).
3. Within 76.2 m of an intersection *that the snapped road belongs to* → that intersection.
4. Otherwise → the mid-block unit on the same road.

Each crash counts for at most one location, so nothing is double-counted. Traffic volume (AADT) is matched by GDOT's route ID **and** distance, so a side street never borrows a highway's traffic.

**Files.** `pipeline/geospatial/association.py`, `traffic.py`.

---

## 7. Normalization

Crash counts, vehicles per day and meters have different units. Each indicator becomes a **percentile** among the candidates around the same school: "what share of locations here have this value or less?" Example: with values 0, 0, 2, 5, the "2" scores 75 and the "5" scores 100. Zero crashes scores 0 (no evidence adds no priority). Distance is reversed, so closer means higher.

**Files.** `packages/engine/src/normalize.ts`, `pipeline/scoring/model.py`.

---

## 8. The CrossMetric score

`priority = (w1·s1 + w2·s2 + …) / (w1 + w2 + …)` over the five components that have data. In the Standard scenario every weight is 1, which is the transparent choice when there's no evidence that one indicator matters more. If AADT is missing, Traffic Context drops out and the other four are averaged. Scores 80+ are "High Priority for Review", 60–79 "Elevated", 40–59 "Moderate", below 40 "Lower." The weights live in **one** file, `packages/engine/model/crossmetric-model.json`.

---

## 9. Sensitivity analysis

Weights are assumptions, so CrossMetric tests them. Three alternate scenarios each double one weight (pedestrian, injury, crash history). For each location, CrossMetric reports its rank under all four. The **spread** (worst rank − best rank) defines stability: High if it moves at most ~10% of the list, Moderate at most ~25%, otherwise Low. Across Georgia, 91.3% of each school's top-5 stay top-5 under every scenario.

**Files.** `packages/engine/src/sensitivity.ts`.

---

## 10. Explanations without AI

The explanation text is built from templates filled with computed numbers: "This location ranks in the 95th percentile for pedestrian-involved crash evidence (2 crashes)." No language model is involved, so the same data always gives the same words, and every word can be traced to a number.

**Files.** `packages/engine/src/explain.ts`.

---

## 11. Resource Planner

Given N reviews, walk down the ranked list and take locations in order, skipping any location within 100 m of an already-chosen one **on the same road** (one site visit covers both). Skipped locations are listed, not hidden. A selection is "robust" if it would be reached under every weighting scenario.

**Files.** `packages/engine/src/planner.ts`.

---

## 12. PostGIS

PostgreSQL is a database; PostGIS adds geographic types (`geography(Point)`, `LineString`), spatial indexes (GiST) and functions like `ST_DWithin` (within a distance) and `ST_Distance`. The schema stores schools, candidate locations, crashes, traffic counts, reference analyses and validation runs, with constraints that enforce the pipeline's rules. For example, a crash is "assigned" if and only if it points to a candidate, and missing AADT can never be stored as 0.

**Files.** `supabase/migrations/*.sql`, `pipeline/publish/postgis.py`, `apps/web/src/server/postgis-repository.ts`.

---

## 13. MapLibre and the web app

**MapLibre GL** draws vector maps in the browser with WebGL. CrossMetric adds layers on top of an OpenStreetMap basemap: the analysis circle, crash dots, road segments colored by priority, intersection circles and rank labels. The map and the list are one system: clicking either selects the location everywhere. All analytical state (radius, scenario, selection, capacity) lives in the URL, so a link recreates the exact analysis.

When you change a control, nothing is sent to a server. The browser re-runs the scoring engine on the school's data package (pure TypeScript, a few milliseconds), and the map, list and panels update.

**Files.** `apps/web/src/components/map/AnalysisMap.tsx`, `apps/web/src/components/workspace/*`, `apps/web/src/lib/workspace.ts`.

---

## 14. How we know it works

- **Unit tests** check each rule with tiny hand-built examples (synthetic, clearly labeled).
- **Parity test**: Python and TypeScript must produce bit-identical scores on real schools.
- **Data-contract test**: the real statewide output must satisfy every database constraint.
- **End-to-end test**: a real Chrome browser performs the whole demo.
- **Validation**: comparison with ARC's independent High Injury Network, an out-of-sample persistence check, and a traffic-data cross-check.
