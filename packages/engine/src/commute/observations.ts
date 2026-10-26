/**
 * Expiring one-tap parking availability reports.
 *
 * Reports are observations, not counts: "Opening reported · 2m ago" or
 * "Reported full · 4m ago". Weights decay with age; the weights are a display
 * heuristic, not calibrated probabilities. Reports never change legality.
 */

export type AvailabilityKind = "opening" | "full";
export type ObservationKind = AvailabilityKind | "meter_active";

export interface Observation {
  id: string;
  placeId: string;
  kind: ObservationKind;
  /** Anonymous reporter key (never shown). */
  reporter: string;
  at: number;
  /** Reporting quality weight; 1 until validated accuracy says otherwise. */
  quality?: number;
  /** "located" when a consented location check passed, "manual" otherwise, "held" when quarantined for review. */
  verification?: "located" | "manual" | "held";
}

export interface ObservationConfig {
  ttlMin: Record<AvailabilityKind, number>;
  halfLifeMin: Record<AvailabilityKind, number>;
  /** Share of total weight the leading category needs, else "conflicting". */
  agreement: number;
}

export const OBSERVATION_DEFAULTS: ObservationConfig = {
  ttlMin: { opening: 3, full: 10 },
  halfLifeMin: { opening: 1, full: 4 },
  agreement: 0.7,
};

export interface AvailabilitySummary {
  state: "opening" | "full" | "conflicting" | "none";
  /** Independent reporters behind the shown state (or all live reporters when conflicting). */
  reports: number;
  /** Newest live report in the shown state. */
  latestAt: number | null;
  /** When the shown state stops being live, absent new reports. */
  expiresAt: number | null;
}

/** Live availability for one place at `now`. Meter reports and held reports are ignored (they go to review). */
export function summarizeAvailability(obs: Observation[], placeId: string, now: number, cfg: ObservationConfig = OBSERVATION_DEFAULTS): AvailabilitySummary {
  const latest = new Map<string, Observation>();
  for (const o of obs) {
    if (o.placeId !== placeId || (o.kind !== "opening" && o.kind !== "full") || o.verification === "held") continue;
    const age = now - o.at;
    if (age < 0 || age > cfg.ttlMin[o.kind] * 60_000) continue;
    const prev = latest.get(o.reporter);
    if (!prev || o.at > prev.at) latest.set(o.reporter, o);
  }
  const live = [...latest.values()];
  if (!live.length) return { state: "none", reports: 0, latestAt: null, expiresAt: null };

  const weight = { opening: 0, full: 0 };
  for (const o of live) {
    const kind = o.kind as AvailabilityKind;
    const ageMin = (now - o.at) / 60_000;
    weight[kind] += (o.quality ?? 1) * Math.pow(2, -ageMin / cfg.halfLifeMin[kind]);
  }
  const total = weight.opening + weight.full;
  const lead: AvailabilityKind = weight.opening >= weight.full ? "opening" : "full";
  if (total <= 0 || weight[lead] / total < cfg.agreement) {
    return { state: "conflicting", reports: live.length, latestAt: Math.max(...live.map((o) => o.at)), expiresAt: Math.max(...live.map((o) => o.at + cfg.ttlMin[o.kind as AvailabilityKind] * 60_000)) };
  }
  const shown = live.filter((o) => o.kind === lead);
  const latestAt = Math.max(...shown.map((o) => o.at));
  return { state: lead, reports: shown.length, latestAt, expiresAt: latestAt + cfg.ttlMin[lead] * 60_000 };
}

/** "2m ago" / "now" style age. */
export function ageLabel(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export function availabilityLabel(sum: AvailabilitySummary, now: number): string {
  if (sum.state === "none" || sum.latestAt === null) return "No recent reports";
  if (sum.state === "conflicting") return "Conflicting reports";
  const age = ageLabel(sum.latestAt, now);
  const who = sum.reports > 1 ? ` · ${sum.reports} reports` : "";
  return `${sum.state === "opening" ? "Opening reported" : "Reported full"} · ${age}${who}`;
}

export interface RateLimitState {
  /** Recent submission times for this reporter. */
  times: number[];
}

/** Simple sliding-window limit: at most `max` reports per `windowMin` per reporter, and one per place per minute. */
export function allowSubmission(
  recent: Observation[],
  reporter: string,
  placeId: string,
  now: number,
  limits: { max: number; windowMin: number } = { max: 6, windowMin: 10 },
): { ok: true } | { ok: false; reason: string } {
  const mine = recent.filter((o) => o.reporter === reporter && now - o.at < limits.windowMin * 60_000);
  if (mine.length >= limits.max) return { ok: false, reason: "Too many reports. Try again in a few minutes." };
  if (mine.some((o) => o.placeId === placeId && now - o.at < 60_000)) return { ok: false, reason: "You just reported this place." };
  return { ok: true };
}

/** Bursts from many new reporters at one place in a short time are held back for review. */
export function isSuspiciousBurst(recent: Observation[], placeId: string, now: number, threshold = 8, windowMin = 2): boolean {
  const reporters = new Set(recent.filter((o) => o.placeId === placeId && now - o.at < windowMin * 60_000).map((o) => o.reporter));
  return reporters.size >= threshold;
}
