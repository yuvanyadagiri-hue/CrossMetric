"use client";

import { useId } from "react";
import { MODEL } from "@crossmetric/engine";
import type { CrashFilterId, PeriodYears, RadiusMeters, ScenarioId } from "@crossmetric/engine";
import { InfoTip } from "@/components/ui/primitives";
import type { AnalysisWorkspace, WorkspacePatch } from "@/lib/workspace";

function Field({ label, help, children }: { label: string; help: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        <InfoTip label={label}>{help}</InfoTip>
      </div>
      {children(id)}
    </div>
  );
}

export function AnalysisControls({ workspace, update }: { workspace: AnalysisWorkspace; update: (p: WorkspacePatch) => void }) {
  return (
    // Two columns only when each select can show its longest value ("Standard (Balanced)", "Full window
    // (~3 yr)", about 135 px plus padding); in a narrow phone or sidebar the fields stack.
    <div className="@container">
      <div className="grid grid-cols-1 gap-y-2.5 @[380px]:grid-cols-2 @[380px]:gap-x-3">
        <Field label="Analysis radius" help="Candidate locations whose nearest point is within this straight-line distance of the school are analyzed and ranked against each other.">
          {(id) => (
            <select id={id} className="select" value={workspace.analysisRadiusMeters} onChange={(e) => update({ radius: Number(e.target.value) as RadiusMeters })}>
              {MODEL.radii.map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString("en-US")} meters
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Time period" help={MODEL.periodRationale}>
          {(id) => (
            <select id={id} className="select" value={workspace.analysisPeriodYears} onChange={(e) => update({ period: Number(e.target.value) as PeriodYears })}>
              {MODEL.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === 1 ? "12 months" : "Full window (~3 yr)"}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Crash filter" help="Only crashes matching this filter count as evidence. Pedestrian involvement is derived from GDOT unit types; low-light means dawn, dusk or dark.">
          {(id) => (
            <select id={id} className="select" value={workspace.activeFilters.crashFilter} onChange={(e) => update({ filter: e.target.value as CrashFilterId })}>
              {MODEL.crashFilters.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id === "all" ? "All crashes" : f.id === "injury" ? "Injury or fatal" : f.id === "pedestrian" ? "Pedestrian-involved" : "Low-light"}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Scoring scenario" help={MODEL.scenarioRationale}>
          {(id) => (
            <select id={id} className="select" value={workspace.activeScoringScenario} onChange={(e) => update({ scenario: e.target.value as ScenarioId })}>
              {MODEL.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </div>
  );
}
