# Commuter redesign: preservation and migration map

Written 2026-10-12 before the commuter rebuild. A source backup was taken before any change.

## What stays, and where it moves

| Existing capability | Status | New location |
|---|---|---|
| Dashboard (hero, CrossScore cards, institutions grid) | Kept, unchanged | `/explore` (and `/` when `CROSSMETRIC_COMMUTER_HOME=0`) |
| Routes workspace, CrossScore, safer pickup, Uber review | Kept, unchanged | `/routes` |
| Analyze workspace (Priority for Review) | Kept, unchanged | `/analyze`, `/analyze/[id]` |
| Schools & colleges, compare, statewide map, reports, saved, methodology | Kept, unchanged | Same URLs, reached from the commuter app's menu |
| Valhalla routing, Photon geocoding (server-proxied, cached) | Reused | Commute planner calls the same clients |
| MapLibre + OpenFreeMap basemap | Reused | Commuter map |
| Community reports store (file or Postgres) | Kept; pattern reused | Parking observations use the same file-or-Postgres approach, in a new table/file |
| No accounts, no tracking | Kept | Schedules, origin, permit and parked car stay in the browser |

Nothing is deleted. The commuter home sits behind `CROSSMETRIC_COMMUTER_HOME` (default on); turning it off restores the previous home page.

## New, additive pieces

- `packages/engine/src/commute/`: pure, tested logic (zoned time, parking rule evaluator, observation aggregation, schedule/ICS normalization, arrive-by feasibility, reminder lifecycle, weather walking penalty, costs, RAPTOR transit search).
- `pipeline/commute/`: builds campus buildings/entrances/parking geometry (OpenStreetMap) and compact timetables (MARTA, UGA Campus Transit, Athens-Clarke County Transit GTFS) into `data/published/commute/`.
- `data/commute/`: hand-verified rule records (parking rules, night services, service-calendar exceptions, event overrides) with source URL, verification date and review expiry.
- `apps/web/src/app/(commute)`: the map-first student app. Existing pages move into the `(workspace)` route group so they keep the site header; URLs do not change.
- One additive migration for parking observations. No destructive schema change.

## Missing credentials and datasets (no secrets recorded here)

| Need | Why | Fallback today |
|---|---|---|
| GT Stinger schedule/realtime feed | No current public GTFS (Mobility Database mdb-355 ends May 2014) | Link to the official tracker |
| GT Stingerette booking API | Booking is through TransLoc OnDemand | "Open official booking" handoff |
| MARTA rail realtime key | Rail API requires registration | Scheduled times, labelled |
| Google / Microsoft OAuth client IDs, campus tenant consent | Calendar sync | Manual classes and `.ics` upload |
| Web Push keys, a job runner, server-side schedule storage with accounts | Push reminders when the app is closed | In-app reminders while open |
| Licensed live traffic | Drive times | OSM baseline time plus a stated buffer |
| Occupancy feed with capacity | Lot fullness | Expiring one-tap reports only |
| Covered/lit path inventory | Rain and night walking | Treated as unknown/exposed |
| Reddit API approval; Discord permission | Research agent | Disabled; first-party feedback only |
