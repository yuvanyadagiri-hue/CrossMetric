"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { runAnalysis } from "@crossmetric/engine";
import type { AnalysisConfiguration, SchoolPackage } from "@crossmetric/engine";
import { AnalysisMap } from "@/components/map/AnalysisMap";
import { Tabs } from "@/components/ui/primitives";
import { MAX_COMPARE, useAnalysisWorkspace, type WorkspaceView } from "@/lib/workspace";
import { AnalysisControls } from "./AnalysisControls";
import { CandidateList } from "./CandidateList";
import { ComparePanel } from "./ComparePanel";
import { ContextBar, MapLegend } from "./MapOverlays";
import { EvidencePanel } from "./EvidencePanel";
import { PlannerPanel } from "./PlannerPanel";
import { SchoolCard } from "./SchoolCard";

export interface DisplayLabels {
  collision: string[];
  light: string[];
}

export function Workspace({ pkg, labels, processedAt }: { pkg: SchoolPackage; labels: DisplayLabels; processedAt: string }) {
  const [ws, update] = useAnalysisWorkspace(pkg.school.id);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const config: AnalysisConfiguration = useMemo(
    () => ({
      radiusM: ws.analysisRadiusMeters,
      periodYears: ws.analysisPeriodYears,
      crashFilter: ws.activeFilters.crashFilter,
      scenario: ws.activeScoringScenario,
    }),
    [ws.analysisRadiusMeters, ws.analysisPeriodYears, ws.activeFilters.crashFilter, ws.activeScoringScenario],
  );
  const result = useMemo(() => runAnalysis(pkg, config), [pkg, config]);

  const selected = useMemo(() => result.candidates.find((s) => s.candidate.id === ws.selectedCandidateId) ?? null, [result, ws.selectedCandidateId]);
  const selectedOutside = ws.selectedCandidateId !== null && selected === null && pkg.candidates.some((c) => c.id === ws.selectedCandidateId);
  const compared = useMemo(
    () => ws.comparedCandidateIds.map((id) => result.candidates.find((s) => s.candidate.id === id)).filter((s): s is NonNullable<typeof s> => !!s),
    [result, ws.comparedCandidateIds],
  );

  const select = useCallback((id: string | null) => update({ candidate: id }), [update]);
  const toggleCompare = useCallback(
    (id: string) => {
      const current = ws.comparedCandidateIds;
      const next = current.includes(id) ? current.filter((x) => x !== id) : current.length < MAX_COMPARE ? [...current, id] : current;
      update({ compare: next });
    },
    [ws.comparedCandidateIds, update],
  );

  // Escape closes the side panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (ws.selectedCandidateId || ws.view === "compare")) {
        if (ws.view === "compare") update({ view: "list" });
        else select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws.selectedCandidateId, ws.view, update, select]);

  const showCompare = ws.view === "compare" && compared.length >= 2;
  const showEvidence = !showCompare && (selected !== null || selectedOutside);
  const rightPanel = showCompare || showEvidence;

  const tabs: { id: WorkspaceView; label: string; badge?: number }[] = [
    { id: "list", label: "Ranked locations" },
    { id: "planner", label: "Resource Planner" },
    { id: "compare", label: "Compare", badge: ws.comparedCandidateIds.length || undefined },
  ];

  return (
    <div
      className={`grid min-h-0 flex-1 grid-cols-1 lg:h-[calc(100dvh-56px)] lg:flex-none lg:grid-rows-[auto_minmax(0,1fr)] ${
        rightPanel ? (showCompare ? "lg:grid-cols-[360px_minmax(0,1fr)_minmax(520px,46%)]" : "lg:grid-cols-[360px_minmax(0,1fr)_420px]") : "lg:grid-cols-[360px_minmax(0,1fr)]"
      }`}
    >
      {/* LEFT (top): school context and analysis controls. Phones: first. */}
      <div className="border-r border-line bg-white lg:col-start-1 lg:row-start-1" role="group" aria-label="Analysis controls">
        <div className="space-y-3 border-b border-line px-4 pb-4 pt-3">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-meta text-ink-muted">
            <Link href="/analyze" className="inline-flex items-center gap-1 rounded hover:text-navy-900">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Analyze
            </Link>
            <span aria-hidden>›</span>
            <span className="truncate text-ink-soft" aria-current="page">
              {pkg.school.name}
            </span>
          </nav>
          <SchoolCard school={pkg.school} />
          <AnalysisControls workspace={ws} update={update} />
        </div>
      </div>

      {/* CENTER: map (spans both left rows on desktop; between controls and list on phones) */}
      <section className="relative h-[55vh] min-h-[360px] min-w-0 overflow-hidden lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-auto" aria-label="Map">
        <AnalysisMap
          pkg={pkg}
          result={result}
          selectedId={ws.selectedCandidateId}
          comparedIds={ws.comparedCandidateIds}
          hoveredId={hoveredId}
          showCrashes={ws.visibleLayers.crashes}
          onSelect={(id) => select(id)}
          onHover={setHoveredId}
        />
        <ContextBar result={result} selected={selected} comparedCount={compared.length} plannerCapacity={ws.view === "planner" ? ws.plannerCapacity : null} />
        <MapLegend result={result} showCrashes={ws.visibleLayers.crashes} onToggleCrashes={(v) => update({ crashes: v })} />
      </section>

      {/* LEFT (bottom): ranked list / planner / compare. Phones: after the map. */}
      <section className="flex min-h-0 flex-col border-r border-line bg-white lg:col-start-1 lg:row-start-2" aria-label="Analysis results">
        <div className="px-4 pt-1">
          <Tabs label="Workspace views" tabs={tabs} active={ws.view} onChange={(view) => update({ view })} size="sm" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {ws.view === "list" ? (
            <CandidateList
              result={result}
              selectedId={ws.selectedCandidateId}
              hoveredId={hoveredId}
              comparedIds={ws.comparedCandidateIds}
              onSelect={(id) => select(id)}
              onHover={setHoveredId}
              onToggleCompare={toggleCompare}
            />
          ) : ws.view === "planner" ? (
            <PlannerPanel key={ws.plannerCapacity ?? "none"} result={result} capacity={ws.plannerCapacity} onCapacity={(capacity) => update({ capacity })} onSelect={(id) => select(id)} selectedId={ws.selectedCandidateId} />
          ) : (
            <CompareSelection compared={compared} onRemove={toggleCompare} onSelect={(id) => select(id)} />
          )}
        </div>
      </section>

      {/* RIGHT: evidence or comparison */}
      {rightPanel ? (
        <aside
          className="fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-white lg:static lg:z-auto lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-line"
          aria-label={showCompare ? "Comparison" : "Location evidence"}
        >
          {showCompare ? (
            <ComparePanel compared={compared} result={result} onClose={() => update({ view: "list" })} onRemove={toggleCompare} onSelect={(id) => update({ candidate: id, view: "list" })} />
          ) : selected ? (
            <EvidencePanel
              key={selected.candidate.id}
              pkg={pkg}
              scored={selected}
              result={result}
              labels={labels}
              processedAt={processedAt}
              compared={ws.comparedCandidateIds.includes(selected.candidate.id)}
              canCompare={ws.comparedCandidateIds.length < MAX_COMPARE}
              onToggleCompare={() => toggleCompare(selected.candidate.id)}
              onClose={() => select(null)}
            />
          ) : (
            <OutsideRadiusNotice onExpand={() => update({ radius: 1200 })} onClear={() => select(null)} radius={result.config.radiusM} />
          )}
        </aside>
      ) : null}
    </div>
  );
}

function OutsideRadiusNotice({ onExpand, onClear, radius }: { onExpand: () => void; onClear: () => void; radius: number }) {
  return (
    <div className="p-6">
      <p className="text-small font-semibold text-navy-900">The selected location is outside the current {radius} m analysis.</p>
      <p className="mt-1 text-small text-ink-soft">Rankings are relative to the candidates inside the radius, so it has no score in this analysis.</p>
      <div className="mt-4 flex gap-2">
        {radius < 1200 ? (
          <button type="button" className="btn-primary" onClick={onExpand}>
            Expand to 1,200 m
          </button>
        ) : null}
        <button type="button" className="btn-quiet" onClick={onClear}>
          Clear selection
        </button>
      </div>
    </div>
  );
}

function CompareSelection({
  compared,
  onRemove,
  onSelect,
}: {
  compared: ReturnType<typeof runAnalysis>["candidates"];
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  if (compared.length === 0) {
    return (
      <div className="px-4 py-6 text-small leading-relaxed text-ink-soft">
        <p className="font-medium text-ink">No locations selected for comparison.</p>
        <p className="mt-1">Use the checkbox beside any ranked location, or “Add to comparison” in its evidence panel. You can compare up to {MAX_COMPARE}.</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <p className="text-meta text-ink-soft">
        {compared.length === 1 ? "Select at least one more location to compare." : `Comparing ${compared.length} selected locations.`}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {compared.map((s) => (
          <li key={s.candidate.id} className="flex items-center justify-between gap-2 py-2">
            <button type="button" onClick={() => onSelect(s.candidate.id)} className="truncate text-left text-small font-medium text-navy-900 hover:underline">
              #{s.rank} {s.candidate.name}
            </button>
            <button type="button" onClick={() => onRemove(s.candidate.id)} className="btn-quiet text-meta" aria-label={`Remove ${s.candidate.name} from comparison`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
