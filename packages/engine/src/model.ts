import rawModel from "../model/crossmetric-model.json";
import type {
  ComponentId,
  PriorityBand,
  ScenarioId,
  ScoringModel,
  SensitivityScenario,
} from "./types";

/**
 * Validate the shared model file once at load time so a malformed edit fails
 * loudly instead of producing silently wrong scores.
 */
export function validateModel(model: ScoringModel): ScoringModel {
  const componentIds = model.components.map((c) => c.id);
  if (new Set(componentIds).size !== componentIds.length) {
    throw new Error("Model has duplicate component ids");
  }
  for (const scenario of model.scenarios) {
    for (const id of componentIds) {
      const w = scenario.weights[id];
      if (typeof w !== "number" || !(w >= 0)) {
        throw new Error(`Scenario ${scenario.id} has no valid weight for ${id}`);
      }
    }
  }
  const mins = model.bands.map((b) => b.min);
  for (let i = 1; i < mins.length; i++) {
    if ((mins[i] ?? 0) >= (mins[i - 1] ?? 0)) throw new Error("Bands must be ordered by descending min");
  }
  if (mins[mins.length - 1] !== 0) throw new Error("Lowest band must start at 0");
  return model;
}

export const MODEL: ScoringModel = validateModel(rawModel as ScoringModel);

export function getScenario(id: ScenarioId, model: ScoringModel = MODEL): SensitivityScenario {
  const scenario = model.scenarios.find((s) => s.id === id);
  if (!scenario) throw new Error(`Unknown scenario ${id}`);
  return scenario;
}

export function bandFor(displayPriority: number, model: ScoringModel = MODEL): PriorityBand {
  for (const band of model.bands) {
    if (displayPriority >= band.min) return band;
  }
  return model.bands[model.bands.length - 1] as PriorityBand;
}

export function componentLabel(id: ComponentId, model: ScoringModel = MODEL): string {
  return model.components.find((c) => c.id === id)?.label ?? id;
}

export const SCENARIO_IDS: ScenarioId[] = MODEL.scenarios.map((s) => s.id);
