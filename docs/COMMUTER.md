# CrossMetric app (Georgia-wide, with Georgia Tech and UGA campus tools)

Status as of 2026-10-25. The map-first app at `/`: Explore, Routes, Report and Community over one map, in the navy "Map. Plan. Move." design (see the first section). It answers: how can I get where I need to go, which available route fits my priorities, and what accessibility barriers are along the way? The campus tools (classes, campus parking, night services, ArriveBy) still answer: where should I go, and when must I leave to reach this class?

## Navy redesign (2026-10-25, latest): "Map. Plan. Move."

A full replacement of the presentation layer for the Congressional App Challenge, from the owner's master redesign brief. The product, APIs, engine, data and ranking are unchanged; the look, the navigation and the screen structure are new. It also reverses two earlier owner decisions on purpose, because the brief asked for them: **barrier reporting is back as a core feature** (the 2026-10-16 "no reporting" rule is superseded), and the palette is **navy with electric lime and route blue** (the Uber-green palette is gone).

**Brand.** Navy #07111F canvas, #030810 deep, #0D1929 elevated and #122136 secondary surfaces, #F5F8FC text, #9BAABD secondary text. Electric lime #91F24D only for the one primary action, the selected state and a positive result (navy text on it, 13.9:1). Route blue #42A5FF draws the selected route and links; teal #30D5C8 walking legs and timetabled departures; amber means an accessibility concern. Dark is the default appearance; the light appearance keeps the same roles. Tokens: `.cm-app` block in `globals.css`; shell geometry and the launch screen in `premium.css`. The mark (`brand/Logo.tsx`) is a geometric X: a lime and a blue path crossing at a navy node; app icons regenerated with `scripts/make-app-icons.mjs`. The dark basemap is retinted to navy at style load (`NAVY_PAINT` in `CommuteMap.tsx`). The old "interchange" drawing (`Network.tsx`) is deleted.

**Navigation.** Four destinations: **Explore** (`/`), **Routes** (`/trip`), **Report** (`/report`) and **Community** (`/community`). Account is the button beside the search on a phone and the foot of the rail on a desktop. Phone: map screens with a sheet that sits on a solid tab bar (`Navigation.tsx` `TabBar`); Account, its subpages, All services, Your trips, search and Arrived are full pages. Desktop (1024 px and up): a 76 px navy rail (`NavRail`), a 400 px panel (420 from 1280) holding every screen (`SidePanel.tsx`), and the map beside it on every screen; the phone frame and its marketing copy are gone (`Stage.tsx`). Tablet: the phone layout with the sheet and Explore bar capped at 640 px. Services and Activity are no longer tabs: Explore's "More" list and Account reach them.

**Explore** is map-first: the search ("Where to explore or check?"), four ways in (Plan route, Transit, Parking, Report), your trip and places, what is leaving near you (timetabled, labelled not live), the barriers reported nearby (open reports within 2 miles of you, else the newest), and a short "More" list (Arrive by, Rideshare, Night, Safety, All services). The "Now" chip (the time of the next search) moved into the sheet header. Search also answers accessibility words ("curb ramp", "crossing", "report"…) with the matching community reports and a "Report a barrier" row.

**Routes** (`PlanPanel.tsx`): "Plan a route" with the fields when there is no destination (recent searches underneath), else "To …" with the status line. Four route priorities (`PriorityPicker` in `journey-ui.tsx`) map onto the existing ranking engine, nothing is re-scored: Fastest = `priority: fastest`; Safest = `priority: safety` (CrossScore); Most accessible = `accessible: true` + `priority: least_walking` (only verified step-free routes); Lowest cost = `priority: cheapest`; tapping the chosen one again returns to Balanced. The choice is saved in `prefs.travel` and clears what a typed request set for that search. Three options show first ("N more options" for the rest). Every option now states step-free access (verified or not) and labels its CrossScore an estimate. The route sheet's half stop is 58% so two options sit above "Choose".

**CrossScore** (methodology unchanged, `packages/engine/src/crossscore.ts`): the detail card colours its ring by band (teal 75+, amber 50+, red below; never lime) and splits its inputs into recorded data (GDOT crash reports within 30 m over a rolling three-year window, road inventory, traffic counts) and mapped or estimated inputs (OpenStreetMap speed limits, sidewalks, bike lanes, and the comparison with similar Georgia streets), with "an estimate from past records, not a prediction or a safety guarantee".

**Report a barrier** (`ReportPanel.tsx`, state in `useCommunity.ts` `useReportFlow`, kept in the shell so a trip to search and back loses nothing): 1 where (the pin is the map centre: while choosing, the camera padding equals the uncovered area so the centre is exactly under the pin; the nearest address is reverse-geocoded after the map rests; My location and Search move the map), 2 what (Blocked sidewalk, Missing or inaccessible curb ramp, Pedestrian crossing issue, Damaged sidewalk, Missing sidewalk, Obstruction or construction, Other), 3 an optional note (the same validation as the server: 280 characters, no links, emails or phone numbers), 4 review, then "Report sent" only after the server answered 201 with the saved report; a refusal shows the server's reason and keeps everything. Photos are not collected (the backend stores none; the screen says so). New category `curb_ramp`: `lib/reports.ts` and migration `supabase/migrations/20261025000001_report_curb_ramp.sql`. The backend (`/api/reports`, file store or Postgres, rate limits, no personal data) is unchanged.

**Community** (`CommunityPanel.tsx`): counts (open, confirmed, reported fixed), Open / Reported fixed / All, a list (barrier, status, place, age), the reports on the map (amber open, larger once confirmed, grey once reported fixed, lime ring on the selected one), a detail with "I see this too" / "It's fixed" (existing vote API; one vote per device is remembered locally, the server rate-limits), "How reports work", and links to the crash-data analysis (Priority for Review, Methodology). There are no project or outcome records anywhere, so nothing called a "project" or an impact figure is shown.

**Analysis pages** (`/analyze`, `/schools`, `/map`, `/routes`, `/reports`, `/methodology`): the same brand scale (navy ink, route-blue links and primary buttons), a navy header with "back to the app", and labels that no longer clash with the app's tabs (Priority for Review, Schools & Colleges, Statewide map, Route CrossScore, Reports; the old dashboard is under More).

**Also:** branded 404 and error pages, a navy welcome (three slides: how to get there, the four priorities, reporting), `sw.js` cm-sw-4.0.0, manifest/theme colour navy, the Report shortcut, and a fix for a regex in `/api/places` whose word boundaries were literal backspace bytes (station-first ordering never applied).

**Verified 2026-10-25:** `tsc`, `eslint .`, vitest 150 passed (10 live skipped), `next build` (`NEXT_DIST_DIR=.next-build`), Playwright 33/33 (commuter 22 incl. new report and Community tests with the API answered in the test, ArriveBy 4, demo 5, Uber 2) against the dev server on :3100, a real report submitted through the UI to the file store (then removed), a live route search (Safest re-rank, details), and headless screenshots at 320, 375, 390, 768 and 1440 in dark plus light at 375. Not tested on a real phone.

## ArriveBy (2026-10-18): "be at this building by this time"

The signature feature. `/arrive` (map + sheet) answers: when do I leave, how do I go, where may I park with my permit, and what if that fails? Entry points: the dark "Need to be there by a set time?" card on Home (the next-class card's **Arrive by** button now opens ArriveBy with the class's building and time, minus your entry buffer), **Services → Campus → Arrive by**, and a link on arrive-by trip results for campus buildings. Tapping a building on the ArriveBy map sets it as the destination; tapping a parking place makes it the plan's place when it can be used, or says why not.

**Inputs.** Start (shared with trip search; location only on request, manual start always offered), a building (picker target `arrive`: campus buildings by name, alias or short name such as CULC; an address is allowed and is labelled "not a mapped campus building"), date and time in Georgia time (past times are refused, never rolled to tomorrow; quick chips for the next class, "In about an hour", "Tomorrow 9:00 AM"), how (Best / Drive / Transit / Walk), the parking permit (written to the same `prefs.permits` as Account; codes from the campus records are suggested), and under More options: "Leaving campus at" (a full-stay parking check with price) and Step-free. The last building and the preferred way are remembered on this device (`cm.arriveby.v1`); a time is never remembered.

**How it is computed.** `POST /api/arriveby/plan` (validated exactly like `/api/journey/plan`, arrival time as the deadline) runs the existing journey planner with a `JourneyCollector` (`server/journey/plan.ts`), which reports every campus parking place `driveCandidates` checked (eligible or not, routed or not) and every eligible option in ranked order. The pure engine `packages/engine/src/commute/arriveby.ts` (`buildArrivalPlan`) then makes one decision:

- **Components** (`arrivalComponents`): drive (clear-roads time to stated buffer), find a space (deck 2-5, lot 3-7 min: `PARKING_SEARCH_RANGE`, a planning assumption; the high end is the planner's buffer), walk to the entrance; or walk to the stop, wait, rides (timetable), walk, and one delay allowance. The high ends add up to exactly what the planner planned, so `leave-by = deadline - sum(high)` with nothing counted twice (tested). `latestIfSmooth` = leave-by + the ranges' slack; a transit departure is fixed by the timetable instead.
- **Parking** (`assessParking` / `chooseParking`): verdicts recommended / backup / eligible / uncertain / restricted / closed / full / unavailable from the existing `evaluateNow`/`evaluateStay` rules. Unknown, unpublished, expired (`reviewBy` passed) or unrouted places are never chosen. A place your permit covers (or a free one) beats a pay place unless paying lets you leave at least `PERMIT_PREFERENCE_MIN` (10) minutes later; otherwise the latest departure wins, then the shorter walk. A permit code that matches no place with rules is reported and treated as no permit. Occupancy: only recent community reports from the existing observation store (labelled "Reported full · not verified"); there is no live occupancy source, so every place normally says "Availability not verified".
- **Backup**: another eligible place with its trade-off ("Pay to park, adds about 7 min of walking, leave 9 min earlier. Availability has not been verified."), else the best other way to arrive in time, else a ride-hail drop-off (hand-off only), else an honest "no verified alternative". If the drive's place can't be used at all, the plan switches to another way and says so.
- **Comparison**: one best option per way of travelling, with leave-by, range and a plain "versus" line.
- **Confidence**: steady / variable / uncertain, from named reasons (no live traffic, rush hour, unpublished occupancy, rule record due for re-check, unconfirmed transit calendar, no mapped entrance, no backup). No score or percentage. Uncertain adds a suggested 10-minute margin.
- **Entrance**: `pickEntrance` (also used by the journey planner now) prefers a mapped step-free entrance when Step-free is on, else a main entrance; with no mapped entrance the plan says it routes to the building centre. Accessibility is reported as "CrossMetric can't confirm a complete step-free route" with what is mapped (community data) and what is not checked; it is never called verified.

Every source on screen carries its trust level (`lib/arriveby-format.ts`: Official / Live / Estimate / Community data / From you / Example data / Not available) and its checked and re-check dates. The server returns the engine's input (`basis`), and the app re-runs `buildArrivalPlan` on it, so switching Best/Drive/Transit or the parking place is instant and can never show a plan for other inputs. Plans older than 10 minutes, or whose leave-by has passed, are marked out of date with Refresh.

**Not built, on purpose:** live occupancy or traffic (no authorised source), barrier or availability reporting UI (owner rule: the rider app takes no reports), any stored trip or location. Accessible-parking locations are not modelled.

**Tests:** `packages/engine/test/commute-arriveby.test.ts` (21, fictional fixtures), `apps/web/test/arriveby.integration.test.ts` (10, real GT/UGA records with a fake router, including routing down), `apps/web/test/arriveby.unit.test.ts` (labels), `apps/web/e2e/arriveby.spec.ts` (4, live services, phone and desktop).

## Typography and surface system (2026-10-17): Inter Variable, tokens, fewer containers

A refinement of the screens below, not a new look: same palette, routes, flows and data. What changed:

**One typeface.** Inter Variable (`next/font/google`, `axes: ["opsz"]`, self-hosted, size-matched fallback; one 73 KB woff2 for the latin subset covers weights 100-900 and the optical-size axis, so headlines pick up Inter's tighter display cut automatically). Archivo (wide, 800) and Figtree are gone; `--font-display` is kept as an alias of the same stack so old `font-display` markup is harmless. Geist Mono stays for code and IDs only. MapLibre's own labels use the tile server's glyph fonts, which cannot be Inter.

**The scale** lives once, as CSS variables in `globals.css` (`--fs-*`, `--lh-*`, `--ls-*`, `--fw-*`), and is used two ways: the `.t-*` roles (size, line height, tracking and weight: `t-display`, `t-page`, `t-section`, `t-component`, `t-body`, `t-small`, `t-meta`, plus `t-num` for tabular figures) and size-only utilities (`text-display`, `text-page`, `text-section`, `text-component`, `text-body`, `text-small`, `text-meta`) that leave weight and colour to the element. Roles sit in the components layer, so `font-medium` and colour utilities on the same element win.

| Role | Size | Weight | Line | Use |
|---|---|---|---|---|
| display | 44-52 (12.3vw) | 700 | 1.15 | "Where to?", welcome, 404 |
| page | 32 | 650 | 1.2 | Services / Activity / Account headers, search page |
| section | 22 | 600 | 1.3 | panel titles, section headings, the duration on a route row |
| component | 18 | 600 | 1.35 | place and route names in cards, state titles |
| body | 16 | 400 (500 for controls) | 1.5 | search text, buttons, list titles |
| small | 14 | 400 | 1.45 | supporting text, cost, times, tags |
| meta | 12 | 500 | 1.4 | tags, journey-bar minutes, fine print only; never a route decision or an access/safety statement |

Weights: titles are 600, not 700/800; list titles and controls are 500; only the one primary button is 600. No uppercase labels remain (table headers and eyebrows are sentence case).

**Radii** are five steps, each with a job (`--radius-*` in `@theme`, utilities `rounded-tag|chip|ctl|surface|sheet`): tag 6 (badges), chip 10 (filters, segments, journey-bar parts), ctl 12 (buttons, fields, rows, the search bar's inner button), surface 16 (cards, the selected route, the search bar), sheet 20 (bottom sheet, dock block, ink cards). `rounded-full` is for round things only (map buttons, avatars, dots, switches). Floating map chrome is a solid surface with a short shadow (no blur: `.cm-glass`).

**Fewer containers.** A container now means something: the selected route (border + faint tint), the one ink "answer" card on the route detail, warnings (tinted), and the dark/green feature cards on Home. Everything else is type on the sheet, divided by hairlines: route options that are not selected, search results (bare icon, name 16/500, address 14/muted), Services (a list, not six tiles), Account (shortcuts and sections), Help, Safety (Call 911 stays tinted red), parking places (name, eligibility tag and a right-hand **walk-time column**), Activity empty states, the CrossScore block, neutral `StateMessage`s. The route row leads with the duration (22/600 tabular), then title, times, tags; "Fastest"/"Best match" are 6 px tags.

**Not changed on purpose:** the green/ink/warm-white palette, the interchange motif, the splash and welcome choreography, sheet physics and motion tokens (all already respected reduced motion), the map integration, and every API, route and data contract.

Checked 2026-10-17: tsc, eslint, vitest (134), Playwright `commuter`/`demo`/`uber` (28 passed) against a dev server, a production build, headless screenshots at 360, 390 and 1440 px in light and dark, the loaded font files and both Inter axes (a width test: opsz 14 vs 32 and weight 400/650/700 all measure differently). Not run on a real phone.

**Follow-up pass, same day.** The panels that first got only the token mapping now follow the same rules: Nearby (a station is a bare icon, name, what serves it, a right-hand *min walk* column and the next departures as a board; only the open station is a surface, with its walking route, access, parking and actions as plain rows), Parked / Back to car, Saved, Classes, the past-trip receipt, Arrived and the live trip (a bare icon on the one ink "current step" card, a divided *Safety | Stop times* row instead of two tiles, a timeline without circle tiles). `listRow()` in `panels/common.tsx` is the one selected-row style. On the workspace pages the 13 to 14 px and 15 to 16 px mapping needed three fixes at 390 and 768 px wide: the Analyze hero's `text-display` headline and the search input's intrinsic width pushed the page 4 px wider than a phone (`text-page sm:text-display`, input `w-0 min-w-0`); the four analysis selects clipped "Standard (Balanced)" and "Full window (~3 yr)" in narrow containers (they stack below a 380 px container); candidate and crash-cluster names wrap instead of being cut. Analyze, Schools, Methodology, Reports, Routes, Map, Explore and Saved were then measured for page overflow and clipped text at both widths (none left; the tables on Methodology scroll sideways by design).

## "Interchange" redesign (2026-10-16): Uber-green splash and Home (superseded 2026-10-25)

The owner found the app generic (a dark header with a grid and glow, four equal tiles, fake mini-map cards) and asked for a redesign from Dribbble's "uber" results. Colour history: Electric Lime was rejected ("I don't like the lime green"), Uber Blue was rejected ("Uber uses Green, White, Black"), so the palette is now **Uber's Green #06C167** (the Uber Eats green), **Black #111315** and **White** (warm white #F7F7F3). What was taken from the Dribbble shots: *Uber Green* (Conceptzilla) for flat colour blocks against near-black, giant bold type and black buttons; *Uber Launch Transition* for a full-bleed colour launch screen; Y Media Labs' autonomous concept and Fawaz's "A Clearer Journey" for big numbers on dark boards and a clear "Where are you headed?" start. Nothing is copied (no Uber artwork, logo or wording).

**One idea, the interchange.** Two transit lines at 45° meet at one station (`components/brand/Network.tsx`): the picture of "many ways, one crossing", and of the name CrossMetric. It is the launch screen, the pattern behind the green headers (very light), the welcome art and the 404. No glows, gradients or grids anywhere now.

**Colour rules** (`globals.css`, `premium.css`): near-black on Uber Green is 7.8:1, white on it only 2.4:1, so **nothing white ever sits on green**: type and icons on green are near-black (secondary text near-black at 75-80%, 5.5:1+), chips on green are a darker green (black at 10%). Green as text on the light canvas uses the darker #05713A (5.7:1); on near-black surfaces (dark theme, ink cards, the dark map) the green itself is 7.8:1. Tokens: `--app-accent`/`--app-on-accent`, dark `--app-primary`, `--app-route`, Tailwind utilities `bg-uber`, `text-on-uber`, `text-uber`, `text-uber-dk`, `bg-uber-tint`, and the hero variables in `premium.css`. To change the colour again, change those, `--color-uber*` in `@theme`, `scripts/make-app-icons.mjs`, `icon.svg`, `manifest.ts`, `layout.tsx` (theme-color), `RiderShell.tsx` (topColor), `CommuteMap.tsx` (`green`), `Splash.tsx` and `Welcome.tsx` (inline SVG fills).

| Piece | Now |
|---|---|
| Typeface | (Superseded 2026-10-17: Inter Variable only; see the first section.) Was Archivo wide over Figtree |
| Launch screen | Green field; three black lines draw across it and meet at a white station that opens out as the black mark draws; "CrossMetric / Move smarter."; then on Home it shrinks upward into Home's own green header (elsewhere it fades; chosen once at the first render). Pure CSS, server-rendered; tap to skip; reduced motion shows the final frame. `brand/Splash.tsx`, `premium.css` |
| Welcome | Three colour blocks (green, near-black, warm white) that blend as you swipe; the location primer stays near-black with green rings |
| Home | Green header: brand, campus chip, greeting with the next 45 minutes' weather when it can be read ("Dry for 45 min", "Light rain soon"), **Where to?**, white search field with a black *Now* pill, quick places. Sheet: your places and recents, *Coming up* (next class), **Ways to go** (flat tiles with black pictograms), **Leaving near you** (a near-black departure board with real scheduled MARTA/UGA/ACC times, or a one-tap "Use my location" card), **More from CrossMetric** (colour-blocked cards: black, green, white). `panels/ExplorePanel.tsx` |
| Tab pages | Services, Activity and Account share the green header (`TabPage` in `ui.tsx`) |
| Map | Route, selected stops and markers are green on the dark map; on the light map the route is near-black over a green glow; the "you are here" dot stays the conventional blue |
| Controls | (Superseded 2026-10-17: radii are the five-step scale in the first section; the dock and its active tab are 16/12 px rounded rectangles) |
| Other | Branded 404 and error pages; the status bar turns green over the tab pages (`RiderShell`); manifest `background_color`/`theme_color` are Uber Green; app icons are a black mark on a green tile (`scripts/make-app-icons.mjs`); service worker `cm-sw-3.3.0` (bumped 2026-10-17 with the type refresh) |

The header is green in both appearances (dark mode only changes the sheet and cards), so the splash always shrinks into the right colour. Nothing on Home is made up: the weather line, departures and places come from the same sources as before, and welcome art is labelled *Example*.

Checked: tsc, eslint, vitest (134), Playwright `commuter` 21, `demo` and `uber` specs against a dev server, a production build, headless screenshots at 360, 390 and 430 px, dark mode, the desktop frame, and a frame-by-frame capture of the splash. The old e2e expectations for Home regions, the intro (`[data-splash]`), the parking test (the trip page has no tab bar) and the `?view=` shortcuts were stale and are updated. Not tested on a real phone.

## Uber Home page and no reporting (2026-10-16, later)

Product rule from the owner: the app is as simple as Uber. People are not asked to report or tell it anything; it gives them the fastest, the cheapest and the other ways to get there.

### Home is a page, like Uber's Home tab

Uber's rider app (since its February 2023 redesign) has no map on Home: a "Where to?" bar with a time pill, saved and recent places, *Suggestions* tiles with *See all*, carousels ("Ways to save with Uber") and an "Around you" section; the map appears once you search. CrossMetric now does the same on phones (`panels/ExplorePanel.tsx`):

| Uber Home | CrossMetric Home |
|---|---|
| "Where to?" bar with a white "Now ▾" pill inside | Same (`WhenChip surface`): Leave now, Depart at, Arrive by, for the next search only |
| Two or three recent places | The open search ("Your trip options are ready"), up to two saved places and two or three recent searches; *Saved places* when none are saved |
| Upcoming reservation | *Coming up*: the next class with **Arrive by …** (only with a campus and a schedule) |
| Suggestions: four product tiles, a "Promo" tag | Transit, Walk (*Free*), Drive (Bike, *Free*, without a car), Rideshare. Each opens search offering only that way of travel; tags state facts, never offers |
| "Ways to save with Uber" image cards | *Ways to get around*: Fastest or cheapest (compare everything), Ride transit, Park & ride (with a car), Out late on campus? (with a campus), Need a car? (rideshare hand-off). Pictures are drawn in SVG (a small dark map with a lime route, circle → square), not photos |
| "Around you" | *Around you*: the two nearest stations or stops by walking time, with scheduled (not live) departures; without a location, one tap asks for it once |

Not copied: Uber's logo, illustrations or wording, promotions and prices. The campus choice sits in a small chip at the top right; the first-visit *Make it yours* card and the greeting are gone (everything stays in Account).

On phones, Home, Services, Activity, Account (and Saved places, Preferences, Classes and the Safety toolkit) are full pages (`PAGE_VIEWS` in `CommuterApp.tsx`); the map stays loaded underneath, `inert` and hidden from assistive tech, and comes back with the trip screens (Choose a trip, details, guidance, nearby, parking, night, stops). On desktop the panel stays beside the map, with the same Home content under *Get there*.

### Fastest and Cheapest lead the results

Option cards show their tags in this order: *Fastest*, *Cheapest* (was "Lowest cost"), then *Leave latest*, *Best match* and the rest; a card shows two tags until it is opened. Fastest and Cheapest use the stronger tag style. Ranking itself is unchanged.

### Choose a trip fits the half-open sheet, like Uber's "Choose a ride"

Before, the half-open sheet on a 390×844 phone was filled by the from/to card, the *Leave now · N options* line and the quickest-by-mode chips, and the selected first card opened in full (≈240 px), so not one option was fully above the *Choose …* button. Now (`panels/PlanPanel.tsx`, `RouteCard`/`ModeSummary` in `journey-ui.tsx`):

* The from/to card is gone. Under the title one line reads **Leave now · 6 options · from Lindbergh Center**; the start is cut short when long, and tapping it opens the trip form like *Edit* (the map and the top bar show both ends). An out-of-date notice still sits above the list.
* Rows open closed, with the best match highlighted and its *Choose …* button ready. Tapping a row (or its mode chip) selects it, opens its journey bar, facts and CrossScore, and scrolls it fully above the footer. Choosing a route on the map highlights its row without opening it.
* *Quickest by way of travel* chips and the "your best match is … slower" note moved below the list. Service and weather notes that change what you can do stay above it.

At the half size the first two rows end at about 687 px with the footer at 716 px, and the third row peeks in. `commuter.spec` checks this and the open-on-tap behaviour.

### Reporting removed from the app

Gone from the app: the *Report* tile and *Report a barrier* card on Home, the *Report* and *Community* tiles in Services, *Report* on the trip card, *Report a barrier* in the Safety toolkit and in Account, the parking *Report what you see* buttons (and the availability they fed, on the list, the detail and the map fill), and the desktop *Reports* link. `panels/ReportPanel.tsx`, the `report` view and `useObservations` were deleted. The server routes (`/api/reports`, `/api/commute/observations`) and the `/reports` page are untouched but no longer linked from the app. Services → *Safety & insights* keeps the toolkit, CrossScore routes, analysis and schools; Services → *Nearby* is the old Transit tile (stations by walking time), and *Transit* now starts a transit-only search.

Tests: `commuter.spec` checks the Home page (suggestions, carousel, no map controls, no setup card), that Home, Services and Account offer no report action, and parking without report buttons; campus, night, nearby, sheet and map-style tests reach their screens through Services. The pre-change source is in that session's scratchpad (`crossmetric-pre-uber-home.tgz`).

## Uber-style redesign of 2026-10-16

The brand reference image (near-black, Electric Lime, warm white; a hexagon mark; dark map with a lime route; adaptive bottom sheet, CrossScore panel, Smart Parking, Report a Barrier, Route Plan overview, "Move smarter." splash) is now the visual source of truth. Layout and flows follow the Uber rider app.

### What was taken from Uber, and from where

Uber's own descriptions of its rider app (newsroom, Feb 2023 redesign; safety pages) and the general ride-request pattern:

| Uber pattern | CrossMetric |
|---|---|
| Home: one "Where to?" entry with a "Now" pickup-time pill; suggestions; saved and recent places | Floating **Where to?** pill on the map with a **Now ▾** chip (`WhenChip.tsx`: Leave now / Depart at / Arrive by for the next search only; a past time is refused, never moved). The sheet holds **Suggestions** (Transit, Parking, Night, Report; *See all* opens Services), saved and recent places as one-tap rows, *Coming up* (next class), *Transit near you* and *Ways to plan* cards |
| Bottom tabs Home · Services · Activity · Account | Same four tabs (`Navigation.tsx`). Nearby, parking, night and report live under Services; Saved, preferences and classes under Account |
| Services: every product in one grid | `panels/services.tsx`: *Go anywhere in Georgia* (Compare, Transit, Walk, Bike, Drive, Park & ride, Rideshare), *Campus* (Parking, Night, Classes, Your car), *Safety & community* (Safety toolkit, Report, Community reports, CrossScore routes, Analysis, Schools). A mode tile opens search and offers only that way of travelling, shown as a removable "Walk only" chip; Rideshare lists the Uber/Lyft hand-off first |
| Activity: upcoming and past trips | `panels/ActivityPanel.tsx`: trip in progress (Resume), parked car, next class; past trips and searches (*Again*). Past trips (`cm.history.v1`, max 30) keep labels and times only — no coordinates or geometry — and follow *Keep recent searches and trips* |
| "Choose a ride": list with one selected row, price and ETA on the right, one bold "Choose X" button | **Choose a trip**: Uber-style rows (`RouteCard` in `journey-ui.tsx`): mode tile, title, leave–arrive and countdown, duration and cost on the right; the selected row has a strong border and opens to show the journey bar, facts, explanation and CrossScore. Footer: **Choose Walk / Transit / Drive…**. Pickup/drop-off use Uber's circle → square line |
| Trip in progress card; shield button for the Safety Toolkit | Trip card with arrival time, progress, the current step and *Safety · Stop times / All steps · Report*; a **Safety** shield floats on the map. **Safety toolkit** (`panels/SafetyPanel.tsx`): Call 911, campus police from the verified campus record, share trip details (never live location), report a barrier, night travel, and the route's CrossScore. It states that CrossMetric doesn't monitor trips or dispatch help (no RideCheck equivalent) |

Not copied: accounts, payments, live drivers, prices, surge, ratings, Live Activities. Ride-hail stays a hand-off with driving time only.

### Brand screens

* **Route plan** (detail): mode tile summary, Overview timeline, **CrossScore card** ("Safety intelligence for this route": score ring, band, confidence, main concern; says it describes conditions, is not live and does not predict crashes; transit not scored), **Start trip**.
* **Report a barrier** (`panels/ReportPanel.tsx`): the centre pin on the map marks the spot; Issue (the existing report categories), Message (≤280), pinned **Report a barrier** button; posts to `/api/reports` with a reverse-geocoded label. Public, anonymous, unverified.
* **Smart Parking**: the existing campus parking screen in the new tokens. The reference's "Available spots 1250" and "Charging stations" counts are deliberately not shown: there is no live occupancy or charger data, only verified rules and people's "opening / full" reports.
* **Projects** (reference screen of "Mobility improvements"): not built — CrossMetric has no projects data; the nearest real things are Community reports and the road-safety analysis, both under Services.
* **Splash**: lime hexagon drawn on near-black, "CrossMetric", "Move smarter."
* **Map**: dark basemap by default (Account → Map: Dark / Light / Match appearance; the layers button toggles it). Lime route with near-black casing on dark; near-black route over a lime glow on light. Markers: near-black pin with lime dot; lime start dot.
* Mark: hexagon with two crossing triangles (`components/brand/Logo.tsx`), lime on a near-black tile for the app icon and favicon (`scripts/make-app-icons.mjs` re-run; service worker `VERSION` bumped to 3.1.0 so cached icons refresh).

### Tokens

`.cm-app` in `app/globals.css`: light = warm white #F7F7F3 canvas, white cards, near-black #111315 type and primary buttons; dark = near-black canvas, lime #D7FF64 primary and route. New tokens `--app-accent`, `--app-on-accent`, `--app-select`. Lime never carries text on white (1.2:1); link text on light is olive #3E5700 (7.6:1). All measured pairs are noted in the file.

### Not changed

Planning, ranking, transit, parking rules, share-link privacy, the PWA and the analysis pages (`/analyze`, `/reports`, `/routes`) work as before; the analysis pages keep their own palette but use the new mark.

Tests: Playwright `commuter.spec` updated for the new tabs and labels, plus: Services mode tile → only that mode, *Now* chip, Report a barrier sends the pin's point (request intercepted, nothing stored), dark map toggle, and Activity records an ended trip without coordinates.

## Phase 3 of 2026-10-15: smoother app, installable, shareable

### Map framing bug: root cause and fix

On phones the camera often stayed zoomed on the start instead of showing the whole route (console: "Map cannot fit within canvas"). MapLibre 6 adds `fitBounds` padding to the map's *current* padding, and every earlier camera move (including "show my location") left the sheet's padding behind, so the sheet was counted twice and the fit was refused. **Fix** (`components/commute/CommuteMap.tsx`): `absolutePadding: true` (the padding replaces the map's), `linear: true` (an ease, not a fly-out-and-in), and `fitPadding` (`motion.ts`) shrinks the padding proportionally when the sheet covers most of the screen, so there is always at least 96 px to frame into. Before routes arrive the camera frames both ends. An unasked location update no longer pulls the camera off a route; tapping *Show my location* always recentres.

### Motion and surfaces

* **Bottom sheet** (`BottomSheet.tsx`, physics in `motion.ts`). The sheet follows a finger anywhere on it: until it is fully open, a vertical drag on the content moves the sheet (`touch-action: none` there); fully open, the content scrolls and only a pull-down from its top collapses it. Sideways movement belongs to horizontal chip rows. The decision is made on the first 3 px of movement, while the browser still allows a touch to cancel its own scrolling. A release settles to the nearest size, a flick (≥ 0.45 px/ms over the last ~100 ms) moves one size, travel under 10 px is a tap, and past the ends it rubber-bands. While dragging, only the sheet's height and a CSS variable on the map change (`--cm-sheet-cover`, which the map controls and attribution follow), so the app does not re-render or re-frame the map on every frame; the cover is reported once the sheet settles. A light haptic tick marks a size change on Android. Mouse: drag the handle; keyboard: Enter/Space cycles, arrows resize, Escape collapses (unchanged).
* **Screens** move with direction: deeper screens push in from the right, Back from the left, tabs cross-fade (`.cm-screen[data-dir]`). The tab bar and the desktop top bar have a sliding indicator.
* **Surfaces**: floating map chrome (search, campus chip, map controls, tab and top bars) is translucent and blurred (`.cm-glass`), solid when `prefers-reduced-transparency` is set or blur is unsupported; text contrast is unchanged because it is checked against the solid surface. Cards and rows have a short press response (`.cm-press`). New tokens: `--app-shadow-float`, `--app-glass`, `--app-selected-bg`, `--ease-sheet`, `--ease-pop`, `--dur-sheet`.
* **Map**: a soft glow under the selected route, the destination pin drops in, the start pops in, and the location dot breathes.
* **Toasts** slide in with a line showing how long they stay; the search screen rises in, highlights the typed words in results, and has no oversized focus ring.
* Everything above is off with reduced motion.

### Comparing options

* **Journey bar** (`JourneyBar`, `journeySegments` in `journey-ui.tsx`) on every card and in details: walking, waiting (dotted), each ride in the line's own colour and name, driving and biking, in proportion to their minutes. Time that no leg accounts for — the stated planning buffer for driving with no live traffic — is drawn as its own hatched segment after the drive, so the bar always adds up to the time on the card.
* **Quickest by way of travel**: a chip per mode that has an option (Walk 52 min · Transit 31 min · Drive 12 min); tapping one selects that mode's best-ranked option and scrolls to it.
* **Facts in words** instead of a four-column grid with dashes: "$2.50 · 10 min walking · No transfers · 2.9 mi"; an unknown cost says "Cost unknown", never free.
* **Countdown**: transit cards count down to the first timetabled ride's scheduled departure ("Departs in 9 min", with the stop in the tooltip; frequency-based rides have no fixed time and show none); arrive-by and later departures count down to when to leave. When that time passes while the results are open, the card says so instead of counting on.
* Transit options are titled the way riders say them: "Bus 7", "Red line → Bus 110", "Park at Doraville Station · Gold line".
* While routes are computed: a progress line and three placeholder cards shaped like the results.

### Share a trip

Details → Share (`ShareTrip.tsx`, rules in `lib/share.ts`). The link is `/?to=…[&from=…][&depart=…|&arrive=…]` and opens the same search; times are recalculated when it is opened.

* The current location is never written into a link. The start is included only when the person turns on *Include the start*; otherwise the person opening it starts from their own location (used when already shared, else they are asked).
* A saved place's nickname is not shared, only its own label. Labels are length-capped and control characters stripped; points outside Georgia, unknown campuses and malformed building ids are rejected.
* A shared time that has passed is not used: the trip opens as Leave now and says so (never moved to another day). The parameters are removed from the address bar once read.
* Uses the system share sheet where there is one, otherwise copies the link.

### Installable app and offline shell

* `app/manifest.ts`: name, description, colours, PNG icons (192, 512, maskable 512) and an Apple touch icon rendered from the CrossMetric mark by `scripts/make-app-icons.mjs`, and shortcuts to Nearby and Saved (`/?view=nearby`, `/?view=saved`, read once by the app).
* `public/sw.js`, registered by production builds only (`components/pwa/PwaBoot.tsx`; in development it removes any worker and its caches so a cached build can never hide edited code). Pages are network first (4 s timeout, then the page's own last copy, else a short offline page); content-hashed build files and icons are cache first, warmed with the files the first visit already loaded; campus bundles are stale-while-revalidate. Plans, places, transit, reports and map tiles always go to the network and are never stored by the worker. `/sw.js` is served `no-cache`.
* Profile → App: *Install* shows the browser's own prompt (Chrome, Edge, Android); on iPhone and iPad it explains Share → Add to Home Screen; nothing once installed.
* Checked on the production build (2026-10-15, Chrome): no manifest or installability errors with a normal profile; the worker controls the page after the first visit (24 build files and the app page cached); an offline reload opens the full app with the offline notice; an unvisited page offline shows the offline page. Not checked on a real phone or on iOS.

### Smaller changes

* First visit: a *Make it yours* card on Explore (add a place, choose a campus, say whether you have a car), gone once a place is saved or *Done* is tapped; everything is also in Profile.
* Explore shows the Georgia date and time; desktop has *Search places* with a `/` shortcut, which works on any screen outside text fields.
* Page title, description and app name now describe the Georgia-wide app; the brand is written CrossMetric everywhere.

Tests: web `phase3.unit` (16: sheet settling and flicks, release speed, padding that always fits, journey segments and the buffer segment, facts and countdowns, share links: no current location, start only on request, round trips, rejection of outside-Georgia and malformed values, passed times). Playwright `commuter.spec` adds: quickest-by-mode chips select an option; a shared link opens its trip and a passed time opens as Leave now; sharing never includes the current location; app shortcuts open their tab; manifest, icons, shortcuts and `/sw.js` headers. Touch physics were also checked with real touch events (CDP) and 60 Hz in-page sequences.

## Redesign of 2026-10-13

### The "tomorrow" route bug: root cause and fix

Routes were sometimes ranked for tomorrow although nobody asked for that time. Causes found in the code (all fixed):

1. **Silent destination and deadline from the schedule.** `CommuterApp` used the next class as the destination, and its start minus the entry buffer as an arrive-by deadline, whenever no destination had been picked. After the day's last class the next class is tomorrow's (or Monday's), so the planner ranked options for tomorrow. Switching campus reset the choice back to "follow the next class". **Fix:** route searches never take a time from the schedule. A new search is always *Leave now* (`startSearch` in `components/commute/useJourney.ts`). The next class has its own card and its own plan (used for reminders); planning for it is an explicit tap ("Plan to arrive by 9:25 AM").
2. **Silent roll-over to tomorrow** in the *Arrive by* box and the *Park until* box: a time earlier than now became the same time tomorrow, with no date shown. **Fix:** both take an explicit Georgia-time date and time; a past time is rejected with a message (`checkTiming`, engine `commute/timing.ts`); a stay that ends before the arrival is rejected.
3. **Stale cached "leave now" plans.** The offline cache key ignored time for leave-now plans, so a plan from days earlier could be shown as current, labelled only with a clock time. **Fix:** journey results carry the key of the inputs they were computed for and a freshness state (`resultFreshness`: fresh under 5 min, aging under 15 min, then stale and refreshed automatically when online); cached leave-now commute plans are reused only within 15 minutes; cached results show their date.
4. **`/routes` "Leave at…"** read and labelled the time in the device's time zone. **Fix:** it is Georgia time. (It only drives the low-light note; CrossScore does not depend on time, as that page says.)

Checked and not a cause: after-midnight transit. `buildDayTimetable` already folds the previous service day's trips past 24:00 into each day (covered by an existing RAPTOR test).

Regression tests: engine `test/commute-timing-rank.test.ts` (leave-now default, explicit future departures, arrival deadlines, Georgia time whatever the device zone, DST gaps and overlaps, midnight labels, one key per time, stale and past results); web `test/journey.unit.test.ts` (results shown as current only for the inputs on screen; restoring a recent search restores the places, not the old time) and `test/journey.integration.test.ts` (the API rejects past times; leave-now options all start now; depart-at and arrive-by use the right day's timetable; nothing-in-time reports how late). Playwright `commuter.spec` checks that a new search shows *Leave now* and never "Tomorrow", and that editing the time marks results as updating.

### Journeys anywhere in Georgia

`POST /api/journey/plan` (`server/journey/plan.ts`) takes a start, a destination (any Georgia point, or a campus building), an explicit timing, the person's preferences and car details, and builds options for exactly that question:

| Option | How | Cost shown |
|---|---|---|
| Walk (up to 8 km) | Valhalla pedestrian, plus a sidewalk-preferring variant when it differs. Step-free requests use Valhalla's wheelchair pedestrian type | $0 |
| Bike (up to 25 km, off by default) | Valhalla bicycle, plus a quieter-streets variant | $0 |
| Drive | Campus destinations: the existing drive-and-park candidates (verified rules, checked at arrival). Elsewhere: Valhalla auto with one alternate. No live traffic, so the stated buffer is added | Gas when mpg and price are set; parking at ordinary destinations is unknown, so the total says "Unknown" |
| Transit | RAPTOR on the MARTA network and on the Athens network (UGA Campus Transit + ACC Transit) when both ends are within walking reach; a second itinerary with fewer rides when one exists | One-way fare per agency ($2.50 MARTA, $0 UGA/ACC) |
| Park & ride | Drive to one of the 5 nearest MARTA rail stations with parking (hand-verified record `data/commute/marta-parking.json`), park, ride | Fare + gas; station parking $0 for a same-day trip (free daily, or free first 14 h in paid decks) |
| Ride-hail | Hand-off only (Uber universal link needs `NEXT_PUBLIC_UBER_CLIENT_ID`; Lyft deep link). Driving time is shown, never a price or a booking | — |

Ranking (`engine/commute/rank.ts`): hard constraints first — turned-off ways to travel (turning off driving also removes park & ride), most walking, most transfers, and step-free access (transit counts only when MARTA publishes every stop and trip used as accessible; UGA and ACC publish no accessibility data). Excluded options are listed with their reasons. *Best match* follows the person's priority among options at most max(10 min, 25 %) slower than the fastest, which the explanation states. Labels appear only when an option clearly differs from the fastest: Shortest (by 5 % and 200 m), Lowest cost (only when no unknown cost could be cheaper), Less walking (3 min), Fewer transfers, Fewer risk indicators (CrossScore 5 points better, compared only within one mode), Leave latest (arrive-by). Explanations use only the option's own numbers.

Typed requests (`engine/commute/intent.ts`): deterministic rules read "without driving", "cheapest", "minimal walking", "fewer transfers", "no transfers", "wheelchair", "nearest MARTA station", "parking near …", show what was understood before anything is planned, and apply to that search only (removable).

### Nearby transit

`POST /api/transit/nearby` (the point travels in the body, never the URL): every stop within 1.6 km, platforms grouped into stations and same-name bus stops grouped, the nearest 12 routed for walking time and ranked by it. Scheduled departures in the next hour (labelled scheduled), published wheelchair data, MARTA station parking. With no rail station within walking reach it names the nearest one and the drive to it (Cumming: North Springs, about 33 min). It never implies MARTA serves an area it does not.

### Data added

* `pipeline/commute/transit.py` carries GTFS `wheelchair_boarding` (inherited from parent stations) and parent stations, and splits patterns by `wheelchair_accessible`. Trip and stop counts are unchanged (45,367 trips, 7,011 stops in the Atlanta network). MARTA: 209 patterns published as accessible, 15 not (Atlanta Streetcar trips and some Blue line and bus trips).
* `data/commute/marta-parking.json`: stations with parking and long-term rates, from MARTA's parking-availability page and its Aug 20, 2026 rate notice (paid decks free for the first 14 hours from Sep 14, 2026). Checked 2026-10-13; re-check by 2026-11-12, after which park & ride from those stations is not offered.
* Place search lists MARTA rail stations and biases address results toward the start or campus (rounded to about 10 km).

### Interface

* Design tokens in `app/globals.css` (`.cm-app`): near-white and cool-gray surfaces, charcoal text, one restrained green (`#23744A`; dark `#8CD3A1`) for the primary action and the selected route, muted mode colours, light and dark themes (dark matches the reference map). Contrast was measured and is noted in the file. The analysis pages use the same palette and the new crosshair mark.
* Phones: full-bleed map, floating search and campus chip, zoom and locate controls, a bottom sheet above a tab bar (Explore, Nearby, Saved, Profile). Desktop: a top bar with the same tabs plus Reports and Analysis, a floating side panel, map controls on the right.
* Shared states (`StateMessage`): start or destination missing, finding routes, updating after edits, no option fits the preferences, nothing arrives in time, offline (with the cached result and its date), server or routing-provider failure, transit not covered, location blocked, empty saved places.
* Motion: `components/commute/SplashIntro.tsx` (Motion 13.4.6 with `LazyMotion` + `m`): a muted map, a start marker, a route that draws itself with a green accent travelling along it, the destination, then the CrossMetric mark and wordmark, dissolving into the live Explore screen (about 2.5 s; any tap or key ends it; once per browser session; a brief static frame with reduced motion; decorative and `aria-hidden`; skipped under automation unless `?intro=1`). The selected route draws itself in on the map when it changes; panels and lists reveal with short CSS transitions; all of it is off with reduced motion.

### Limits of this redesign

* No live traffic, vehicle positions or arrival predictions anywhere.
* Transit covers MARTA, ACC Transit and UGA Campus Transit only — no Xpress, CobbLinc, Gwinnett, CAT or other agencies yet. They would be added as networks in `server/journey/networks.ts`.
* Parking is verified only for Georgia Tech and UGA places and MARTA stations; elsewhere a drive's cost says parking is not included.
* The existing app had no "projects" feature to preserve. Barrier reports (`/reports`) and road-safety analysis (`/analyze`) are linked from Explore and Profile and restyled.
* Step-free walking depends on OpenStreetMap tagging; curb ramps and surfaces are not checked.
* The Uber hand-off still needs `NEXT_PUBLIC_UBER_CLIENT_ID`.

## Run it

```bash
python -m pipeline.commute.campus
python -m pipeline.commute.transit
npm run dev            # http://localhost:3000
```

`CROSSMETRIC_COMMUTER_HOME=0` puts the previous dashboard back at `/`. The dashboard is always at `/explore`; Routes, Analyze, Schools, Reports and Methodology keep their URLs.

## What a student can do

| Task | Taps after setup | How |
|---|---|---|
| See the next class and when to leave | 0 | Home sheet: building, class time, "Leave in 8 min", arrival, mode and cost |
| Compare and start the commute | 2 (Commute, Start) | Up to three rows: Recommended, Cheapest, Less walking (Less rain when wet), Backup |
| Parking near the class | 1 to see eligibility, price, walk and report age; Directions is tap 3 | Free / Cheapest / Filters (My permit, Walk ≤10 min); "Park until" defaults to the last class plus 15 min and is editable |
| Report an opening, a full lot or an active meter | 1 once the place is open | Undo for 10 minutes |
| Night service | Night, then the official booking hand-off | Help numbers are one tap from the Night sheet |
| Back to the car | 2 (Back to car, Start) | With a "last bus to your car" check for remote lots |
| Check a bus stop's departures | 1 (tap the stop on the map) | Scheduled times only, clearly labelled |

Typing, permission prompts and anything done inside another app (TransLoc, Lyft, a maps app) are not counted above. These are design targets; they have not been validated with students.

Everything personal (classes, start point, permits, registration, parked car, reminder state) stays in the browser. Plans send only the start point and destination to compute a route; nothing is stored. No account is needed.

## How plans are computed

* **Deadline**: class start minus the time to reach your seat (default 5 min, editable). Times are to the building's OpenStreetMap entrance when one is mapped, otherwise to the building (the app says so).
* **Latest departure**: for every option, `leave + T_conservative ≤ deadline`, labelled "Planning estimate". T_conservative is the baseline plus stated buffers:
  * Drive: OpenStreetMap routing (Valhalla) with no live traffic, plus 30% (at least 5 min), or 60% (at least 8 min) on weekday rush hours 7–10 and 4–7. Plus 5 min to park in a deck, 7 in a lot. Plus the walk to the entrance.
  * Transit: a time-reversed RAPTOR search over the GTFS timetables finds the latest departure that still connects; every boarding uses the time you reach the stop. Buffers: 3 min per timetabled ride, the headway (up to 12 min) per frequency-based ride; the search is re-run so the buffer matches the itinerary it produced.
  * Walking: your pace setting; in rain, exposed walking is slowed by 5/12/20% (light/moderate/heavy), and unknown cover counts as exposed. Transit connections are re-planned at the slower pace, so a missed transfer uses the next real departure.
* **Choice**: the recommended option leaves latest (ties: shorter, fewer rides, cheaper). Cheapest and least-outdoor options are shown only when genuinely different; the backup prefers a different mode. When nothing arrives on time, the earliest arrival and minutes late are shown; buffers are never shrunk.
* **Parking**: a drive is offered only if the place is allowed (or payable) for the whole stay. The rule evaluator splits the stay at every rule, rate, event and midnight boundary; anything unpublished, conflicting, past its re-check date, or depending on an unstated registration is "unknown", never free. Reports from other students never change eligibility.
* **Reminders**: a heads-up at min(class − 30 min, leave − prep), "Time to leave" at the leave time, and a re-check at class − 30 min. Entries are unique per (class occurrence, kind, channel); a re-plan moves them; past-due alerts collapse into one current instruction; a departure that moves 3+ minutes earlier (10-minute cooldown) sends an update. They run while the app is open; lock-screen text says only "Time to leave".

## Integration status

| Integration | Status | Notes |
|---|---|---|
| MARTA schedule (GTFS) | verified_schedule_only | Feed covers Aug 22 – Dec 11, 2026; dates after that show "No published schedule" |
| MARTA realtime | unavailable | Rail API needs a registered key; bus GTFS-realtime not integrated |
| UGA Campus Transit (Passio GTFS) | verified_schedule_only | Official calendar overlay (modified/reduced/no service) through Oct 31, 2026; later dates say "calendar not yet published" |
| UGA Passio realtime | unavailable | Published GTFS-realtime feeds exist; not integrated |
| Athens-Clarke County Transit (GTFS) | verified_schedule_only | Feed calendar through Dec 31, 2026; fare $0 per the feed |
| GT Stinger | handoff_only | No current public GTFS (Mobility Database mdb-355 ended 2014); live tracker link |
| GT Stingerette | handoff_only | Official booking (TransLoc OnDemand) and dispatch phone; hours as published Oct 12, 2026 |
| UGA Ride Smart (Lyft discount) | handoff_only | Opens Lyft; eligibility and limits from the program page |
| Routing (Valhalla, OpenStreetMap) | verified_live | Public fair-use server, no traffic data |
| Address search (Photon) | verified_live | Public fair-use server |
| Weather (National Weather Service) | verified_live | Gridpoint precipitation and active alerts; failures show "Weather unavailable", never dry |
| Parking rules and rates | verified records | GT: 5 visitor decks. UGA: 7 visitor decks, 58 coded lots from the enforcement table, 2 park-and-ride lots. Re-check by Nov 12, 2026 |
| Game-day overrides | news-sourced dates | GT Oct 24, Nov 7, Nov 21; UGA Oct 17, Nov 14, Nov 28 (UGA from 5 PM the evening before). Rules show as unknown on those dates |
| Occupancy | unavailable | No occupancy feed; only expiring one-tap reports |
| Covered or lit paths | unavailable | Shown as unknown; never claimed |
| Calendar .ics import | implemented | Parsed on the device with ical.js; a one-time copy, not live sync |
| Google / Outlook calendar sync | needs_permission | Needs OAuth client registrations and campus tenant consent |
| Web push (closed app) | unavailable | Needs VAPID keys, a job runner, and server-side schedules tied to accounts |
| Reddit (r/gatech, r/UGA) | needs_permission | Disabled in `data/research/sources.json` |
| Discord | disabled | Voluntary feedback only, not configured |

## Research workspace (internal)

`/internal/research` is off unless `CROSSMETRIC_INTERNAL_TOKEN` is set. Students can send feedback from Settings with explicit consent; text is minimized (emails, phones, handles, addresses, tracking parameters removed), kept 30 days, and deletable with a code kept on their device. A bounded batch (30-day window, cap 1,000, stratified by campus and source) deduplicates, classifies with a versioned keyword extractor whose output is schema-checked (the supporting span must occur in the text), clusters, scores priority with the published formula (inputs marked provisional), and writes drafts that always require human review. Collected text is only data: nothing in it can trigger an action. `RESEARCH_PIPELINE_ENABLED=0` stops it. Disabled sources are reported with their reason in every run.

## Tests

| Suite | Count | Covers |
|---|---|---|
| Engine `commute-*`, `research` | 68 | Zoned time and DST, full-stay parking evaluation, observation aggregation, RAPTOR (transfers, late-night trips, service exceptions), schedules and building matching, arrive-by choice, reminders, rain walking, costs, research pipeline |
| Web `commute.unit` | 10 | .ics import: RRULE across DST, EXDATE, moved and cancelled occurrences, remote/all-day/ambiguous events, privacy, idempotency |
| Web `commute.integration` | 17 | The real rule records and timetables against the acceptance scenarios; API validation; reports with rate limit and undo |
| Web `research.integration` | 5 | Consent, minimization, token gating, disabled sources, deletion propagation, kill switch |
| Web `commute.live` (opt-in) | 4 | Live routing: GT and UGA plans, no invented MARTA-to-Athens trip, last bus back |
| Engine `commute-timing-rank` | 28 | Timing modes (no roll-over, Georgia time, DST, freshness), hard constraints, labels only when genuinely different, best match within the stated tolerance, explanations, typed requests |
| Web `journey.unit` | 12 | Results current only for the inputs on screen, stale leave-now results, recent searches without location history, restoring places not times, per-search overrides |
| Web `journey.integration` | 22 | Real timetables with a stand-in router: leave now / depart at / arrive by, too-late arrivals, no driving when turned off, walking and step-free limits, Cumming park & ride, Atlanta–Athens has no transit, fare-free Athens buses, routing-service outage, nearby stations ranked by walking time |
| Web `journey.live` (opt-in) | 3 | Live roads: Cumming to Five Points, step-free walking, nearest MARTA station from Cumming |
| Playwright `commuter.spec` | 16 | First visit, search → compare → details → guidance (Leave now, never "Tomorrow"), no drive when "without driving", time edits mark results as updating, parking report and undo, nearby transit, night hand-offs, campus prompt, keyboard sheet, intro skip / once per session / reduced motion, quickest-by-mode chips, shared links (passed time → Leave now; never the current location), app shortcuts, manifest/icons/service-worker headers, `/explore` |
| Web `phase3.unit` | 16 | Sheet settling, flicks and release speed; camera padding that always fits; journey segments and the planning-buffer segment; facts and countdowns; share links (privacy rules, round trips, rejection, passed times) |

### Acceptance scenarios

| Scenario | Where it is checked |
|---|---|
| GT, no permit, after 5 PM | `commute.integration`: no GT place is free; decks are paid |
| UGA registration vs permit | `commute.integration` (TSL), engine parking tests |
| Rule changes during class | engine + `commute.integration` (S02 4–6 PM) |
| Game-day closure | engine + `commute.integration` (UGA Oct 17 and the evening before) |
| One opening report | engine observations; Playwright |
| Conflicting / full / expired reports | engine observations |
| Long commute to a 9:00 class | engine reminders (7:45 heads-up, 7:55 leave) |
| Cancelled/moved class, repeated webhook | engine reminders (idempotent outbox, cancellation) |
| DST, recurrence exception, imported duplicate | `commute.unit` |
| Calendar permission denied / no calendar | Manual classes and .ics work without any provider |
| Web push unavailable | Settings says reminders work while the app is open |
| Rain misses a transfer | Planner re-plans transit at the rain-adjusted walking pace |
| No second rain penalty on live data | No live traffic or transit data is used, so no rain penalty is applied to them |
| Covered shortcut locked / coverage unknown | Unknown cover counts as exposed; no shelter claims |
| Stale feed | Scheduled times are labelled; no vehicle positions are drawn |
| No service back to the car | Park-and-ride options are dropped when no bus returns; the parked sheet shows the last bus |
| Selected route only | Only the selected itinerary's lines and stops are drawn |
| Permit already owned | `costs` keeps marginal and allocated cost separate |
| No verified free parking | Parking sheet: "No verified free parking" + "Show cheapest" |
| Reddit connector without approval | `research.integration` |
| Prompt injection in collected text | engine `research` |
| Deleted evidence | `research.integration` |
| Keyboard / screen reader / large text | Sheet handle and every control are buttons with labels; the panel lists everything the map shows. Not yet audited with a screen reader |

## Measured performance (2026-10-12, desktop, production build)

| Measure | Result | Budget |
|---|---|---|
| Plan, repeat request (cached) | p50 22–26 ms, p95 35 ms (GT); p95 up to 1.55 s right after a cold plan while alternative shapes finish (UGA) | p95 ≤ 1.5 s |
| Plan, new destination | ~1.9 s GT, ~2.6 s UGA in-process; ~6 s for the first request after a server start | bounded; alternatives get 1.5 s, then keep a sketch line |
| Campus data | 12–26 ms, 253 KB uncompressed (UGA) | — |
| Home page | 9 KB HTML; 914 KB uncompressed JavaScript in 13 files | not measured on a mid-range phone |

Not yet measured: time to useful content on a mid-range phone, and the cold shell on a throttled connection. Do that before claiming the 1 s / 2.5 s budgets.

### After the 2026-10-13 redesign (desktop, production build, local server, public Valhalla)

| Measure | Result |
|---|---|
| Home page JavaScript | 2,376 KB uncompressed in 17 files, of which MapLibre is about 1,560 KB (main bundle, shared chunk and worker). Measured with every script the page loads, including the map, so not comparable with the 914 KB figure above. ical.js now loads only when a calendar is imported; Motion only when the intro plays |
| Search usable (`/`, intro off) | 0.65–0.78 s from navigation to the search button, local server |
| Journey plan, new trip, warm server | 2.7–7.7 s. Each public Valhalla call takes 0.6–1.0 s and the client allows 3 at a time (fair use); a plan makes about 10–16 calls. Safety scoring and shape filling run in parallel. A self-hosted Valhalla (`VALHALLA_URL`) is the fix |
| Journey plan, repeat | about 0.9 s (routing answers are cached for 6 h) |
| Journey plan, first after a server start | about 11 s (loads statewide safety data and both timetables) |

## Known gaps

* No live traffic, vehicle positions or occupancy. Drive times are baselines with stated buffers.
* GT after-hours permit rules, street meters and lots beyond the 5 visitor decks are not modelled yet.
* UGA weekday 12–7 AM rules and weekend deck rates are not published; they show as unknown.
* Game-day dates come from news reports of the official schedules; event-specific lot plans are not modelled (rules show as unknown on those dates).
* Calendar sync (Google/Outlook), push reminders when the app is closed, and server-side schedules need accounts and credentials.
* The five-second and three-tap goals are untested with students; a consented pilot (about 10 commuters per campus) is the next step.
