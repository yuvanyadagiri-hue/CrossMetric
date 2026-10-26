"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { CrashFilterId, PeriodYears, RadiusMeters, ScenarioId } from "@crossmetric/engine";

/**
 * The analysis workspace: every piece of analytical state in one place.
 * It lives in the URL, so a shared link recreates the exact analysis.
 *
 *   /analyze/<NCES or IPEDS id>?radius=800&period=3&filter=all&scenario=standard
 *                    &candidate=<id>&compare=<id>,<id>&capacity=5&view=planner
 */
export type WorkspaceView = "list" | "planner" | "compare";

export interface MapLayerState {
  crashes: boolean;
}

export interface AnalysisWorkspace {
  selectedSchoolId: string;
  analysisRadiusMeters: RadiusMeters;
  analysisPeriodYears: PeriodYears;
  activeFilters: { crashFilter: CrashFilterId };
  selectedCandidateId: string | null;
  comparedCandidateIds: string[];
  plannerCapacity: number | null;
  activeScoringScenario: ScenarioId;
  visibleLayers: MapLayerState;
  view: WorkspaceView;
}

export const DEFAULTS = {
  radius: 800 as RadiusMeters,
  period: 3 as PeriodYears,
  filter: "all" as CrashFilterId,
  scenario: "standard" as ScenarioId,
};
export const MAX_COMPARE = 4;

const RADII: RadiusMeters[] = [400, 800, 1200];
const PERIODS: PeriodYears[] = [1, 3];
const FILTERS: CrashFilterId[] = ["all", "injury", "pedestrian", "lowLight"];
const SCENARIOS: ScenarioId[] = ["standard", "pedestrian", "injury", "crash"];
const VIEWS: WorkspaceView[] = ["list", "planner", "compare"];
const CANDIDATE_ID = /^[IS][0-9a-f]{10}$/;

function pick<T extends string | number>(raw: string | null, allowed: T[], fallback: T): T {
  if (raw === null) return fallback;
  const match = allowed.find((v) => String(v) === raw);
  return match ?? fallback;
}

/** Parse (and sanitize) workspace state from URL search params. Pure: unit-tested. */
export function parseWorkspace(schoolId: string, params: URLSearchParams): AnalysisWorkspace {
  const candidate = params.get("candidate");
  const compare = (params.get("compare") ?? "")
    .split(",")
    .filter((id) => CANDIDATE_ID.test(id))
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .slice(0, MAX_COMPARE);
  const capRaw = Number.parseInt(params.get("capacity") ?? "", 10);
  return {
    selectedSchoolId: schoolId,
    analysisRadiusMeters: pick(params.get("radius"), RADII, DEFAULTS.radius),
    analysisPeriodYears: pick(params.get("period"), PERIODS, DEFAULTS.period),
    activeFilters: { crashFilter: pick(params.get("filter"), FILTERS, DEFAULTS.filter) },
    selectedCandidateId: candidate && CANDIDATE_ID.test(candidate) ? candidate : null,
    comparedCandidateIds: compare,
    plannerCapacity: Number.isFinite(capRaw) && capRaw >= 1 ? Math.min(capRaw, 50) : null,
    activeScoringScenario: pick(params.get("scenario"), SCENARIOS, DEFAULTS.scenario),
    visibleLayers: { crashes: params.get("crashes") !== "0" },
    view: pick(params.get("view"), VIEWS, "list"),
  };
}

export type WorkspacePatch = Partial<{
  radius: RadiusMeters;
  period: PeriodYears;
  filter: CrashFilterId;
  scenario: ScenarioId;
  candidate: string | null;
  compare: string[];
  capacity: number | null;
  crashes: boolean;
  view: WorkspaceView;
}>;

/** Serialize a patch onto existing params, dropping values that equal the defaults. */
export function applyPatch(params: URLSearchParams, patch: WorkspacePatch): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null, fallback?: string) => {
    if (value === null || value === "" || value === fallback) next.delete(key);
    else next.set(key, value);
  };
  if (patch.radius !== undefined) set("radius", String(patch.radius), String(DEFAULTS.radius));
  if (patch.period !== undefined) set("period", String(patch.period), String(DEFAULTS.period));
  if (patch.filter !== undefined) set("filter", patch.filter, DEFAULTS.filter);
  if (patch.scenario !== undefined) set("scenario", patch.scenario, DEFAULTS.scenario);
  if (patch.candidate !== undefined) set("candidate", patch.candidate);
  if (patch.compare !== undefined) set("compare", patch.compare.slice(0, MAX_COMPARE).join(","));
  if (patch.capacity !== undefined) set("capacity", patch.capacity === null ? null : String(patch.capacity));
  if (patch.crashes !== undefined) set("crashes", patch.crashes ? null : "0");
  if (patch.view !== undefined) set("view", patch.view, "list");
  return next;
}

export function useAnalysisWorkspace(schoolId: string): [AnalysisWorkspace, (patch: WorkspacePatch) => void] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = searchParams.toString();
  const workspace = useMemo(() => parseWorkspace(schoolId, new URLSearchParams(key)), [schoolId, key]);
  const update = useCallback(
    (patch: WorkspacePatch) => {
      const next = applyPatch(new URLSearchParams(window.location.search), patch).toString();
      // Native history updates useSearchParams without a server round-trip:
      // every analytical change is computed in the browser.
      window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
    },
    [pathname],
  );
  return [workspace, update];
}
