# The engineering challenge: telling bad data from busy intersections

## The problem

GDOT's crash records include coordinates that aren't where crashes happened. Some point to the center of a county; some are round numbers like (-84.0, 33.0) or the corner of Georgia's bounding box; one single coordinate held **3,517 crash reports from 42 different counties**. If CrossMetric counted these, any school near one of those points would appear to have a crash hotspot that doesn't exist.

## My first solution, and why it was wrong

The obvious rule: if 25 or more crash reports share an exact coordinate, treat it as fake. That rule flagged **107,301 crashes**.

Before trusting it, I measured what it was removing. Most of those stacked coordinates were not fake at all: 82–91% sat within about 2.5 meters of a road centerline, were reported by a single county, and 30–40% were intersection crashes. The reporting system evidently snaps many crashes to points on the road. My rule was deleting real crashes at the **busiest intersections**, exactly the places CrossMetric exists to find. It would have quietly made the product worse where it matters most.

## The solution

I looked for properties a real location can't have:

1. **One point, many counties.** A real place is in one county. Crashes from 3+ counties at one point mean a placeholder.
2. **Round numbers.** Coordinates with two or fewer decimal places.
3. **Isolation.** A busy intersection is surrounded by "GPS scatter": crashes recorded a few meters away. I compared each big stack with all crashes within 100 m. Across the 215 coordinates holding 100+ crashes, real locations had a stack-to-scatter ratio around **2.5**; the known placeholders had ratios of **95 to 459** (one held 2,181 crashes with only 5 nearby). Stacks of 25+ with more than 25× their surroundings are placeholders.

The final rule removes **15,415** crashes and keeps about **92,000** legitimate ones that the first rule would have deleted.

## Supporting work

The same habit of checking the data against what it claims mattered elsewhere:
- GDOT's `PEDESTRIAN` field is "1" on 99.2% of crashes, so pedestrian involvement is derived from unit types instead.
- 136,331 crashes are coded "private property" (mostly parking lots) and are excluded, or school parking lots would dominate.
- Web Mercator, GDOT's map projection, overstates distances by 20% in Georgia, so all distances are computed in a Georgia-specific projection.

## Code

- `pipeline/cleaning/crashes.py`: `default_location_mask` implements the three tests
- `pipeline/tests/test_cleaning.py`: tests that an isolated stack is removed while a busy, scattered location is kept

## What I learned

A data-cleaning rule is a claim about the data, and it needs to be tested like any other claim. Measuring what a rule removes, not just how many records it removes, turned a harmful rule into a precise one.
