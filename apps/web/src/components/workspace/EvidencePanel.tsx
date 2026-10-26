"use client";

import { useMemo, useState } from "react";
import {
  crashesForCandidate,
  explainCandidate,
  formatAadt,
  formatDate,
  formatInt,
  formatMeters,
  formatMiles,
  formatTimestampDate,
  functionalClassLabel,
  MODEL,
  ordinal,
  periodPhrase,
  plural,
  rankSentence,
} from "@crossmetric/engine";
import type { AnalysisResult, ComponentId, ScoredCandidate, SchoolPackage } from "@crossmetric/engine";
import { BandLabel, InfoTip, PriorityPill, ScoreBar, SectionTitle, StabilityBadge, Tabs } from "@/components/ui/primitives";
import type { DisplayLabels } from "./Workspace";

type Tab = "overview" | "evidence" | "sensitivity" | "crashes" | "data";

interface Props {
  pkg: SchoolPackage;
  scored: ScoredCandidate;
  result: AnalysisResult;
  labels: DisplayLabels;
  processedAt: string;
  compared: boolean;
  canCompare: boolean;
  onToggleCompare: () => void;
  onClose: () => void;
}

export function EvidencePanel({ pkg, scored, result, labels, processedAt, compared, canCompare, onToggleCompare, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const c = scored.candidate;
  const crashes = useMemo(() => crashesForCandidate(pkg, scored.index, result.config), [pkg, scored.index, result.config]);
  const explanation = useMemo(() => explainCandidate(scored, result), [scored, result]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-5 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={onClose} className="btn-quiet -ml-2" aria-label="Back to results">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to results
          </button>
          <button
            type="button"
            onClick={onToggleCompare}
            disabled={!compared && !canCompare}
            className="btn-quiet text-meta disabled:opacity-40"
            aria-pressed={compared}
          >
            {compared ? "✓ In comparison" : "Add to comparison"}
          </button>
        </div>
        <h2 className="mt-1.5 text-component font-semibold leading-snug text-navy-900">{c.name}</h2>
        <p className="text-meta text-ink-muted">
          {c.kind === "intersection" ? "Intersection" : "Road segment"}
          {c.context ? ` · ${c.context}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <PriorityPill value={scored.displayPriority} band={scored.band} size="lg" />
          <div>
            <BandLabel band={scored.band} className="text-body" />
            <p className="text-meta text-ink-muted">{rankSentence(scored, result)}</p>
          </div>
        </div>
      </div>
      <div className="px-5">
        <Tabs<Tab>
          label="Location evidence"
          active={tab}
          onChange={setTab}
          size="sm"
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "evidence", label: "Evidence" },
            { id: "sensitivity", label: "Sensitivity" },
            { id: "crashes", label: "Crashes", badge: scored.features.crashes || undefined },
            { id: "data", label: "Data" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" role="tabpanel">
        {tab === "overview" ? <Overview scored={scored} result={result} /> : null}
        {tab === "evidence" ? (
          <div className="space-y-4 text-small leading-relaxed text-ink">
            <p className="font-medium text-navy-900">{explanation.headline}</p>
            {explanation.drivers.length ? (
              <section>
                <SectionTitle>Why it ranks here</SectionTitle>
                <ul className="list-disc space-y-1.5 pl-5 marker:text-blue-500">
                  {explanation.drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="text-ink-soft">No single indicator is above the median for this analysis; its priority comes from several modest signals.</p>
            )}
            <section>
              <SectionTitle>Context</SectionTitle>
              <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-faint">
                {explanation.context.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </section>
            <section className="rounded-md bg-canvas p-3 text-meta text-ink-soft">
              <p className="mb-1 font-semibold text-ink">Keep in mind</p>
              {explanation.caveats.map((d) => (
                <p key={d} className="mt-1">
                  {d}
                </p>
              ))}
            </section>
          </div>
        ) : null}
        {tab === "sensitivity" ? <Sensitivity scored={scored} result={result} /> : null}
        {tab === "crashes" ? <CrashTable crashes={crashes} labels={labels} result={result} /> : null}
        {tab === "data" ? <Provenance scored={scored} result={result} pkg={pkg} processedAt={processedAt} /> : null}
      </div>
    </div>
  );
}

function componentDetail(id: ComponentId, scored: ScoredCandidate, result: AnalysisResult): string {
  const f = scored.features;
  const comp = scored.breakdown.components.find((x) => x.id === id);
  const pct = comp?.score === null || comp?.score === undefined ? null : `${ordinal(Math.floor(comp.score + 0.5))} percentile`;
  switch (id) {
    case "crash":
      return `${plural(f.crashes, "crash", "crashes")}${pct && f.crashes > 0 ? ` · ${pct}` : ""}`;
    case "injury":
      return `${plural(f.injuryCrashes, "injury or fatal crash", "injury or fatal crashes")}${pct && f.injuryCrashes > 0 ? ` · ${pct}` : ""}`;
    case "pedestrian":
      return `${plural(f.pedestrianCrashes, "pedestrian crash", "pedestrian crashes")}${pct && f.pedestrianCrashes > 0 ? ` · ${pct}` : ""}`;
    case "traffic":
      if (f.aadt === null) return "No GDOT count · excluded, weights rescaled";
      return `${formatAadt(f.aadt)}${scored.candidate.traffic.status === "partial" ? " (partial)" : ""} · ${pct}`;
    case "proximity":
      return `${formatMiles(f.distanceM)} from school · ${pct}`;
  }
  void result;
}

function Overview({ scored, result }: { scored: ScoredCandidate; result: AnalysisResult }) {
  const c = scored.candidate;
  const f = scored.features;
  const period = periodPhrase(result.config.periodYears);
  const t = c.traffic;
  const rows: [string, string][] = [
    [`Matched crashes (${period})`, formatInt(f.crashes)],
    ["Injury or fatal crashes", formatInt(f.injuryCrashes)],
    ["Fatal crashes", formatInt(f.fatalCrashes)],
    ["Pedestrian-involved", formatInt(f.pedestrianCrashes)],
    ["Bicyclist-involved", formatInt(f.bicyclistCrashes)],
    ["Low-light crashes", formatInt(f.lowLightCrashes)],
    [
      c.kind === "intersection" ? "Entering traffic (AADT sum)" : "AADT",
      t.aadt === null ? "Unavailable" : `${formatInt(t.aadt)}${t.status === "partial" ? ` (${t.roadsCounted} of ${t.roadsTotal} roads)` : ""}`,
    ],
    ["Distance from school", `${formatMiles(f.distanceM)} (${formatMeters(f.distanceM)})`],
    ["Road type", functionalClassLabel(c.functionalClass)],
  ];
  if (c.kind === "segment") {
    rows.push(["Through lanes", c.lanes === null ? "Unavailable" : formatInt(c.lanes)]);
    rows.push(["Segment length", formatMeters(c.lengthM)]);
  } else {
    rows.push(["Approaches", c.legs === null ? "Unavailable" : formatInt(c.legs)]);
    rows.push(["Traffic signal", c.signal === "gdot-permitted" ? "GDOT-permitted signal" : "No GDOT signal record"]);
  }
  return (
    <div className="space-y-5">
      <section>
        <SectionTitle
          action={
            <InfoTip label="score breakdown">
              Each indicator is converted to a 0–100 percentile among the {result.population} candidates in this analysis, then combined with the {MODEL.scenarios.find((s) => s.id === result.config.scenario)?.label} weights.
            </InfoTip>
          }
        >
          Score breakdown
        </SectionTitle>
        <ul className="space-y-2.5">
          {scored.breakdown.components.map((comp) => (
            <li key={comp.id}>
              <div className="flex items-baseline justify-between text-meta">
                <span className="font-medium text-ink">{comp.label}</span>
                <span className="tabular font-semibold text-navy-900">{comp.score === null ? "—" : Math.floor(comp.score + 0.5)}</span>
              </div>
              <div className="mt-1">
                <ScoreBar value={comp.score} label={comp.label} />
              </div>
              <p className="mt-0.5 text-meta text-ink-muted">
                {componentDetail(comp.id, scored, result)} · weight {comp.weight}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <SectionTitle>Key information</SectionTitle>
        <dl className="divide-y divide-line rounded-md border border-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-meta">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="tabular text-right font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function Sensitivity({ scored, result }: { scored: ScoredCandidate; result: AnalysisResult }) {
  const st = scored.sensitivity.stability;
  const n = result.population;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StabilityBadge level={st.level} />
        <span className="text-meta text-ink-soft">
          Ranks between #{st.bestRank} and #{st.worstRank} across {MODEL.scenarios.length} scenarios
        </span>
      </div>
      <div className="rounded-md border border-line">
        <table className="w-full text-meta">
          <caption className="sr-only">Rank and priority of this location under each scoring scenario</caption>
          <thead>
            <tr className="border-b border-line text-left text-meta text-ink-muted">
              <th scope="col" className="px-3 py-2 font-semibold">Scenario</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Priority</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Rank</th>
              <th scope="col" className="w-[38%] px-3 py-2 font-semibold">
                <span className="sr-only">Rank position</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {MODEL.scenarios.map((s) => {
              const rank = scored.sensitivity.ranks[s.id];
              const active = s.id === result.config.scenario;
              const pos = n <= 1 ? 0 : ((rank - 1) / (n - 1)) * 100;
              return (
                <tr key={s.id} className={`border-b border-line last:border-0 ${active ? "bg-blue-50/60" : ""}`}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    {s.label}
                    {active ? <span className="ml-1.5 text-meta font-semibold text-blue-600">current</span> : null}
                  </th>
                  <td className="tabular px-3 py-2 text-right">{Math.floor(scored.sensitivity.priorities[s.id] + 0.5)}</td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-navy-900">#{rank}</td>
                  <td className="px-3 py-2">
                    <div className="relative h-1.5 rounded-full bg-[#edf0f4]" aria-hidden>
                      <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-navy-700 shadow" style={{ left: `${pos}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="flex justify-between border-t border-line px-3 py-1.5 text-meta text-ink-faint">
          <span>#1 (highest priority)</span>
          <span>#{n}</span>
        </p>
      </div>
      <div className="rounded-md bg-canvas p-3 text-meta leading-relaxed text-ink-soft">
        <p className="font-semibold text-ink">How stability is defined</p>
        <p className="mt-1">
          Spread = worst rank − best rank = {st.spread} place{st.spread === 1 ? "" : "s"}. With {n} candidates, High stability allows a spread of up to {st.tolerance.high} and Moderate up to {st.tolerance.moderate}{" "}
          (the larger of a fixed minimum and 10% / 25% of the list).
        </p>
        <p className="mt-1">{MODEL.scenarioRationale}</p>
      </div>
    </div>
  );
}

function CrashTable({ crashes, labels, result }: { crashes: ReturnType<typeof crashesForCandidate>; labels: DisplayLabels; result: AnalysisResult }) {
  if (crashes.length === 0) {
    return (
      <p className="py-6 text-center text-small text-ink-soft">
        No crashes matching the current filter were matched to this location in the {periodPhrase(result.config.periodYears)}.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-2 text-meta text-ink-muted">
        {plural(crashes.length, "crash report", "crash reports")} from GDOT (GEARS), newest first. Report IDs let anyone trace each record to its source.
      </p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {crashes.map((k) => (
          <li key={k.id} className="px-3 py-2 text-meta">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{formatDate(k.date)}</span>
              <span className="font-mono text-meta text-ink-faint">GEARS {k.id}</span>
            </div>
            <div className="mt-0.5 text-ink-soft">
              {labels.collision[k.collision] ?? "Not recorded"} · {labels.light[k.light] ?? "Not recorded"}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {k.fatal ? <Tag tone="red">Fatal</Tag> : k.injury ? <Tag tone="orange">Injury</Tag> : <Tag>No injury reported</Tag>}
              {k.pedestrian ? <Tag tone="violet">Pedestrian</Tag> : null}
              {k.bicyclist ? <Tag tone="violet">Bicyclist</Tag> : null}
              {k.lowLight ? <Tag>Low light</Tag> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "red" | "orange" | "violet" }) {
  const cls =
    tone === "red"
      ? "bg-priority-high-bg text-[#a2302a]"
      : tone === "orange"
        ? "bg-priority-elevated-bg text-[#9a5208]"
        : tone === "violet"
          ? "bg-[#f1ecfd] text-[#5b32c4]"
          : "bg-canvas text-ink-soft";
  return <span className={`rounded px-1.5 py-0.5 text-meta font-medium ${cls}`}>{children}</span>;
}

function Provenance({ scored, result, pkg, processedAt }: { scored: ScoredCandidate; result: AnalysisResult; pkg: SchoolPackage; processedAt: string }) {
  const t = scored.candidate.traffic;
  const blocks: { title: string; rows: [string, string][] }[] = [
    {
      title: "Crash data",
      rows: [
        ["Source", "Georgia Department of Transportation — GeoPI Crashes (GEARS)"],
        ["Analysis period", `${formatDate(result.periodWindow.start)} – ${formatDate(result.periodWindow.end)}`],
        ["Crash filter", MODEL.crashFilters.find((f) => f.id === result.config.crashFilter)?.label ?? ""],
        ["Matching rule", "Snapped to the nearest centerline (≤ 30 m); intersection if within 76.2 m of the junction"],
      ],
    },
    {
      title: "Traffic",
      rows: [
        ["AADT", t.aadt === null ? "Unavailable for this location" : `${formatInt(t.aadt)} vehicles/day${t.status === "partial" ? " (partial)" : ""}`],
        ["Count year", t.year === null ? "Unavailable" : String(t.year)],
        ["Source", "Georgia Department of Transportation traffic counts (AADT segments)"],
      ],
    },
    {
      title: "Road",
      rows: [
        ["Geometry & class", "GDOT Road Inventory 2025 (HPMS data items)"],
        ["Street names", "U.S. Census Bureau TIGER/Line (TIGERweb)"],
        ["Signal record", "GDOT GeoPI Traffic Signals"],
      ],
    },
    {
      title: "School",
      rows: [
        ["Source", "National Center for Education Statistics (EDGE / CCD)"],
        ["NCES school ID", pkg.school.id],
        ["School year", pkg.school.schoolYear ?? "Unavailable"],
      ],
    },
    {
      title: "CrossMetric",
      rows: [
        ["Model version", result.model.version],
        ["Processed", formatTimestampDate(processedAt)],
        ["Candidate ID", scored.candidate.id],
      ],
    },
  ];
  return (
    <div className="space-y-4">
      {blocks.map((b) => (
        <section key={b.title}>
          <SectionTitle>{b.title}</SectionTitle>
          <dl className="divide-y divide-line rounded-md border border-line">
            {b.rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[120px_1fr] gap-3 px-3 py-1.5 text-meta">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
