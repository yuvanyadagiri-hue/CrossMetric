/**
 * Full-stay parking eligibility.
 *
 * A stay [arrive, leave) is split at every rule window, override and local
 * midnight boundary. Each piece is evaluated for this driver's permits and
 * vehicle registration. The stay is only "allowed" if every piece is, and
 * anything unpublished, expired, conflicting or unknown about the driver is
 * "unknown" — never free. Crowd reports are not inputs here.
 */

import { addDays, CAMPUS_TZ, localDate, localMinutes, localWeekday, zonedToUtc, type Weekday } from "./time";

export interface WeeklyWindow {
  days: Weekday[];
  /** Minutes after local midnight. */
  start: number;
  /** Minutes after local midnight, up to 1440. */
  end: number;
}

/** Who a rule is for. "permit" means a permit valid for this place's code. */
export type Audience = "any" | "registered" | "permit";

/** free / pay: the audience may park. unknown: an official source says something unclear for this audience. */
export type RuleAccess = "free" | "pay" | "unknown";

export type RateSpec =
  | { kind: "tiered"; tiers: { upToMin: number; price: number }[]; thenPerHour?: number; dailyMax?: number; repeatsAfterMin?: number }
  | { kind: "hourly"; perHour: number }
  | { kind: "flat"; price: number }
  | { kind: "daily"; price: number };

export interface ParkingRule {
  id: string;
  windows: WeeklyWindow[];
  audience: Audience;
  access: RuleAccess;
  /** Null for paid parking whose rate is not published. */
  rate?: RateSpec | null;
  maxStayMin?: number;
  sourceId: string;
  /** Short phrase shown with the result ("Permit only", "Pay at exit"). */
  label?: string;
  note?: string;
}

export interface ParkingOverride {
  id: string;
  start: number;
  end: number;
  effect: "closed" | "unknown";
  label: string;
  sourceId: string;
}

export interface ParkingPlaceRules {
  placeId: string;
  code: string;
  rules: ParkingRule[];
  overrides: ParkingOverride[];
  /** Local date after which the rule record must be re-verified before use. */
  reviewBy: string;
  tz?: string;
}

export interface VehicleProfile {
  /** Permit area codes the driver holds (e.g. "W23", "E23"). */
  permits: string[];
  /** Vehicle registered with campus parking (UGA): true, false, or not stated. */
  registered: boolean | null;
}

export type EligibilityStatus = "allowed" | "requires_action" | "prohibited" | "unknown";

export interface StaySegment {
  start: number;
  end: number;
  status: EligibilityStatus;
  ruleId: string | null;
  reason: string;
}

export interface StayEvaluation {
  status: EligibilityStatus;
  /** Total for the stay in USD; null when any part is unknown or not allowed. */
  price: number | null;
  segments: StaySegment[];
  /** The first reason that is not "allowed" (or the allowed reason). */
  reason: string;
  /** End of the usable run that starts at arrival (null if unusable at arrival). */
  usableUntil: number | null;
  /** First moment the status or governing rule changes after arrival. */
  nextChange: { at: number; status: EligibilityStatus; reason: string } | null;
  sourceIds: string[];
}

const RANK: Record<EligibilityStatus, number> = { allowed: 0, requires_action: 1, unknown: 2, prohibited: 3 };

function worst(a: EligibilityStatus, b: EligibilityStatus): EligibilityStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

function permitMatches(code: string, permits: string[]): boolean {
  const c = code.toUpperCase();
  return permits.some((p) => p.trim().toUpperCase() === c);
}

function audienceMatch(rule: ParkingRule, code: string, v: VehicleProfile): boolean | null {
  if (rule.audience === "any") return true;
  if (rule.audience === "permit") return permitMatches(code, v.permits);
  return v.registered;
}

function covers(w: WeeklyWindow, weekday: Weekday, minute: number): boolean {
  return w.days.includes(weekday) && minute >= w.start && minute < w.end;
}

function boundaries(place: ParkingPlaceRules, a: number, b: number, tz: string): number[] {
  const set = new Set<number>([a, b]);
  let date = addDays(localDate(a, tz), -1);
  const last = addDays(localDate(b, tz), 1);
  for (let guard = 0; guard < 400; guard++) {
    set.add(zonedToUtc(date, 0, tz));
    for (const r of place.rules) {
      for (const w of r.windows) {
        set.add(zonedToUtc(date, w.start, tz));
        if (w.end < 1440) set.add(zonedToUtc(date, w.end, tz));
      }
    }
    if (date === last) break;
    date = addDays(date, 1);
  }
  for (const o of place.overrides) {
    set.add(o.start);
    set.add(o.end);
  }
  return [...set].filter((t) => t >= a && t <= b).sort((x, y) => x - y);
}

function evaluatePiece(place: ParkingPlaceRules, v: VehicleProfile, start: number, end: number, tz: string): StaySegment {
  const mid = start + (end - start) / 2;
  for (const o of place.overrides) {
    if (o.start <= mid && mid < o.end) {
      return { start, end, status: o.effect === "closed" ? "prohibited" : "unknown", ruleId: o.id, reason: o.effect === "closed" ? `${o.label} closure` : `${o.label} · rules unconfirmed` };
    }
  }
  const weekday = localWeekday(mid, tz);
  const minute = localMinutes(mid, tz);
  const active = place.rules.filter((r) => r.windows.some((w) => covers(w, weekday, minute)));
  if (!active.length) return { start, end, status: "unknown", ruleId: null, reason: "No published rule for this time" };

  const matched = active.filter((r) => audienceMatch(r, place.code, v) === true);
  const pick = (access: RuleAccess) => matched.find((r) => r.access === access);
  const free = pick("free");
  if (free) return { start, end, status: "allowed", ruleId: free.id, reason: free.label ?? (free.audience === "permit" ? "Your permit" : "No charge") };
  const pay = pick("pay");
  if (pay) return { start, end, status: "requires_action", ruleId: pay.id, reason: pay.label ?? "Payment required" };
  const unclear = pick("unknown");
  if (unclear) return { start, end, status: "unknown", ruleId: unclear.id, reason: unclear.note ?? "Official rules are unclear" };

  if (active.some((r) => audienceMatch(r, place.code, v) === null)) {
    return { start, end, status: "unknown", ruleId: null, reason: "Vehicle registration not set" };
  }
  const restrictive = active.find((r) => r.audience === "permit") ?? active[0]!;
  const reason = restrictive.audience === "permit" ? "Permit required" : restrictive.audience === "registered" ? "Registered vehicles only" : "Not available";
  return { start, end, status: "prohibited", ruleId: restrictive.id, reason };
}

/** Apply maximum-stay limits: time past the limit under one rule becomes prohibited. */
function applyMaxStay(place: ParkingPlaceRules, segs: StaySegment[]): StaySegment[] {
  const out: StaySegment[] = [];
  let runRule: string | null = null;
  let runStart = 0;
  for (const s of segs) {
    const rule = s.ruleId ? place.rules.find((r) => r.id === s.ruleId) : undefined;
    if (s.ruleId !== runRule) {
      runRule = s.ruleId;
      runStart = s.start;
    }
    if (rule?.maxStayMin && (s.status === "allowed" || s.status === "requires_action")) {
      const limitAt = runStart + rule.maxStayMin * 60_000;
      const label = rule.maxStayMin % 60 === 0 ? `${rule.maxStayMin / 60}h limit` : `${rule.maxStayMin} min limit`;
      if (limitAt <= s.start) {
        out.push({ ...s, status: "prohibited", reason: label });
        continue;
      }
      if (limitAt < s.end) {
        out.push({ ...s, end: limitAt });
        out.push({ ...s, start: limitAt, status: "prohibited", reason: label });
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

export function tieredPrice(rate: Extract<RateSpec, { kind: "tiered" }>, minutes: number): number {
  const once = (m: number): number => {
    if (m <= 0) return 0;
    for (const t of rate.tiers) if (m <= t.upToMin) return t.price;
    const last = rate.tiers[rate.tiers.length - 1]!;
    let p = last.price;
    if (rate.thenPerHour) p += Math.ceil((m - last.upToMin) / 60) * rate.thenPerHour;
    return rate.dailyMax !== undefined ? Math.min(p, rate.dailyMax) : p;
  };
  const cycle = rate.repeatsAfterMin;
  if (!cycle || minutes <= cycle) {
    const p = once(minutes);
    return rate.dailyMax !== undefined ? Math.min(p, rate.dailyMax) : p;
  }
  const full = Math.floor(minutes / cycle);
  const rest = minutes - full * cycle;
  return full * once(cycle) + once(rest);
}

function runPrice(rate: RateSpec, start: number, end: number, tz: string): number {
  const minutes = (end - start) / 60_000;
  switch (rate.kind) {
    case "tiered":
      return tieredPrice(rate, minutes);
    case "hourly":
      return Math.ceil(((rate.perHour * minutes) / 60) * 100) / 100;
    case "flat":
      return rate.price;
    case "daily": {
      let days = 0;
      let d = localDate(start, tz);
      const last = localDate(end - 1, tz);
      for (let i = 0; i < 400; i++) {
        days++;
        if (d === last) break;
        d = addDays(d, 1);
      }
      return rate.price * days;
    }
  }
}

function stayPrice(place: ParkingPlaceRules, segs: StaySegment[], tz: string): number | null {
  let total = 0;
  let i = 0;
  while (i < segs.length) {
    const s = segs[i]!;
    if (s.status === "allowed") {
      i++;
      continue;
    }
    if (s.status !== "requires_action") return null;
    let j = i;
    while (j + 1 < segs.length && segs[j + 1]!.ruleId === s.ruleId && segs[j + 1]!.status === "requires_action" && segs[j + 1]!.start === segs[j]!.end) j++;
    const rule = place.rules.find((r) => r.id === s.ruleId);
    if (!rule?.rate) return null;
    total += runPrice(rule.rate, s.start, segs[j]!.end, tz);
    i = j + 1;
  }
  return Math.round(total * 100) / 100;
}

function merge(segs: StaySegment[]): StaySegment[] {
  const out: StaySegment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && prev.status === s.status && prev.ruleId === s.ruleId && prev.reason === s.reason && prev.end === s.start) prev.end = s.end;
    else out.push({ ...s });
  }
  return out;
}

/** Evaluate a planned stay from `arrive` to `leave` (epoch ms) as of `now`. */
export function evaluateStay(place: ParkingPlaceRules, vehicle: VehicleProfile, arrive: number, leave: number, now: number = arrive): StayEvaluation {
  const tz = place.tz ?? CAMPUS_TZ;
  const sources = [...new Set(place.rules.map((r) => r.sourceId).concat(place.overrides.map((o) => o.sourceId)))];
  if (!(leave > arrive)) throw new Error("Stay must end after it starts");
  if (localDate(now, tz) > place.reviewBy) {
    const seg: StaySegment = { start: arrive, end: leave, status: "unknown", ruleId: null, reason: "Rules need re-checking" };
    return { status: "unknown", price: null, segments: [seg], reason: seg.reason, usableUntil: null, nextChange: null, sourceIds: sources };
  }
  const cuts = boundaries(place, arrive, leave, tz);
  const pieces: StaySegment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    if (cuts[i + 1]! > cuts[i]!) pieces.push(evaluatePiece(place, vehicle, cuts[i]!, cuts[i + 1]!, tz));
  }
  const segments = merge(applyMaxStay(place, merge(pieces)));
  let status: EligibilityStatus = "allowed";
  for (const s of segments) status = worst(status, s.status);
  const first = segments[0]!;
  const reason = segments.find((s) => s.status !== "allowed" && s.status !== "requires_action")?.reason ?? first.reason;
  let usableUntil: number | null = null;
  if (first.status === "allowed" || first.status === "requires_action") {
    usableUntil = first.end;
    for (const s of segments.slice(1)) {
      if (s.status === "allowed" || s.status === "requires_action") usableUntil = s.end;
      else break;
    }
  }
  const change = segments.find((s, i) => i > 0 && (s.status !== first.status || s.ruleId !== first.ruleId));
  return {
    status,
    price: status === "allowed" || status === "requires_action" ? stayPrice(place, segments, tz) : null,
    segments,
    reason,
    usableUntil,
    nextChange: change ? { at: change.start, status: change.status, reason: change.reason } : null,
    sourceIds: sources,
  };
}

/**
 * Status right now without a planned departure: the current piece and when it next changes
 * (looking ahead `lookaheadMin`). Never a full-stay claim.
 */
export function evaluateNow(place: ParkingPlaceRules, vehicle: VehicleProfile, at: number, lookaheadMin = 720): StayEvaluation {
  const full = evaluateStay(place, vehicle, at, at + lookaheadMin * 60_000, at);
  const first = full.segments[0]!;
  return { ...full, status: first.status, price: null, reason: first.reason };
}
