import "server-only";

import { formatDate, formatTimestampDate } from "@crossmetric/engine";
import type { DashboardFacts } from "@/components/dashboard/Dashboard";
import { getRepository } from "./repository";
import { readStatewideManifest } from "./statewide";

/** Facts shown on the Explore dashboard (the previous home page). */
export async function dashboardFacts(): Promise<DashboardFacts> {
  const repo = getRepository();
  const [index, colleges, meta, manifest] = await Promise.all([repo.getSchoolIndex(), repo.getCollegeIndex(), repo.getMeta(), readStatewideManifest()]);
  const roadKm = manifest ? Object.entries(manifest.references.contexts).reduce((s, [, c]) => s + c.km, 0) : null;
  return {
    schools: index.schools.length,
    colleges: colleges?.schools.length ?? 0,
    crashes: meta.quality.crashesClean,
    window: meta.window,
    windowLabel: `${formatDate(meta.window.start)} – ${formatDate(meta.window.end)}`,
    roadKm,
    transitFeed: manifest?.transit.feedDate ?? null,
    processed: formatTimestampDate(meta.generatedAt),
  };
}
