"use client";

import { analysisSummary, filterSummary, MODEL, rankSentence } from "@crossmetric/engine";
import type { AnalysisResult, ScoredCandidate } from "@crossmetric/engine";
import { BandDot } from "@/components/ui/primitives";

/** State-generated context statements (never canned copy). */
export function ContextBar({
  result,
  selected,
  comparedCount,
  plannerCapacity,
}: {
  result: AnalysisResult;
  selected: ScoredCandidate | null;
  comparedCount: number;
  plannerCapacity: number | null;
}) {
  const lines = [analysisSummary(result), filterSummary(result)];
  if (selected) lines.push(`${selected.candidate.name}: ${rankSentence(selected, result)}`);
  if (comparedCount >= 2) lines.push(`Comparing ${comparedCount} selected locations.`);
  if (plannerCapacity) lines.push(`Planning for ${plannerCapacity} professional review${plannerCapacity === 1 ? "" : "s"} using the current analysis.`);
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-160px)] sm:max-w-[min(560px,calc(100%-190px))]">
      <div className="pointer-events-auto rounded-lg border border-line bg-white/95 px-3 py-2 shadow-[var(--shadow-float)] backdrop-blur" aria-live="polite">
        {lines.map((l, i) => (
          <p key={i} className={i === 0 ? "text-meta font-semibold text-navy-900 sm:text-meta" : "hidden text-meta text-ink-soft sm:block"}>
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

export function MapLegend({ result, showCrashes, onToggleCrashes }: { result: AnalysisResult; showCrashes: boolean; onToggleCrashes: (v: boolean) => void }) {
  return (
    <div className="absolute right-3 top-3 z-10 w-[136px] rounded-lg border border-line bg-white/95 p-2.5 shadow-[var(--shadow-float)] backdrop-blur sm:w-[176px] sm:p-3">
      <p className="eyebrow mb-1.5">Priority for review</p>
      <ul className="space-y-1">
        {MODEL.bands.map((b) => (
          <li key={b.id} className="flex items-center justify-between text-meta text-ink">
            <span className="flex items-center gap-2">
              <BandDot band={b.id} />
              {b.shortLabel}
              <span className="hidden text-ink-faint sm:inline">{b.min}+</span>
            </span>
            <span className="tabular text-ink-muted">{result.bandCounts[b.id]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 hidden border-t border-line pt-2 text-meta text-ink-muted sm:block">
        <p className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2 border-navy-700 bg-white" />
          Intersection
        </p>
        <p className="mt-0.5 flex items-center gap-2">
          <span aria-hidden className="inline-block h-1 w-3 rounded-full bg-navy-700" />
          Road segment
        </p>
        <label className="mt-1.5 flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-3.5 w-3.5 accent-navy-700" checked={showCrashes} onChange={(e) => onToggleCrashes(e.target.checked)} />
          <span>Matched crashes</span>
        </label>
        {showCrashes ? (
          <p className="ml-5 mt-0.5 flex items-center gap-2 text-meta">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#7c3aed]" /> pedestrian
          </p>
        ) : null}
      </div>
    </div>
  );
}
