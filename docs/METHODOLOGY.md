# CrossMetric methodology (model 1.0.0)

The in-app Methodology page (`/methodology`) presents this with live numbers. This file is the reference version and the model changelog.

## 1. Question

Around a given school, which intersections and road segments have the strongest historical evidence that they deserve professional safety review first? CrossMetric ranks; it does not predict, certify, or prescribe.

## 2. Data

| Dataset | Publisher | Use |
|---|---|---|
| Public School Locations 2024-25 (EDGE) | NCES | School names, coordinates (NAD83) |
| Public School Administrative Data 2024-25 (CCD) | NCES | District, level, status, virtual flag |
| GeoPI Crashes (GEARS) | GDOT | Crash location, date, injuries, fatalities, unit types, lighting, location of impact |
| Road Inventory 2025 Geodatabase (HPMS items) | GDOT | Road geometry, functional system, facility type, lanes, LRS route IDs |
| Traffic Counts, AADT segments (2023) | GDOT (ArcGIS Online republication) | Traffic exposure |
| GeoPI Traffic Signals | GDOT | Informational signal flag |
| TIGERweb Transportation | U.S. Census Bureau | Street names |
| Regional High Injury Network (2019-2023) | Atlanta Regional Commission | Validation only |

### Crash cleaning (each record fails at most one rule)

| Rule | Records |
|---|---:|
| Located at a county centroid (location unknown) | 50,708 |
| Outside Georgia | 977 |
| Placeholder (default) coordinate | 15,415 |
| Date after the data snapshot | 69 |
| Private property (parking lots) | 136,331 |
| Partial month after the window | 23 |
| **Clean, in window** | **1,047,564** of 1,251,087 |

Pedestrian involvement = either recorded unit is `00-Pedestrian` (GDOT's `PEDESTRIAN` flag is "1" on 99.2% of crashes and is not used). Injury = injuries > 0 or fatalities > 0. Low light = dawn, dusk, dark-lighted or dark-unlighted.

Analysis window: up to 36 months ending on the last month GDOT has fully loaded (a month counts as complete with at least half the median monthly volume), never before the layer's first record. Current window: 2023-10-03 to 2026-08-31.

## 3. Spatial processing

- **CRS.** All geometry is projected to Georgia Statewide Lambert Conformal Conic (ESRI:102604 parameters, meters). Worst scale error in Georgia: 0.059%. Web Mercator, GDOT's native CRS, overstates distances by ~20%.
- **Road roles** (from the Route ID's function type and HPMS F_SYSTEM): surface streets; access-controlled (Interstate / freeway mainlines, managed lanes); ramps and collector-distributors; Y-connector slip lanes.
- **Intersections.** A point where surface roads leave in ≥ 3 distinct directions (bearings within 25° merged), or 2 surface directions plus a ramp end. Access-controlled roads never contribute; ramps only at endpoints; slip lanes never. Nodes within 35 m are merged into one intersection.
- **Segment units.** Surface road outside every 76.2 m intersection zone, merged per route, cut into equal units ≤ 250 m (units < 30 m dropped). Only the inventory (INC) carriageway produces units.
- **Names.** TIGER names conflated by worst-case distance of 9 sample points (≤ 15 m); each intersection arm named separately. Fallback: "SR n" for state routes, "Unnamed road".
- **Crash association.** Nearest centerline ≤ 30 m → interstate mainline excluded → intersection if ≤ 76.2 m and the snapped road is one of its legs → otherwise nearest unit on the same route key (opposite carriageway included) → ramp crashes away from terminals excluded.
- **Traffic.** AADT matched by GDOT route key and distance (≤ 30 m segments, ≤ 90 m intersections). Intersection volume = sum of crossing roads' AADT; "partial" if some roads lack counts; "unavailable" stays null.
- **Regions.** Overlapping school areas (1,350 m buffers) are processed together so each location is built once with one stable ID (SHA-1 of rounded projected coordinates).

## 4. Indicators

| Component | Measure |
|---|---|
| Crash Evidence | matched crashes (period + filter) |
| Injury Evidence | matched injury-or-fatal crashes |
| Pedestrian Evidence | matched pedestrian-involved crashes |
| Traffic Context | AADT (or entering-volume estimate) |
| School Proximity | straight-line distance, school to nearest point of the location |

## 5. Normalization

Empirical percentile within the analysis population (candidates inside the radius):
`score(v) = 100 × #{values ≤ v} / N`, reversed for distance. Evidence components score 0 when the count is 0. Unavailable values are excluded.

## 6. Scoring

`priority = Σ wᵢ·sᵢ / Σ wᵢ` over components with data, summed in fixed order (bit-identical in Python and TypeScript). Standard weights are all 1; each emphasis scenario doubles one weight. Bands: High ≥ 80, Elevated 60–79, Moderate 40–59, Lower < 40, evaluated on the rounded score. Tie-break: priority, crashes (desc), distance (asc), ID.

## 7. Sensitivity

Rank under all four scenarios; spread = worst − best. High if spread ≤ max(2, ⌈0.10 N⌉), Moderate if ≤ max(4, ⌈0.25 N⌉), else Low. Resource Planner selections are "robust" if reached under every scenario.

## 8. Validation (model fixed before running; see `data/published/validation.json`)

| Experiment | Result |
|---|---|
| ARC High Injury Network, 776 metro schools, 800 m | Top-5 on HIN 60.5% vs 18.0% base rate (3.4×); AUC 0.855 (crash-only 0.830, distance-only 0.508); crash-only top-5 precision is higher (65.5%) |
| Persistence (score on first 24 months, check later months), 2,230 schools | Top-5 locations: 2.94 later crashes each vs 0.34 for others (8.6×); 44.7% of later crashes at 11.1% of locations; median Spearman 0.37 |
| AADT cross-check vs GDOT 2017 stations | 20,971 stations; Spearman 0.984; median ratio 1.01; 70.4% within ±25% |
| Robustness, 2,307 schools | 91.3% of Standard top-5 stay top-5 under every scenario |

## 9. Limitations

See the in-app Limitations section: reporting completeness, relative scores, pedestrian lower bound, grade-separation ambiguity, local streets without AADT, AADT provenance, unobserved infrastructure (sidewalks, crosswalks, lighting, speed), partial signal inventory.

## 10. CrossScore (routes)

CrossScore 1.0.0 (`packages/engine/model/crossscore-model.json`, engine `packages/engine/src/crossscore.ts`) scores a route 0–100; higher means fewer risk indicators were found. It is not a prediction or a promise of safety.

- **Crash factors** (all, injury/fatal, pedestrian, bicyclist): crashes within 30 m of the route divided by the number expected for that length of road at the average rate of roads in the same *setting*; `score = 100 / (1 + ratio × 30/70)` (none = 100, average = 70, twice average ≈ 54). Settings group ~1 km stretches of every Georgia public road by surrounding surface-street crash activity (cut at the 50th/75th/90th/97th percentiles of road mileage), plus interstates/freeways. Freeway crashes count only on freeway stretches of the route, and vice versa.
- **Road speed**: distance-weighted OSM posted limit → 100 × (1 − pedestrian fatality risk), Tefft (2011); only with ≥ 30% coverage.
- **Lanes** (GDOT through lanes) and **traffic volume** (GDOT AADT, FHWA STEP thresholds 9k/12k/15k).
- **Sidewalks** (walk) and **protected path availability** (bike) from OpenStreetMap; recorded facilities are a lower bound.
- **Crossing exposure**: crossings (not turns) of arterials or 4+ lane roads; GDOT signal records reduce the cost.
- Mode weights: walk emphasizes pedestrian crashes (3), bike emphasizes bicyclist crashes (3), drive uses crash history, injury crashes and crossings. Missing factors are excluded and reweighted, never zero.
- **Selection**: fastest = shortest time; safest = highest score within 1.6× (and +20 min) of fastest; balanced = highest `score − 25 × (time ratio − 1)`.

## Changelog

- **2026-10-05 — CrossScore 1.0.0** (new model; Priority for Review unchanged at 1.0.0). Adds route scoring, safer pickup/drop-off curb comparison, colleges (IPEDS) analyzed with the unchanged Priority for Review pipeline, and statewide reference distributions.

- **1.0.0** (2026-10-03): initial model. Five components, equal Standard weights, four scenarios, rank-range stability, 100 m planner coverage.
