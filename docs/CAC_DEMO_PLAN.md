# Three-minute demonstration plan

Rehearsed against the live app. Numbers below are from the current data build (crash window Oct 3 2023 – Aug 31 2026) and will change if the pipeline is rebuilt with newer data. Read them off the screen during recording, not from this page.

**Setup before recording:** `npm run dev`, browser at 1440×900, start on the Home page. Close the evidence panel and reset to defaults (open `/` fresh). Optional backup tab: `/school/130123000467` (North Clayton High School).

| Time | On screen | Say (roughly) |
|---|---|---|
| **0:00–0:20 Problem** | Home page: logo, tagline, Georgia school map | "Georgia records crashes, injuries, pedestrian involvement and traffic, but in separate datasets. CrossMetric uses public transportation and school data to identify which roads around schools have the strongest evidence for professional safety review." |
| **0:20–0:35 Users** | Hover a few dots on the map | "It's for school administrators, transportation planners, community safety groups and residents. Every Georgia public school, 2,336 of them, is analyzed." |
| **0:35–1:15 Product** | Type "North Clayton High", Enter. Map shows the 800 m circle, colored roads, ranks 1–5. Click #1 in the list. | "CrossMetric found every intersection and road segment within 800 meters and ranked them. The top one is Riverdale Road at Crystal Lake Road: 137 matched crashes, 31 with injuries, four involving pedestrians, about a fifth of a mile from the school. Score 95: High Priority for Review." Point at the score breakdown. |
| **1:15–1:45 Computer science** | Click the *Data* tab, then briefly the Methodology pipeline diagram (new tab prepared) | "Behind this: 1.25 million GDOT crash records, cleaned with rules I tested against the data. For example, my first rule would have deleted 92,000 real crashes. Then Python and GeoPandas project everything into a Georgia map projection that measures true meters, detect intersections, match each crash to one location, and store the results in PostGIS." |
| **1:45–2:10 Explainability** | Back on the analysis: *Evidence* tab (generated sentences). Switch scenario to *Pedestrian emphasis*; open *Sensitivity*. | "Every number is explained, with no AI writing it; it's computed. If we value pedestrian safety more, the weights change and rankings recompute instantly. Sensitivity shows this location stays number one under all four scenarios: high stability." Optionally show Sara Rawson Smith Elementary (`/school/130012000124`), where the top two locations swap. |
| **2:10–2:30 Decision support** | *Resource Planner* tab → capacity 5 → Get recommendations | "If the district can afford five professional reviews, CrossMetric picks the five highest-priority distinct locations, and skips ones a single site visit would already cover." |
| **2:30–2:45 Validation** | Methodology → Validation cards | "I tested it against the Atlanta Regional Commission's High Injury Network, built from different years: 60% of CrossMetric's top-five locations are on it, versus 18% by chance. And locations ranked high using older data kept having 8.6 times more crashes afterward." |
| **2:45–3:00 Impact** | Back to the map | "CrossMetric doesn't predict crashes or replace transportation engineers. It turns fragmented public data into evidence communities can use to decide where professional safety review may be most valuable." |

## Reliability checklist

- Run `npm run test:e2e` before recording; it performs this exact flow.
- Basemap tiles load from OpenFreeMap. If the network is slow, the analysis layers and list still render, and the map shows a notice instead of failing.
- Shared link for the planner state: `/school/130123000467?view=planner&capacity=5`.
