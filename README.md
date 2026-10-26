# CrossMetric

> **Latest version (Oct 25 2026): "Map. Plan. Move."** The app at `/` has four tabs over one map: **Explore** (search, timetabled departures near you, barriers reported nearby), **Routes** (plan a trip and pick Fastest, Safest, Most accessible or Lowest cost), **Report** (report a blocked sidewalk, missing curb ramp or crossing problem at a map pin) and **Community** (open and fixed reports, "I see this too" / "It's fixed"). The first section of [docs/COMMUTER.md](docs/COMMUTER.md) describes it in full.

**CrossMetric** (`/`) is a map-first transportation app for anywhere in Georgia: given where you are, where you want to go and how you like to travel, it compares your real options — walking, biking, driving, transit on published timetables, and driving to a MARTA station with parking — and says plainly what it does not know. Georgia Tech and UGA are an optional campus context that adds buildings, verified parking rules, classes and night services. See [docs/COMMUTER.md](docs/COMMUTER.md) for how plans are computed, which data is verified, and what is still blocked.

- **Explicit timing**: every new search is *Leave now*; *Depart at* and *Arrive by* use a Georgia-time date and time. A time that has passed is rejected, never moved to tomorrow.
- **Preferences that matter**: hard constraints (ways to travel, walking limit, transfers, step-free access) decide what is offered; a priority (balanced, fastest, lowest cost, least walking, fewest transfers, fewer risk indicators) picks the best match. Labels (Fastest, Shortest, Lowest cost, Less walking, Fewer transfers, Fewer risk indicators) appear only when an option is genuinely different, with an explanation built from its own numbers.
- **Nearby transit**: MARTA, Athens-Clarke County Transit and UGA Campus Transit stations and stops ranked by routed walking time, with scheduled (never "live") departures and published accessibility.
- **Campus tools** (optional): parking eligibility for the whole stay from hand-verified rules, one-tap availability reports, classes and in-app reminders, official night services.
- **At a glance**: every option has a proportional journey bar (walk, wait, each line in its own colour, drive, the stated planning buffer), the quickest time per way of travel, and a countdown to the scheduled departure.
- **Share a trip** as a link that reopens the same search. Your current location is never put in a link; the start is included only if you choose.
- **Installable** on phones and desktops, with an offline shell: saved places, settings and the last result open without a connection.
- No account. Places, searches, classes, permits and the parked car stay in the browser.

The safety-intelligence layers below are unchanged and reachable from the app's settings (`/explore`, `/routes`, `/analyze`, …).

**Safety intelligence for how students move.**

CrossMetric combines Georgia transportation, roadway, infrastructure and crash data in two layers that share one engine:

- **Move** — plan a trip to any Georgia school, college or address and compare the **safest, balanced and fastest** routes and every **transportation mode**, each with a **CrossScore** (0–100) that explains which conditions along the route drive it. Rideshare trips get a **safer pickup / drop-off** comparison.
- **Analyze** — rank the roads and intersections around a school or college by **Priority for Review**, with the evidence behind each number, so professionals know where to look first.

It is explainable decision support: it does not predict crashes or declare any road or trip safe.

Built for the 2026 Congressional App Challenge.

| | |
|---|---|
| Schools | 2,336 Georgia public schools (NCES 2024–25; full-time virtual schools excluded) |
| Colleges | 110 degree-granting Georgia colleges and universities (IPEDS 2024–25) |
| Crash evidence | 1,047,564 cleaned GDOT crash records, Oct 3 2023 – Aug 31 2026 |
| Candidate locations | 235,866 intersections and road segments built from GDOT's 2025 road inventory |
| Model | Deterministic, versioned, identical in Python and TypeScript (parity-tested) |

## What it does

**Move (2.0)**

1. **Plan** a trip on the Dashboard or Routes page (walk, bike, transit, drive, rideshare; leave now or later).
2. CrossMetric asks a routing service for the fastest route, alternatives, a sidewalk/bike-path-preferring route and a route that avoids the crash clusters it finds, then scores each with **CrossScore** using statewide GDOT crashes, road inventory, traffic counts, signals and OpenStreetMap infrastructure.
3. **Compare** safest / balanced / fastest, every mode, and (for rideshare) nearby pickup and drop-off points; review the pickup and destination and continue in Uber (needs `NEXT_PUBLIC_UBER_CLIENT_ID`, see [docs/DATA_SETUP.md](docs/DATA_SETUP.md)), or open the ride in Lyft.
4. **Explore** Schools & Colleges profiles, compare institutions, browse the statewide map (crash density, High Injury Network, MARTA, reports), and file **community reports**.

**Analyze (v1, unchanged)**

1. **Search** any Georgia public school.
2. CrossMetric ranks every nearby intersection and mid-block road segment by **Priority for Review (0–100)**.
3. **Select** a location to see exactly why it ranks there: score breakdown, percentiles, crash records, traffic, provenance.
4. **Change** radius, period, crash filter or scoring scenario; everything recomputes instantly.
5. **Compare** up to four locations side by side.
6. **Resource Planner**: enter how many reviews are possible and get the highest-priority distinct locations.
7. **Methodology** explains data, processing, scoring, sensitivity, validation and limitations, using live numbers.

## Architecture

```
            ┌──────────────── Python pipeline (offline) ─────────────────┐
NCES  ─┐    │ validate schemas → clean & quarantine → Georgia Lambert CRS │
GDOT  ─┼──▶ │ → intersections & segment units → crash/AADT association    │ ──▶ data/published/*.json ──┐
Census ┘    │ → validation experiments → parity fixture                   │ ──▶ Supabase PostGIS ───────┤
            └─────────────────────────────────────────────────────────────┘                             │
                                                                                                         ▼
            ┌──────────── Next.js 16 web app ────────────┐   ┌──── @crossmetric/engine (TypeScript) ────┐
            │ repository (files | PostGIS) → API routes  │──▶│ features → percentiles → priority → rank │
            │ MapLibre map · list · evidence · planner   │◀──│ sensitivity · explanations · planner     │
            └────────────────────────────────────────────┘   └───────────────────────────────────────────┘
```

| Path | What it is |
|---|---|
| `pipeline/` | Python data pipeline (pandas, GeoPandas, Shapely, pyproj, NumPy) |
| `packages/engine/` | Scoring engine, pure TypeScript, plus the shared model file `model/crossmetric-model.json` |
| `apps/web/` | Next.js 16 App Router + React 19 + Tailwind 4 + MapLibre GL 6 + lucide icons |
| `packages/engine/model/crossscore-model.json` | CrossScore route model (versioned, shared) |
| `supabase/migrations/` | PostgreSQL + PostGIS schema |
| `pipeline/commute/` | Commuter data: campus buildings, entrances and parking shapes (OpenStreetMap); GTFS timetables |
| `data/commute/` | Hand-verified rule records for GT and UGA, each with source, check date and re-check date |
| `packages/engine/src/commute/` | Commuter logic: parking rules, RAPTOR transit search, arrive-by choice, schedules, reminders, weather, costs |
| `apps/web/src/components/commute/` | The commuter app (map, bottom sheet, panels) |
| `docs/` | Methodology, engineering challenges, student guide, CAC documents |

## Quick start

Requirements: Node 20.9+, Python 3.12+.

```bash
npm install
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[db,dev]"
```

Build the data (see [docs/DATA_SETUP.md](docs/DATA_SETUP.md); the GDOT road inventory is a one-time 766 MB download):

```bash
.venv/Scripts/python -m pipeline.ingestion.schools
.venv/Scripts/python -m pipeline.ingestion.crashes
.venv/Scripts/python -m pipeline.ingestion.reference_layers
.venv/Scripts/python -m pipeline.ingestion.roads
.venv/Scripts/python -m pipeline.ingestion.tiger_names
.venv/Scripts/python -m pipeline.run
.venv/Scripts/python -m pipeline.validation.run
.venv/Scripts/python -m pipeline.ingestion.colleges
.venv/Scripts/python -m pipeline.institutions
.venv/Scripts/python -m pipeline.publish.statewide
```

Run the app:

```bash
npm run dev
```

Open http://localhost:3000. With `DATABASE_URL` set in `apps/web/.env.local`, the app reads from PostGIS instead of the published files.

The commuter app at `/` needs only its own data (no crash pipeline):

```bash
.venv/Scripts/python -m pipeline.commute.campus
.venv/Scripts/python -m pipeline.commute.transit
```

## Tests

```bash
npm test                                   # engine (167) + web unit/integration (125; 10 live tests opt-in)
CROSSMETRIC_LIVE_TESTS=1 npx vitest run test/trips.live.test.ts   # in apps/web: real routing service
.venv/Scripts/python -m pytest             # pipeline (37), incl. data contract on real output
CROSSMETRIC_LIVE_TESTS=1 npx vitest run test/commute.live.test.ts   # in apps/web: live commuter planning
CROSSMETRIC_LIVE_TESTS=1 npx vitest run test/journey.live.test.ts   # in apps/web: live Georgia-wide journeys
npm run test:e2e                           # commuter app + analysis flows in Chrome (Playwright)
```

## Responsible use

CrossMetric identifies patterns in historical public data. A high priority means the evidence near that location stands out **relative to other locations around the same school**. A CrossScore describes the conditions found along a route compared with similar streets; it is not a promise of safety. Neither replaces transportation engineers. Community reports are unverified community information. No personal data is collected; there are no accounts and no tracking, "Use my location" never leaves the browser except to plan the trip you asked for, and routing requests go through the CrossMetric server.

## Documentation

- [Methodology](docs/METHODOLOGY.md) · [Data setup](docs/DATA_SETUP.md) · [Engineering challenges](docs/ENGINEERING_CHALLENGES.md) · [Student technical guide](docs/STUDENT_TECHNICAL_GUIDE.md)
- CAC: [Demo plan](docs/CAC_DEMO_PLAN.md) · [Technical explanation](docs/CAC_TECHNICAL_EXPLANATION.md) · [Engineering challenge](docs/CAC_ENGINEERING_CHALLENGE.md) · [Purpose](docs/CAC_PURPOSE.md) · [Data credibility](docs/CAC_DATA_CREDIBILITY.md) · [Version 2](docs/CAC_VERSION_2.md)
