# Engineering challenges

A record of the real problems hit while building CrossMetric, in the order they came up. Each entry: problem, why it mattered, what was tried, the solution, the code, and the lesson.

---

## 1. Finding a crash source that actually answers

**Problem.** The obvious GDOT crash endpoint (`gis10.dot.ga.gov/.../GeoTRAQS`) accepted the TLS connection and then reset it for every request: curl, Python and a real browser alike. A second GeoPI URL found in an ArcGIS Online listing returned "Service may be stopped."

**Why it mattered.** Real GDOT crash data is Tier 1. Without it there is no product.

**Tried.** Browser user agents and headers (still reset); GDOT's SharePoint GeoPI app (no service URLs in the page); listing GDOT's ArcGIS Online organization (no crash layers).

**Solution.** Searching ArcGIS Online for items that point at GDOT servers revealed a third host, `enterprisegis.dot.ga.gov`. Enumerating its folders found `GeoPI/GEOPI_APP/MapServer/3` (Crashes, 1,251,087 records) and layer 4 (Traffic Signals). The harvester pages through it by contiguous runs of OBJECTIDs and caches every page, so a dropped connection costs one page, not the whole download.

**Code.** `pipeline/sources/arcgis.py` (`iter_pages`), `pipeline/sources/catalog.py`.

**Lesson.** Government GIS endpoints move. Discover services programmatically and record exactly which URL is used.

---

## 2. A field that doesn't mean what its name says

**Problem.** GDOT's `PEDESTRIAN` field is "1" on 1,241,213 of 1,251,087 crashes (99.2%).

**Why it mattered.** Pedestrian Evidence is a core component. Trusting the field would mark nearly every crash as pedestrian-involved, making the component meaningless.

**Tried.** Cross-tabulating `PEDESTRIAN = '0'` against collision type showed mostly angle and rear-end crashes, so "0" doesn't mean pedestrian either. `FIRST_HARMFUL_EVENT` turned out to be mostly empty.

**Solution.** The unit-type fields contain `00-Pedestrian`. A crash is pedestrian-involved when either recorded unit is a pedestrian: 7,852 crashes statewide over ~3 years, a plausible count. Because the public layer shows only two units, this is documented as a lower bound.

**Code.** `pipeline/ingestion/crashes.py` (`normalize`), test `test_normalize_derives_pedestrian_from_unit_types_not_the_gdot_flag`.

**Lesson.** Validate semantics, not just schemas. A field can exist, have the right type, and still be unusable.

---

## 3. My first data-cleaning rule was wrong

**Problem.** Some coordinates hold hundreds of crash reports. One point held 3,517 crashes reported in 42 different counties; others were round numbers like (-84.0, 33.0) or the corner of Georgia's bounding box.

**First attempt.** Quarantine any coordinate shared by 25+ reports. It removed **107,301** crashes.

**Why that was wrong.** Before trusting it, I profiled the stacks: 82–91% sit within ~2.5 m of a road centerline, fall in a single county, and 30–40% are intersection crashes. GEARS snaps many reports to road points. The rule was deleting real crashes at the busiest intersections, exactly where CrossMetric should find evidence.

**Solution.** A coordinate is a placeholder only if it has a signature no real place can have: (1) crashes from 3+ counties, (2) a round-number coordinate, or (3) an *isolated stack*, meaning 25+ reports with more than 25× the crashes found at every other coordinate within 100 m. Real busy locations are surrounded by GPS scatter (median stack-to-scatter ratio 2.5 across the 215 coordinates with 100+ crashes); defaults are not (95–459). The final rule removes **15,415** crashes and keeps about **92,000** legitimate ones.

**Code.** `pipeline/cleaning/crashes.py` (`default_location_mask`); tests `test_isolated_stack_is_a_default_but_a_busy_intersection_is_not`, `test_coordinate_shared_by_three_counties_is_a_default`.

**Lesson.** Check a cleaning rule against what it removes before keeping it.

---

## 4. Coordinate systems: the 20% error

**Problem.** Schools arrive in NAD83 degrees, crashes in Web Mercator, roads in WGS84 degrees. None can measure meters directly, and Web Mercator *looks* metric.

**Why it mattered.** Measured near Johns Creek, Web Mercator distances are **1.205×** true distance. An "800 m" buffer computed there covers ~664 m on the ground, silently shrinking every analysis.

**Solution.** Every geometry is projected to the Georgia Statewide Lambert Conformal Conic projection (the parameters of ESRI:102604, which GDOT uses) in meters. Its worst scale error anywhere in Georgia is **0.059%** (under 1 m across a 1.2 km analysis).

**Code.** `pipeline/config.py` (`ANALYSIS_CRS`); tests `test_analysis_crs_measures_true_meters_across_georgia`, `test_web_mercator_would_inflate_distances_in_georgia`.

**Lesson.** "Projected" is not the same as "distance-preserving." Measure the distortion.

---

## 5. What counts as an intersection?

**Problem.** GDOT's network is a linear-referencing system: features split wherever an attribute changes, concurrent routes can overlap, interstates cross streets on bridges, divided highways are two parallel lines, ramps cross over streets, and slip lanes create junction points near every big corner.

**Tried.** Counting how many line features touch a point. It fails on all of the above: an attribute break looks like a junction, an overpass looks like a crossing.

**Solution.** Count *directions* instead of features. An intersection is a point where surface roads leave in ≥ 3 distinct directions (bearings within 25° merged), or 2 surface directions plus a ramp end. Interstates never contribute (no false overpass intersections). Ramps count only at their ends (ramp terminals yes, flyovers no). Slip lanes never count. Nodes within 35 m merge, so a divided highway crossing a street (two nodes) is one intersection.

**Code.** `pipeline/geospatial/intersections.py`; eight synthetic-geometry tests in `pipeline/tests/test_geospatial.py` (overpass, ramp terminal vs flyover, divided highway, slip lane, concurrent routes, segmentation break, tiny-gap T, four-way).

**Lesson.** A precise definition that a person can state in one sentence beat a pile of special cases.

---

## 6. Naming: one route, several streets, and a hidden array-shape bug

**Problem.** The first statewide run labeled most intersections "X (junction)", with only one road name.

**Cause 1 (data).** GDOT's dictionary notes that a local Route ID "does not correspond to any particular named road." Keying names by route merged two different streets into one.

**Fix.** Name each *arm* (each direction leaving the intersection, 60 m) separately.

**Cause 2 (code).** Still wrong after the fix. Shapely's `STRtree.query()` returns a 1-D array for a single geometry but a 2-D `[input, tree]` array for many. I had written `query(...)[1]`, which took one element of the 1-D result, so every intersection saw exactly one leg.

**Code.** `pipeline/geospatial/candidates.py` (`build_intersections`).

**Lesson.** When output looks plausible but wrong, inspect one case by hand. Isolating a single intersection showed the arms named correctly in a scratch script but not in the pipeline, which pointed straight at the array shape.

---

## 7. Street-name conflation without cross-street mistakes

**Problem.** Matching a GDOT segment to the TIGER road with the most overlap inside a buffer fails for short units: a perpendicular cross street overlaps a 40 m unit almost as much as the road itself.

**Solution.** Use the worst case: sample 9 points along the GDOT line and require *all* of them within 15 m of the named road. A cross street touches only the middle sample, so it can never win. Ties prefer a street name ("Medlock Bridge Rd") over a route number ("State Rte 141").

**Code.** `pipeline/geospatial/naming.py`; test `test_name_conflation_prefers_the_aligned_road_not_the_cross_street`.

---

## 8. Traffic data: missing is not zero, and verifying a second-hand source

**Problem A.** Most local streets have no GDOT count. Treating missing AADT as 0 would claim "no traffic" and push those locations down for the wrong reason.

**Solution A.** Unavailable stays `null` all the way to the screen ("Unavailable", never "0"); the Traffic Context component is excluded and the remaining weights are rescaled. The database enforces `(aadt is null) = (aadt_status = 'unavailable')`.

**Problem B.** GDOT's road inventory download has no AADT, GDOT's traffic server was unreachable, and the TADA app has no public bulk API (its JavaScript is obfuscated, and reverse-engineering it would be fragile and inappropriate). The best available statewide 2023 AADT segment layer is a republication on ArcGIS Online.

**Solution B.** Use it, label it honestly, and *test* it: matched to GDOT's own count stations (a separate 2008–2017 copy), the values agree with Spearman ρ = **0.984** across 20,971 stations, with a median 2023/2017 ratio of **1.01**. AADT is matched by GDOT route ID, so a side street never borrows a highway's volume.

**Code.** `pipeline/geospatial/traffic.py`, `pipeline/validation/run.py` (`aadt_crosscheck`).

---

## 9. The newest month was almost empty

**Problem.** September 2026 contained 23 crashes against ~27,000–33,000 in every other month, because GDOT was still loading reports.

**Why it mattered.** The "most recent 12 months" period would silently include a near-empty month.

**Solution.** The window ends at the last *complete* month (at least half the median monthly volume) and never starts before the layer's first record. The Methodology page charts the monthly counts and states how many records were excluded.

**Code.** `pipeline/run.py` (`analysis_window`).

---

## 10. Metro Atlanta is one giant region

**Problem.** Schools whose areas overlap are processed together so a location near two schools is built once with one ID. Metro Atlanta merges into a single 1,256 km² region with 23,351 intersections. Building segment units subtracted one giant union of every intersection zone from every road, and the statewide run stalled on region 1.

**Solution.** Index the zones with an STRtree and subtract only the zones near each road. The largest region now builds in ~2 minutes; the full statewide build takes ~10.

**Code.** `pipeline/geospatial/segments.py`.

---

## 11. Two languages, one answer

**Problem.** Scores are computed in TypeScript in the browser (instant interaction) and in Python for validation and PostGIS. Any difference would mean the validated model is not the one people see.

**Details that mattered.** Floating-point sums must happen in the same order; JavaScript's `setUTCMonth` overflows (Mar 31 − 1 month = Mar 3) while Python's `relativedelta` clamps (Feb 28); Python's `round()` is banker's rounding while JavaScript rounds half up.

**Solution.** One shared model file; components summed in fixed order; an explicit clamped-month function; `floor(x + 0.5)` rounding in both. A parity test runs 15 real configurations and requires **bit-identical** priorities, ranks, bands and stability.

**Code.** `pipeline/scoring/model.py`, `packages/engine/src/score.ts`, `packages/engine/src/features.ts` (`addMonthsClamped`), `packages/engine/test/parity.test.ts`.

---

## 12. Web platform surprises

- **MapLibre 6 worker.** The tile worker is a separate ES module the bundler doesn't emit, so the map failed with "Worker failed to load." Fix: copy the worker and its shared chunk to `public/` before dev and build, and call `setWorkerUrl()` (`apps/web/scripts/copy-maplibre-worker.mjs`).
- **Every click re-fetched the school.** `router.replace()` on a dynamic page round-trips to the server. Analytical state now uses `window.history.replaceState`, which Next.js syncs with `useSearchParams` without a request (`apps/web/src/lib/workspace.ts`).
- **A 3,935-px-tall map.** In a column flexbox, `flex-basis` overrides `height`, so the grid grew to fit the list. Fix: `lg:flex-none` plus a `minmax(0, 1fr)` grid row.
- **Contrast.** Two color tokens measured below WCAG AA (2.58:1); both were darkened after computing ratios.
