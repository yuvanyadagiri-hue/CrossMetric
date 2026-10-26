# Version 2 ideas

Improvements that are valuable but deliberately **not** in version 1, which focuses on a complete, tested core.

## Better evidence

- **Sidewalk, crosswalk and curb-ramp detection** from aerial imagery or municipal inventories, so missing pedestrian infrastructure can be considered alongside crash history.
- **Speed data** (posted limits from the road inventory where available, or probe-vehicle speeds) as an additional context component.
- **Lighting inventories** to pair with the existing low-light crash filter.
- **Severity detail** (KABCO injury levels) if GDOT publishes it in a public layer, so serious injuries can be weighted separately.
- **Exposure-adjusted rates** using Empirical Bayes methods from the Highway Safety Manual, once calibrated safety performance functions for Georgia are available.

## Wider scope

- **Multi-school planning**: allocate a district-wide review budget across many schools at once (a constrained optimization problem), avoiding duplicate reviews where school areas overlap.
- **Other states** with comparable public crash and road inventory data.
- **School walking-zone boundaries** where districts publish them, replacing the straight-line radius.

## Workflow

- A **Road Safety Audit workflow**: export a review packet (map, evidence, crash list) for the professionals who perform the review, and record their findings.
- **Municipal integrations** so agencies can attach completed projects and see whether evidence changes afterward.
- **Automatic refresh** of the rolling GDOT crash window on a schedule.

## Engineering

- Vector tiles for the statewide candidate layer, so all 235,866 locations can be browsed without choosing a school first.
- Loading data into PostGIS as part of a scheduled pipeline run, with migration checks in continuous integration against a real PostGIS container.
