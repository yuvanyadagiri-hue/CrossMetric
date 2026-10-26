import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { runBatch, type EvidenceRecord, type RunReport } from "@crossmetric/engine/research";
import { getResearchStore } from "./store";

export interface SourceEntry {
  id: string;
  owner: string;
  campus: string;
  access: string;
  permittedPurposes: string[];
  retention: string;
  rateLimit: string;
  status: "enabled" | "needs_permission" | "disabled";
  freshness?: string;
  reason: string | null;
}

export async function readRegistry(): Promise<{ updated: string; sources: SourceEntry[] }> {
  const dir = process.env.RESEARCH_REGISTRY_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "research");
  return JSON.parse(await readFile(path.join(dir, "sources.json"), "utf-8"));
}

/**
 * One bounded batch over enabled sources. Only first-party feedback has a
 * connector; every other source is reported with its status and reason.
 */
export async function runResearch(now = Date.now()): Promise<RunReport> {
  const registry = await readRegistry();
  const store = getResearchStore();
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const bySource: { sourceId: string; status: string; reason?: string; records: EvidenceRecord[] }[] = [];
  for (const s of registry.sources) {
    if (s.status !== "enabled") {
      bySource.push({ sourceId: s.id, status: s.status, reason: s.reason ?? undefined, records: [] });
      continue;
    }
    if (s.id === "first-party-feedback") bySource.push({ sourceId: s.id, status: "enabled", records: await store.listFeedback(since) });
    else bySource.push({ sourceId: s.id, status: "disabled", reason: "Enabled in the registry but no connector exists", records: [] });
  }
  const out = runBatch(bySource, now, { windowDays: 30, cap: 1000 });
  await store.saveRun({ report: out.report, drafts: out.drafts });
  return out.report;
}
