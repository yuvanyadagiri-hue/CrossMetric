import type { Metadata } from "next";
import Link from "next/link";
import { CROSSSCORE_MODEL, formatDate, formatInt, formatTimestampDate, MODEL } from "@crossmetric/engine";
import type { CrossScoreFactorId, TravelMode } from "@crossmetric/engine";
import { MonthlyBars, ValueBars } from "@/components/methodology/Charts";
import { PipelineDiagram } from "@/components/methodology/PipelineDiagram";
import { getRepository } from "@/server/repository";
import { readStatewideManifest } from "@/server/statewide";

// Rebuilt hourly so a fresh pipeline run appears without redeploying.
export const revalidate = 3600;

export const metadata: Metadata = { title: "Methodology" };

const SECTIONS = [
  ["problem", "Problem"],
  ["data", "Data"],
  ["spatial", "Spatial processing"],
  ["features", "Feature engineering"],
  ["normalization", "Normalization"],
  ["scoring", "Scoring"],
  ["sensitivity", "Sensitivity"],
  ["validation", "Validation"],
  ["crossscore", "CrossScore"],
  ["routing", "Routes & live services"],
  ["reports", "Community reports"],
  ["privacy", "Privacy"],
  ["limitations", "Limitations"],
  ["version", "Version"],
] as const;

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10 first:border-0 first:pt-0">
      <h2 className="text-section font-semibold text-navy-900">{title}</h2>
      {lead ? <p className="mt-2 max-w-[720px] text-body leading-relaxed text-ink-soft">{lead}</p> : null}
      <div className="mt-5 space-y-5 text-small leading-relaxed text-ink">{children}</div>
    </section>
  );
}

function Formula({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="font-mono text-small text-navy-900">{children}</p>
      {caption ? <p className="mt-1 text-meta text-ink-muted">{caption}</p> : null}
    </div>
  );
}

function Details({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-line bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-small font-semibold text-navy-900 marker:hidden">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="space-y-2 border-t border-line px-4 py-3 text-small leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}

const REASON_LABEL: Record<string, string> = {
  county_centroid: "Located at a county centroid",
  outside_georgia: "Outside Georgia",
  default_location: "Placeholder (default) location",
  future_date: "Date after the data snapshot",
  private_property: "On private property",
  no_coordinates: "No coordinates",
  xy_mismatch: "Geometry disagrees with report",
  missing_date: "Missing date",
  duplicate_report: "Duplicate report",
};

export default async function MethodologyPage() {
  const repo = getRepository();
  const [meta, validation, index, colleges, statewide] = await Promise.all([repo.getMeta(), repo.getValidation(), repo.getSchoolIndex(), repo.getCollegeIndex(), readStatewideManifest()]);
  const modes: TravelMode[] = ["walk", "bike", "drive"];
  const factorIds = CROSSSCORE_MODEL.factors.map((f) => f.id) as CrossScoreFactorId[];
  const q = meta.quality;
  const removed = q.crashCleaning.filter((r) => r.records > 0).sort((a, b) => b.records - a.records);
  const assoc = q.association;
  const nearSchools = (assoc.assigned ?? 0) + (assoc.limited_access ?? 0) + (assoc.off_network ?? 0) + (assoc.ramp ?? 0) + (assoc.no_candidate ?? 0);
  const traffic = q.trafficCoverage;
  const trafficTotal = (traffic.measured ?? 0) + (traffic.partial ?? 0) + (traffic.unavailable ?? 0);

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[200px_1fr]">
      <nav aria-label="Methodology sections" className="hidden lg:block">
        <ul className="sticky top-20 space-y-1 text-small">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded px-2 py-1 text-ink-soft hover:bg-white hover:text-navy-900">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <article className="min-w-0 space-y-12">
        <header>
          <p className="eyebrow">Methodology · Model {MODEL.version}</p>
          <h1 className="mt-1 text-page font-semibold text-navy-900 sm:text-display">How CrossMetric works</h1>
          <p className="mt-3 max-w-[760px] text-body leading-relaxed text-ink-soft">
            CrossMetric has two layers built on the same data. <strong>Analyze</strong> turns public school and transportation data into a ranked, explainable list of the roads and
            intersections around a school with the strongest historical evidence for professional safety review. <strong>Move</strong> scores the routes people actually take — walking,
            biking, driving — with CrossScore. Every number in the app can be traced back through the steps below.
          </p>
          <p className="mt-3 text-small text-ink-muted">
            Crash data {formatDate(meta.window.start)} – {formatDate(meta.window.end)} · retrieved {formatDate(meta.dataSnapshot)} · processed {formatTimestampDate(meta.generatedAt)}
          </p>
        </header>

        <Section
          id="problem"
          title="Problem"
          lead="Georgia already records crashes, injuries, pedestrian involvement, traffic volume and road characteristics, but in separate datasets. Nobody can easily ask: around this school, which locations have the strongest evidence that they deserve a professional safety review first?"
        >
          <p>
            CrossMetric answers that question for every Georgia public school. It is <strong>decision support</strong>: it prioritizes where to look. It does not predict
            crashes, label roads as dangerous, or recommend specific engineering changes; those require a professional review, which is the point of the ranking.
          </p>
        </Section>

        <Section id="data" title="Data" lead="Only authoritative public data is used. Each source's live schema is checked on every pipeline run, so a renamed or retyped field stops the build instead of silently corrupting results.">
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[640px] text-small">
              <caption className="sr-only">Data sources</caption>
              <thead>
                <tr className="border-b border-line text-left text-meta text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Dataset</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Publisher</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Used for</th>
                </tr>
              </thead>
              <tbody>
                {meta.sources.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0 align-top">
                    <td className="px-3 py-2">
                      <a href={s.url} className="font-medium text-navy-900 underline decoration-line-strong underline-offset-2 hover:decoration-navy-700" rel="noreferrer" target="_blank">
                        {s.title}
                      </a>
                      {s.records ? <span className="block text-meta text-ink-muted">{formatInt(s.records)} records</span> : null}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{s.publisher}</td>
                    <td className="px-3 py-2 text-ink-soft">{s.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="panel p-4">
              <h3 className="text-small font-semibold text-navy-900">Crash record quality</h3>
              <p className="mt-1 text-meta text-ink-soft">
                Of {formatInt(q.crashesRaw)} GDOT crash records, {formatInt(q.crashesClean)} passed every check. Removed records are kept in a quarantine table with their reason.
              </p>
              <div className="mt-4">
                <ValueBars
                  total={q.crashesRaw}
                  rows={[
                    { label: "Clean, inside the analysis window", value: q.crashesClean, tone: "keep" },
                    ...removed.map((r) => ({ label: REASON_LABEL[r.reason] ?? r.reason, value: r.records, tone: "drop" as const })),
                    ...(q.crashesBeforeWindow ? [{ label: "In an incomplete month (excluded)", value: q.crashesBeforeWindow, tone: "drop" as const }] : []),
                  ]}
                />
              </div>
            </div>
            <div className="panel p-4">
              <h3 className="text-small font-semibold text-navy-900">Crashes near schools</h3>
              <p className="mt-1 text-meta text-ink-soft">
                {formatInt(nearSchools)} clean crashes fall within school analysis areas. Each is matched to at most one location, so nothing is double-counted.
              </p>
              <div className="mt-4">
                <ValueBars
                  total={nearSchools}
                  rows={[
                    { label: "Matched to an intersection or segment", value: assoc.assigned ?? 0, tone: "keep" },
                    { label: "On an interstate or freeway mainline", value: assoc.limited_access ?? 0, tone: "drop" },
                    { label: "More than 30 m from any road", value: assoc.off_network ?? 0, tone: "drop" },
                    { label: "On a ramp, away from its terminal", value: assoc.ramp ?? 0, tone: "drop" },
                    { label: "On a road too short to form a unit", value: assoc.no_candidate ?? 0, tone: "drop" },
                  ]}
                />
              </div>
            </div>
          </div>
          <div className="panel p-4">
            <h3 className="text-small font-semibold text-navy-900">Crash records per month</h3>
            <p className="mt-1 text-meta text-ink-soft">
              GDOT&apos;s public layer is a rolling window of about three years, so a five-year option is not offered. The newest month is excluded when GDOT has loaded less
              than half a normal month (only {formatInt(q.crashesBeforeWindow)} records had arrived for the month after {formatDate(meta.window.end)}).
            </p>
            <div className="mt-3">
              <MonthlyBars data={q.monthlyCrashes} windowEnd={meta.window.end} />
            </div>
          </div>
          <Details summary="Three data problems found by inspecting the data rather than trusting it">
            <p>
              <strong>The PEDESTRIAN field.</strong> GDOT&apos;s PEDESTRIAN flag is “1” on 99.2% of all crashes, so it cannot mean “a pedestrian was involved.”
              CrossMetric instead marks a crash pedestrian-involved when one of its recorded units is “00-Pedestrian” (a conservative lower bound).
            </p>
            <p>
              <strong>Placeholder locations.</strong> About 50,700 crashes are placed at a county centroid, and some coordinates hold hundreds of reports from many counties
              (one point held 3,517 crashes from 42 counties). A first rule that removed any coordinate with 25+ reports turned out to be wrong: GEARS snaps many real
              crashes to road points, and that rule would have deleted about 92,000 legitimate crashes at the busiest intersections. The final rule removes a stacked coordinate
              only if it spans 3+ counties, is a round number, or has almost no crashes around it.
            </p>
            <p>
              <strong>Parking lots.</strong> {formatInt(q.crashCleaning.find((r) => r.reason === "private_property")?.records ?? 0)} crashes are coded “private property.”
              Without excluding them, school parking-lot incidents would dominate the analysis around schools.
            </p>
          </Details>
        </Section>

        <Section id="spatial" title="Spatial processing" lead="Schools, crashes and roads arrive in three different coordinate systems. Everything is converted to one projection that measures true meters before any distance is computed.">
          <PipelineDiagram />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel p-4">
              <h3 className="text-small font-semibold text-navy-900">Why not Web Mercator?</h3>
              <p className="mt-1 text-small text-ink-soft">
                GDOT serves crashes in Web Mercator, which inflates distances by about <strong>20%</strong> at Georgia&apos;s latitude. An “800 m” buffer drawn there covers only about
                664 m on the ground. CrossMetric works in the Georgia Statewide Lambert projection (in meters), whose worst distortion anywhere in Georgia is 0.059%.
              </p>
            </div>
            <div className="panel p-4">
              <h3 className="text-small font-semibold text-navy-900">Candidate locations</h3>
              <p className="mt-1 text-small text-ink-soft">
                The analysis built {formatInt(q.intersections)} intersections and {formatInt(q.segments)} mid-block segment units around {formatInt(index.schools.length)} schools from GDOT&apos;s
                2025 road inventory, with street names conflated from Census TIGER.
              </p>
            </div>
          </div>
          <Details summary="How an intersection is detected">
            <p>
              An intersection is a point where surface roads leave in <strong>three or more distinct directions</strong> (directions within 25° are merged), or two surface directions
              plus the end of a ramp. Counting directions instead of road features handles the quirks of a linear-referencing network:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>A road split mid-block where an attribute changes has only two directions, so it is not an intersection.</li>
              <li>Concurrent routes that share geometry produce duplicate directions that collapse into one.</li>
              <li>Interstates and freeways never contribute directions, so an overpass is not mistaken for a crossing.</li>
              <li>Ramps count only at their ends, creating ramp-terminal intersections but not false crossings where a ramp flies over a street.</li>
              <li>Nodes within 35 m are merged, so both carriageways of a divided highway meeting a street form one intersection, and the planner never spends two slots on it.</li>
            </ul>
          </Details>
          <Details summary="How crashes and traffic are matched to locations">
            <ul className="list-disc space-y-1 pl-5">
              <li>Each crash snaps to the nearest road centerline within 30 m (about 100 ft).</li>
              <li>If it is within 76.2 m (250 ft, the Highway Safety Manual convention) of an intersection that the snapped road belongs to, it counts for that intersection.</li>
              <li>Otherwise it counts for the mid-block unit on the same road. Crashes on a divided highway&apos;s opposite carriageway land on the same unit.</li>
              <li>AADT is matched by GDOT route ID and proximity, never by proximity alone, so a quiet side street cannot borrow a highway&apos;s volume. Missing AADT stays missing.</li>
            </ul>
          </Details>
        </Section>

        <Section id="features" title="Feature engineering" lead="For each candidate location, raw observations are counted under the analysis period and crash filter you choose. All five indicators are recomputed instantly in your browser when any control changes.">
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[620px] text-small">
              <caption className="sr-only">Indicators</caption>
              <thead>
                <tr className="border-b border-line text-left text-meta text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Component</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Raw measure</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Higher priority when</th>
                </tr>
              </thead>
              <tbody>
                {MODEL.components.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-navy-900">{c.label}</th>
                    <td className="px-3 py-2 text-ink-soft">{c.description}</td>
                    <td className="px-3 py-2 text-ink-soft">{c.direction === "lower-is-priority" ? "Closer to the school" : `More ${c.unit}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-small text-ink-soft">
            Traffic coverage: {formatInt(traffic.measured ?? 0)} locations have measured AADT, {formatInt(traffic.partial ?? 0)} have partial coverage (some crossing roads uncounted) and{" "}
            {formatInt(traffic.unavailable ?? 0)} ({Math.round((100 * (traffic.unavailable ?? 0)) / Math.max(trafficTotal, 1))}%) have none, mostly local streets GDOT does not count.
            Unavailable is never treated as zero: the Traffic Context component is excluded and the other weights are rescaled.
          </p>
        </Section>

        <Section id="normalization" title="Normalization" lead="Crash counts, vehicles per day and meters cannot be added together. Each indicator is converted to a percentile among the candidates in the same school analysis.">
          <Formula caption={MODEL.normalization.population}>{MODEL.normalization.formula}</Formula>
          <div className="panel p-4 text-small">
            <p className="font-semibold text-navy-900">Worked example</p>
            <p className="mt-1 text-ink-soft">
              Four candidates have 0, 0, 2 and 5 pedestrian crashes. The candidate with 2 has 3 of 4 values at or below it, so it scores 100 × 3 / 4 = <strong>75</strong>; the one with 5
              scores <strong>100</strong>. The two with no pedestrian crashes score <strong>0</strong>, not 50, because of the zero-evidence rule:
            </p>
            <p className="mt-2 text-ink-soft">{MODEL.normalization.zeroEvidenceRule}</p>
          </div>
          <p className="text-small text-ink-soft">
            Percentiles make every score relative to <em>this</em> school&apos;s surroundings, so the app always states the population (“95th percentile among 62 candidates”). Percentile and
            rank methods are standard in composite indicators ({MODEL.normalization.reference}).
          </p>
        </Section>

        <Section id="scoring" title="Scoring" lead="Priority for Review combines the five percentile scores with transparent weights that live in one versioned model file, shared by the Python pipeline and the web app.">
          <Formula caption="Components without data (unavailable AADT) are left out of both sums.">{MODEL.combination.formula}</Formula>
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[560px] text-small">
              <caption className="sr-only">Weights by scenario</caption>
              <thead>
                <tr className="border-b border-line text-left text-meta text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Scenario</th>
                  {MODEL.components.map((c) => (
                    <th key={c.id} scope="col" className="px-3 py-2 text-right font-semibold">{c.label.replace(" Evidence", "").replace(" Context", "")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODEL.scenarios.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-navy-900">{s.label}</th>
                    {MODEL.components.map((c) => (
                      <td key={c.id} className={`tabular px-3 py-2 text-right ${s.weights[c.id] > 1 ? "font-semibold text-navy-900" : "text-ink-soft"}`}>{s.weights[c.id]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-small text-ink-soft">
            <strong>Why these weights?</strong> {MODEL.scenarios[0]?.description} CrossMetric does not claim that any weighting is scientifically validated, which is exactly why the
            alternate scenarios exist.
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            {MODEL.bands.map((b) => (
              <div key={b.id} className="panel p-3">
                <p className="text-small font-semibold text-navy-900">{b.label}</p>
                <p className="tabular text-meta text-ink-muted">
                  {b.min}
                  {b.id === "high" ? "–100" : `–${(MODEL.bands[MODEL.bands.indexOf(b) - 1]?.min ?? 101) - 1}`}
                </p>
              </div>
            ))}
          </div>
          <p className="text-small text-ink-soft">Bands describe priority for review, not objective danger. Ties are broken by more crashes, then closer to the school, then a stable ID, so results are reproducible.</p>
        </Section>

        <Section id="sensitivity" title="Sensitivity" lead={MODEL.scenarioRationale}>
          <Formula caption={MODEL.stability.definition}>spread = worst rank − best rank (across all four scenarios)</Formula>
          {validation?.experiments.find((e) => e.id === "robustness") ? (
            <ExperimentCard exp={validation.experiments.find((e) => e.id === "robustness")!} />
          ) : null}
          <p className="text-small text-ink-soft">
            Because each alternate scenario doubles only one weight, the locations at the top of a list, whose evidence is strong on several components at once, rarely move far. Low stability
            appears mostly in the middle of lists, where scores are close together and small weight changes reorder them.
          </p>
        </Section>

        <Section id="validation" title="Validation" lead="The model file was fixed before these experiments ran, and the weights were not tuned to improve them. Results are reported as they came out, including where a simpler method does better.">
          {validation ? (
            <div className="space-y-4">
              {validation.experiments
                .filter((e) => e.id !== "robustness")
                .map((e) => (
                  <ExperimentCard key={e.id} exp={e} />
                ))}
            </div>
          ) : (
            <p className="text-ink-soft">Validation results are not available. Run: python -m pipeline.validation.run</p>
          )}
          <div className="panel p-4 text-small text-ink-soft">
            <p className="font-semibold text-navy-900">Implementation checks</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>The browser engine (TypeScript) and the reference pipeline (Python) produce bit-identical scores on real school packages, verified by an automated parity test.</li>
              <li>Unit tests cover normalization, weighting, bands, ranking ties, stability, explanations, the planner, CRS distortion, intersection detection, crash matching and data cleaning.</li>
              <li>A data-contract test checks every published package against the database&apos;s constraints and confirms no NaN or Infinity can reach the screen.</li>
            </ul>
          </div>
        </Section>


        <Section
          id="crossscore"
          title="CrossScore"
          lead={CROSSSCORE_MODEL.summary}
        >
          <p>
            A route is measured against CrossMetric&apos;s statewide data: every clean GDOT crash within {CROSSSCORE_MODEL.bufferM} m of the route (the same tolerance used to match crashes to
            roads around schools), the GDOT road class, through lanes and traffic count of the roads it runs along, the arterials and 4+ lane roads it crosses, and — from OpenStreetMap — recorded
            sidewalks, bike facilities and posted speed limits. Each factor becomes a 0–100 condition score (higher is more favorable); CrossScore is their weighted average for the travel mode.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[640px] text-small">
              <caption className="sr-only">CrossScore factors and weights by mode</caption>
              <thead>
                <tr className="border-b border-line text-left text-meta text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Factor</th>
                  <th scope="col" className="px-3 py-2 font-semibold">How it is measured</th>
                  {modes.map((m) => (
                    <th key={m} scope="col" className="px-3 py-2 text-right font-semibold">
                      {CROSSSCORE_MODEL.modes[m].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factorIds.map((id) => {
                  const f = CROSSSCORE_MODEL.factors.find((x) => x.id === id)!;
                  return (
                    <tr key={id} className="border-b border-line align-top last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-medium text-navy-900">
                        {f.label}
                        <span className="block text-meta font-normal text-ink-muted">{f.source}</span>
                      </th>
                      <td className="px-3 py-2 text-ink-soft">{f.description}</td>
                      {modes.map((m) => (
                        <td key={m} className="tabular px-3 py-2 text-right">
                          {CROSSSCORE_MODEL.modes[m].weights[id] ?? <span className="text-ink-faint">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Formula caption="Crash factors compare what was found with what is typical for the same amount of road in the same setting.">
            ratio = crashes found ÷ (average crashes per km in the setting × km of route); score = 100 ÷ (1 + ratio × {100 - CROSSSCORE_MODEL.crashScale.averageScore}/{CROSSSCORE_MODEL.crashScale.averageScore})
          </Formula>
          <p>
            No crashes scores 100, exactly the average scores {CROSSSCORE_MODEL.crashScale.averageScore}, twice the average about 54. A route through downtown Atlanta is compared with downtown streets, not
            with rural roads: Georgia&apos;s public roads were cut into ~1 km stretches and grouped by how busy their surroundings are (surface-street crashes within about 1.4 km).
          </p>
          {statewide ? (
            <div className="overflow-x-auto rounded-lg border border-line bg-white">
              <table className="w-full min-w-[560px] text-small">
                <caption className="sr-only">Reference settings</caption>
                <thead>
                  <tr className="border-b border-line text-left text-meta text-ink-muted">
                    <th scope="col" className="px-3 py-2 font-semibold">Setting</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Road km</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Crashes / km</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Injury / km</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Pedestrian / km</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Bicycle / km</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(statewide.references.contexts).map(([id, c]) => (
                    <tr key={id} className="border-b border-line last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-medium capitalize text-navy-900">
                        {c.label}
                      </th>
                      <td className="tabular px-3 py-2 text-right">{formatInt(c.km)}</td>
                      <td className="tabular px-3 py-2 text-right">{c.mean.all.toFixed(2)}</td>
                      <td className="tabular px-3 py-2 text-right">{c.mean.injury.toFixed(2)}</td>
                      <td className="tabular px-3 py-2 text-right">{c.mean.pedestrian.toFixed(3)}</td>
                      <td className="tabular px-3 py-2 text-right">{c.mean.bicyclist.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-line px-3 py-2 text-meta text-ink-muted">Averages over the full crash window ({formatDate(statewide.window.start)} – {formatDate(statewide.window.end)}). {statewide.references.activity.definition}.</p>
            </div>
          ) : null}
          <Details summary="Road speed, lanes, traffic, sidewalks, bike facilities and crossings">
            <p>
              <strong>Road speed</strong> converts the distance-weighted posted limit into 100 × (1 − pedestrian risk of death at that impact speed): {CROSSSCORE_MODEL.speedRisk.reference} It is
              used only when at least {Math.round(CROSSSCORE_MODEL.speedRisk.minCoverage * 100)}% of street distance has a recorded limit.
            </p>
            <p>
              <strong>Lanes</strong> scores each meter: 1–2 lanes {CROSSSCORE_MODEL.laneScores.upTo2}, 3 lanes {CROSSSCORE_MODEL.laneScores.three}, 4–5 lanes {CROSSSCORE_MODEL.laneScores.fourOrFive}, 6+
              lanes {CROSSSCORE_MODEL.laneScores.sixPlus}. <strong>Traffic volume</strong> uses the FHWA STEP thresholds: under 9,000 vehicles/day {CROSSSCORE_MODEL.volumeScores.below9000}, under 12,000{" "}
              {CROSSSCORE_MODEL.volumeScores.below12000}, under 15,000 {CROSSSCORE_MODEL.volumeScores.below15000}, under 30,000 {CROSSSCORE_MODEL.volumeScores.below30000}, above{" "}
              {CROSSSCORE_MODEL.volumeScores.atLeast30000}. Every multilane road is in the GDOT index, so a stretch not on it is a one- or two-lane local street; local streets have no GDOT count and are
              treated as under 9,000.
            </p>
            <p>
              <strong>Sidewalk availability</strong> is the share of the walk on footpaths or streets where OpenStreetMap records a sidewalk — a lower bound, because unrecorded is not the same as
              missing. <strong>Protected path availability</strong> gives full credit to separated paths and protected lanes, 60% to painted bike lanes and 30% to shared-lane markings.
            </p>
            <p>
              <strong>Crossing exposure</strong> counts where the route crosses (not turns onto) an arterial or a road with 4+ lanes, checking that it ends on the other side. Each crossing without a GDOT
              signal record costs {CROSSSCORE_MODEL.crossingCost.walk.unsignalized} points for walking and each signalized one {CROSSSCORE_MODEL.crossingCost.walk.signalized}.
            </p>
            <p>A factor without data is left out and the remaining weights are rescaled, exactly like missing traffic counts in Priority for Review; it is never counted as zero. The share of weight with data is shown as data coverage.</p>
          </Details>
          <Details summary="How the safest, balanced and fastest routes are chosen">
            <p>
              CrossMetric asks the routing service for the fastest route and its alternatives, a route that prefers sidewalks and footpaths (walking) or bike paths (biking), and a route that avoids the
              worst crash clusters found on the fastest route. Near-duplicates are removed and every remaining route is scored on the same data.
            </p>
            <p>
              <strong>Fastest</strong> is the shortest travel time. <strong>Safest</strong> is the highest CrossScore among routes at most {Math.round((CROSSSCORE_MODEL.selection.safestMaxTimeRatio - 1) * 100)}%
              (and {CROSSSCORE_MODEL.selection.safestMaxExtraMinutes} minutes) slower than the fastest, so it stays practical. <strong>Balanced</strong> is the highest CrossScore after subtracting{" "}
              {CROSSSCORE_MODEL.selection.balancedRatioPenalty} points per 100% of extra travel time. When one route wins several roles, it is shown once.
            </p>
          </Details>
          <Details summary="Safer pickup and drop-off">
            <p>
              Curb points within {CROSSSCORE_MODEL.curb.maxWalkM} m of walking are found by snapping nearby points to drivable streets. Each is compared on crashes within {CROSSSCORE_MODEL.curb.nearbyM} m (same
              setting-relative scale), lanes, traffic and posted speed. An alternative is recommended only when it scores at least {CROSSSCORE_MODEL.curb.minImprovement} points higher than the closest curb.
              Rides are booked with the provider; CrossMetric never shows prices or driver availability.
            </p>
          </Details>
        </Section>

        <Section id="routing" title="Routes & live services" lead="Routes are calculated when you ask for them; the safety data they are scored with is historical and published by the pipeline.">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Routing</strong>: Valhalla on the OpenStreetMap road network (the FOSSGIS public server by default; a self-hosted server can be configured). It also supplies the OpenStreetMap
              attributes of each street the route uses.
            </li>
            <li>
              <strong>Place search</strong>: Georgia schools and colleges from CrossMetric&apos;s own index first, then addresses and places from Photon (OpenStreetMap).
            </li>
            <li>
              <strong>Transit</strong>: MARTA stops and rail lines from the agency&apos;s public GTFS feed{statewide ? ` (feed of ${formatDate(statewide.transit.feedDate)})` : ""}. CrossMetric shows nearby stops but
              does not calculate schedules or score transit rides.
            </li>
            <li>
              <strong>Colleges</strong>: {formatInt(colleges?.schools.length ?? 0)} active, degree-granting Georgia institutions from IPEDS Institutional Characteristics 2024–25 (NCES), analyzed with exactly the
              same pipeline as K–12 schools in a separate pass, so adding them changed no school&apos;s results.
            </li>
            <li>
              <strong>Time of day</strong> does not change CrossScore. When a trip happens at dawn, dusk or in the dark (computed from the sun&apos;s position), the low-light crashes along the route are shown.
            </li>
          </ul>
        </Section>

        <Section id="reports" title="Community reports" lead="People can flag missing sidewalks, difficult crossings, blocked paths and other issues.">
          <p>
            Reports are anonymous community information. They are never used in CrossScore or Priority for Review and are never presented as official data. Other visitors can say “I see this too”
            (two or more make a report community-confirmed) or “It&apos;s fixed” (two or more mark it reported fixed). Links, email addresses and phone numbers are rejected, and submissions are rate-limited.
          </p>
        </Section>

        <Section id="privacy" title="Privacy" lead="No accounts, no tracking, no personal data.">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>“Use my location” runs in your browser only after you allow it. Your location is never stored and never written into a shareable link.</li>
            <li>Routing and place searches are sent from the CrossMetric server, so your IP address is not passed to the routing or geocoding services. Results are cached on the server.</li>
            <li>Saved places and trips stay in your browser&apos;s local storage.</li>
            <li>Community reports store only the category, optional description, location and time — no names, emails or IP addresses.</li>
          </ul>
        </Section>

        <Section id="limitations" title="Limitations" lead="What CrossMetric cannot conclude.">
          <ul className="list-disc space-y-2 pl-5 text-small text-ink-soft">
            <li>Historical crash reports are an incomplete record: not every crash is reported, and recent months are still being entered by GDOT.</li>
            <li>A high priority means the historical evidence stands out relative to other locations near the same school, not that the location is unsafe or that a crash will occur.</li>
            <li>Scores are relative within one analysis, so a 70 near one school is not comparable to a 70 near another.</li>
            <li>Pedestrian involvement is a lower bound, because GDOT&apos;s public layer exposes only two units per crash.</li>
            <li>Crash locations are police-reported coordinates. At grade-separated crossings, position alone cannot say which level a crash happened on; the nearest centerline is used.</li>
            <li>Many local streets have no GDOT traffic count; those locations are scored without Traffic Context.</li>
            <li>AADT comes from a republication of GDOT&apos;s 2023 segment layer, because GDOT&apos;s own map server could not be reached. It agrees closely with GDOT station counts (see Validation).</li>
            <li>Sidewalks, crosswalks, lighting and school walking routes are not available as statewide public data. Priority for Review does not consider them; CrossScore uses sidewalks and posted speeds where OpenStreetMap records them, which is incomplete.</li>
            <li>Crash counts reflect how many people travel a street as well as how risky it is; no public data measures how many people walk or bike each street. Comparing with streets in a similar setting reduces, but does not remove, this effect.</li>
            <li>CrossScore describes conditions found in historical data along a route. A high score is not a promise that a trip is safe, and a low one is not a prediction of a crash.</li>
            <li>School bus routes, campus shuttles, building entrances and official pickup zones are not public data, so they are not scored.</li>
            <li>Signal information covers GDOT-permitted signals only; “no record” does not mean the intersection is unsignalized.</li>
          </ul>
        </Section>

        <Section id="version" title="Version">
          <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-2">
            {[
              ["Model", `${MODEL.name} ${MODEL.version} (released ${formatDate(MODEL.released)})`],
              ["Crash window", `${formatDate(meta.window.start)} – ${formatDate(meta.window.end)}`],
              ["Data retrieved", formatDate(meta.dataSnapshot)],
              ["Processed", formatTimestampDate(meta.generatedAt)],
              ["Schools", `${formatInt(index.schools.length)} (NCES 2024–25)`],
              ["Colleges", `${formatInt(colleges?.schools.length ?? 0)} (IPEDS 2024–25)`],
              ["CrossScore model", `${CROSSSCORE_MODEL.version} (released ${formatDate(CROSSSCORE_MODEL.released)})`],
              ["Storage", repo.kind === "postgis" ? "Supabase PostgreSQL + PostGIS" : "Published pipeline files"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line py-1.5">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="text-right text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-small text-ink-soft">
            No AI model is used to score, rank or explain anything in CrossMetric. Every result is computed by deterministic, tested code and is reproducible from the same data.
          </p>
          <p className="text-small">
            <Link href="/analyze" className="font-medium text-blue-600 hover:text-navy-700">
              Analyze a school →
            </Link>
          </p>
        </Section>
      </article>
    </div>
  );
}

function ExperimentCard({ exp }: { exp: { id: string; title: string; reference: string; description: string; metrics: { label: string; display: string; note?: string }[] } }) {
  return (
    <div className="panel p-5">
      <h3 className="text-body font-semibold text-navy-900">{exp.title}</h3>
      <p className="mt-0.5 text-meta text-ink-muted">Reference: {exp.reference}</p>
      <p className="mt-2 text-small text-ink-soft">{exp.description}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {exp.metrics.map((m) => (
          <div key={m.label} className="border-b border-line py-1.5">
            <div className="flex items-baseline justify-between gap-3 text-small">
              <dt className="text-ink-soft">{m.label}</dt>
              <dd className="tabular font-semibold text-navy-900">{m.display}</dd>
            </div>
            {m.note ? <p className="text-meta text-ink-muted">{m.note}</p> : null}
          </div>
        ))}
      </dl>
    </div>
  );
}
