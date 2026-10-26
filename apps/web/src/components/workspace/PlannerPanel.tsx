"use client";

import { useMemo, useState } from "react";
import { formatMeters, MAX_CAPACITY, MODEL, planReviews, plannerSummary } from "@crossmetric/engine";
import type { AnalysisResult } from "@crossmetric/engine";
import { InfoTip, PriorityPill } from "@/components/ui/primitives";

interface Props {
  result: AnalysisResult;
  capacity: number | null;
  selectedId: string | null;
  onCapacity: (n: number | null) => void;
  onSelect: (id: string) => void;
}

export function PlannerPanel({ result, capacity, selectedId, onCapacity, onSelect }: Props) {
  // The parent remounts this panel (key) when capacity changes, which resets the draft.
  const [draft, setDraft] = useState(String(capacity ?? 5));
  const plan = useMemo(() => (capacity ? planReviews(result, capacity) : null), [result, capacity]);
  const parsed = Number.parseInt(draft, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_CAPACITY;

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-body font-semibold text-navy-900">Resource Planner</h2>
        <InfoTip label="Resource Planner">
          Chooses the highest-priority locations from the current analysis. A location within {MODEL.planner.coverageRadiusM} m of an already-chosen one on the same road is not given its own slot,
          because one site review would cover both.
        </InfoTip>
      </div>
      <p className="mt-1 text-meta leading-relaxed text-ink-soft">
        How many locations can be professionally reviewed? CrossMetric picks the highest-priority candidates under your current radius, period, crash filter and scenario.
      </p>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCapacity(parsed);
        }}
      >
        <div className="flex-1">
          <label htmlFor="capacity" className="field-label mb-1">
            Review capacity
          </label>
          <div className="flex items-center rounded-chip border border-line-strong focus-within:border-blue-500 focus-within:ring-[3px] focus-within:ring-blue-500/20">
            <button type="button" className="px-3 py-2 text-ink-soft hover:text-ink" aria-label="Decrease capacity" onClick={() => setDraft(String(Math.max(1, (valid ? parsed : 5) - 1)))}>
              −
            </button>
            <input
              id="capacity"
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              className="tabular w-full min-w-0 border-x border-line bg-transparent py-2 text-center text-body font-semibold text-ink outline-none"
              aria-describedby="capacity-help"
            />
            <button type="button" className="px-3 py-2 text-ink-soft hover:text-ink" aria-label="Increase capacity" onClick={() => setDraft(String(Math.min(MAX_CAPACITY, (valid ? parsed : 5) + 1)))}>
              +
            </button>
          </div>
        </div>
        <button type="submit" className="btn-primary h-[40px]" disabled={!valid}>
          Get recommendations
        </button>
      </form>
      <p id="capacity-help" className="mt-1 text-meta text-ink-muted">
        Between 1 and {MAX_CAPACITY} reviews.
      </p>

      {plan ? (
        <div className="mt-4">
          <p className="text-meta font-medium text-navy-900" aria-live="polite">
            {plannerSummary(plan, result)}
          </p>
          <ol className="mt-2 divide-y divide-line rounded-md border border-line">
            {plan.selections.map((sel) => (
              <li key={sel.scored.candidate.id}>
                <button
                  type="button"
                  onClick={() => onSelect(sel.scored.candidate.id)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas ${selectedId === sel.scored.candidate.id ? "bg-blue-50" : ""}`}
                >
                  <span className="tabular grid h-6 w-6 shrink-0 place-items-center rounded-full bg-canvas text-meta font-semibold text-ink-soft">{sel.slot}</span>
                  <PriorityPill value={sel.scored.displayPriority} band={sel.scored.band} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-medium text-ink">{sel.scored.candidate.name}</span>
                    <span className="block text-meta text-ink-muted">
                      Rank #{sel.scored.rank} · {sel.robust ? "Robust across all scenarios" : "Depends on scenario weights"}
                    </span>
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-faint" aria-hidden>
                    <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
          {plan.selections.length > 0 ? (
            <p className="mt-2 text-meta text-ink-soft">
              {plan.robustCount} of {plan.selections.length} recommendation{plan.selections.length === 1 ? "" : "s"} would be reached under every weighting scenario.
            </p>
          ) : null}
          {plan.skipped.length > 0 ? (
            <details className="mt-3 rounded-md bg-canvas p-3 text-meta text-ink-soft">
              <summary className="cursor-pointer font-medium text-ink">
                {plan.skipped.length} nearby location{plan.skipped.length === 1 ? "" : "s"} covered by a selected review
              </summary>
              <ul className="mt-2 space-y-1">
                {plan.skipped.map((sk) => (
                  <li key={sk.scored.candidate.id}>
                    #{sk.scored.rank} {sk.scored.candidate.name} — {formatMeters(sk.distanceM)} from review {sk.coveredBySlot} on {sk.sharedRoad}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-canvas p-3 text-meta text-ink-soft">Enter a capacity and choose “Get recommendations”.</p>
      )}
    </div>
  );
}
