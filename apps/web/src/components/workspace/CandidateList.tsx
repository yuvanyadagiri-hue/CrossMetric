"use client";

import { useEffect, useRef } from "react";
import { formatMiles, plural } from "@crossmetric/engine";
import type { AnalysisResult } from "@crossmetric/engine";
import { PriorityPill } from "@/components/ui/primitives";
import { MAX_COMPARE } from "@/lib/workspace";

interface Props {
  result: AnalysisResult;
  selectedId: string | null;
  hoveredId: string | null;
  comparedIds: string[];
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onToggleCompare: (id: string) => void;
}

export function CandidateList({ result, selectedId, hoveredId, comparedIds, onSelect, onHover, onToggleCompare }: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the selected row visible when selection comes from the map.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-candidate="${selectedId}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (result.population === 0) {
    return (
      <div className="px-4 py-8 text-center text-small text-ink-soft">
        <p className="font-medium text-ink">No candidate locations within {result.config.radiusM} m.</p>
        <p className="mt-1">Try a larger analysis radius. Some schools have few public road junctions nearby.</p>
      </div>
    );
  }

  const moveFocus = (from: number, delta: number) => {
    const next = result.candidates[Math.max(0, Math.min(result.candidates.length - 1, from + delta))];
    if (!next) return;
    onSelect(next.candidate.id);
    listRef.current?.querySelector<HTMLElement>(`[data-candidate="${next.candidate.id}"] button[data-row]`)?.focus();
  };

  return (
    <ol ref={listRef} className="divide-y divide-line" aria-label={`Candidate locations ranked by Priority for Review (${result.population})`}>
      {result.candidates.map((s, i) => {
        const id = s.candidate.id;
        const selected = id === selectedId;
        const compared = comparedIds.includes(id);
        const kind = s.candidate.kind === "intersection" ? "Intersection" : "Road segment";
        return (
          <li
            key={id}
            data-candidate={id}
            className={`group flex items-stretch transition-colors ${selected ? "bg-blue-50" : id === hoveredId ? "bg-canvas" : "bg-white"}`}
            onMouseEnter={() => onHover(id)}
            onMouseLeave={() => onHover(null)}
          >
            <button
              type="button"
              data-row
              onClick={() => onSelect(id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  moveFocus(i, 1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  moveFocus(i, -1);
                }
              }}
              aria-current={selected ? "true" : undefined}
              aria-label={`Rank ${s.rank}: ${s.candidate.name}. Priority ${s.displayPriority}, ${s.band.label}. ${kind}, ${formatMiles(s.candidate.distanceM)} from the school, ${plural(s.features.crashes, "matched crash", "matched crashes")}.`}
              className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-1 text-left"
            >
              <span className="tabular w-6 shrink-0 text-right text-meta font-medium text-ink-muted">{s.rank}</span>
              <PriorityPill value={s.displayPriority} band={s.band} />
              <span className="min-w-0 flex-1">
                <span className={`line-clamp-2 text-small font-medium leading-snug [overflow-wrap:anywhere] ${selected ? "text-navy-900" : "text-ink"}`}>{s.candidate.name}</span>
                <span className="block truncate text-meta text-ink-muted">
                  {kind} · {formatMiles(s.candidate.distanceM)} · {plural(s.features.crashes, "crash", "crashes")}
                  {s.features.pedestrianCrashes > 0 ? ` · ${s.features.pedestrianCrashes} ped.` : ""}
                </span>
              </span>
            </button>
            <label className="flex shrink-0 cursor-pointer items-center px-3" title={compared ? "Remove from comparison" : "Add to comparison"}>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-navy-700"
                checked={compared}
                disabled={!compared && comparedIds.length >= MAX_COMPARE}
                onChange={() => onToggleCompare(id)}
                aria-label={`Compare ${s.candidate.name}`}
              />
            </label>
          </li>
        );
      })}
    </ol>
  );
}
