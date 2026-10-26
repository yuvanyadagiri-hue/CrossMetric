"use client";

import { formatAadt, formatInt, formatMiles, MODEL } from "@crossmetric/engine";
import type { AnalysisResult, ScoredCandidate } from "@crossmetric/engine";
import { BandLabel, PriorityPill, StabilityBadge } from "@/components/ui/primitives";

type Row = { label: string; render: (s: ScoredCandidate) => React.ReactNode; value?: (s: ScoredCandidate) => number | null; best?: "max" | "min" };

export function ComparePanel({
  compared,
  result,
  onClose,
  onRemove,
  onSelect,
}: {
  compared: ScoredCandidate[];
  result: AnalysisResult;
  onClose: () => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const scoreRow = (id: (typeof MODEL.components)[number]["id"]): Row => ({
    label: MODEL.components.find((c) => c.id === id)?.label ?? id,
    value: (s) => s.breakdown.components.find((c) => c.id === id)?.score ?? null,
    render: (s) => {
      const v = s.breakdown.components.find((c) => c.id === id)?.score ?? null;
      return v === null ? <span className="text-ink-faint">Unavailable</span> : Math.floor(v + 0.5);
    },
    best: "max",
  });
  const rows: Row[] = [
    { label: "Priority", render: (s) => <PriorityPill value={s.displayPriority} band={s.band} />, value: (s) => s.priority, best: "max" },
    { label: "Overall rank", render: (s) => `#${s.rank} of ${result.population}`, value: (s) => s.rank, best: "min" },
    { label: "Priority band", render: (s) => <BandLabel band={s.band} /> },
    scoreRow("crash"),
    scoreRow("injury"),
    scoreRow("pedestrian"),
    scoreRow("traffic"),
    scoreRow("proximity"),
    { label: "Matched crashes", render: (s) => formatInt(s.features.crashes), value: (s) => s.features.crashes, best: "max" },
    { label: "Injury or fatal", render: (s) => formatInt(s.features.injuryCrashes), value: (s) => s.features.injuryCrashes, best: "max" },
    { label: "Pedestrian-involved", render: (s) => formatInt(s.features.pedestrianCrashes), value: (s) => s.features.pedestrianCrashes, best: "max" },
    { label: "AADT", render: (s) => formatAadt(s.features.aadt), value: (s) => s.features.aadt, best: "max" },
    { label: "Distance from school", render: (s) => formatMiles(s.features.distanceM), value: (s) => s.features.distanceM, best: "min" },
    { label: "Ranking stability", render: (s) => <StabilityBadge level={s.sensitivity.stability.level} /> },
    { label: "Rank across scenarios", render: (s) => `#${s.sensitivity.stability.bestRank} – #${s.sensitivity.stability.worstRank}` },
  ];
  const bestIndex = (row: Row): number | null => {
    if (!row.value || !row.best) return null;
    const vals = compared.map(row.value);
    const valid = vals.map((v, i) => [v, i] as const).filter((x): x is readonly [number, number] => x[0] !== null);
    if (valid.length < 2) return null;
    const target = row.best === "max" ? Math.max(...valid.map((x) => x[0])) : Math.min(...valid.map((x) => x[0]));
    const winners = valid.filter((x) => x[0] === target);
    return winners.length === 1 ? winners[0]![1] : null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h2 className="text-body font-semibold text-navy-900">Compare locations</h2>
          <p className="text-meta text-ink-muted">Comparing {compared.length} selected locations under the current analysis.</p>
        </div>
        <button type="button" className="btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <table className="w-full min-w-[480px] border-separate border-spacing-0 text-meta">
          <caption className="sr-only">Side-by-side comparison of selected candidate locations</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 w-[150px] bg-white pb-2 text-left align-bottom text-meta font-semibold text-ink-muted">
                Indicator
              </th>
              {compared.map((s) => (
                <th key={s.candidate.id} scope="col" className="pb-2 pl-3 text-left align-bottom font-semibold text-navy-900">
                  <button type="button" onClick={() => onSelect(s.candidate.id)} className="text-left hover:underline">
                    {s.candidate.name}
                  </button>
                  <button type="button" onClick={() => onRemove(s.candidate.id)} className="ml-1 text-meta font-normal text-ink-faint hover:text-ink" aria-label={`Remove ${s.candidate.name}`}>
                    ✕
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const best = bestIndex(row);
              return (
                <tr key={row.label}>
                  <th scope="row" className="sticky left-0 border-t border-line bg-white py-2 pr-3 text-left font-medium text-ink-soft">
                    {row.label}
                  </th>
                  {compared.map((s, i) => (
                    <td key={s.candidate.id} className={`tabular border-t border-line py-2 pl-3 ${best === i ? "font-semibold text-navy-900" : "text-ink"}`}>
                      {row.render(s)}
                      {best === i ? <span className="sr-only"> (highest priority value in this row)</span> : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-meta text-ink-muted">Bold marks the value that most raises priority in each row. Component scores are percentiles within this analysis.</p>
      </div>
    </div>
  );
}
