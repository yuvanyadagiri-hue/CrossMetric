/**
 * Internal evidence-to-backlog pipeline (the "research agent").
 *
 * Deterministic and auditable: minimize → deduplicate → extract (a small,
 * versioned keyword classifier with strict output validation) → cluster →
 * prioritize → draft. Collected text is data only: nothing in it is ever
 * executed or followed, and drafts can only be reviewed by a person.
 * Thresholds are configurable product choices, not calibrated values.
 */

export const EXTRACTOR_VERSION = "kw-2026.10.1";

export type Campus = "GT" | "UGA" | "BOTH" | "UNKNOWN";

export type Category =
  | "parking_full"
  | "parking_rules"
  | "event_closure"
  | "transit_reliability"
  | "transit_pickup"
  | "transit_coverage"
  | "night_travel"
  | "accessibility"
  | "app_feedback"
  | "other";

export interface EvidenceRecord {
  id: string;
  sourceId: string;
  campus: Campus;
  /** Minimized text (never raw). */
  text: string;
  /** When the source says it was posted or submitted (ISO). */
  postedAt: string;
  /** When Crossmetric received or fetched it (ISO). Never used in place of postedAt. */
  fetchedAt: string;
  /** Stable reference to the source item (no personal identifiers). */
  sourceRef: string;
}

export interface Extraction {
  recordId: string;
  campus: Campus;
  category: Category;
  places: string[];
  stance: "firsthand" | "question" | "hearsay" | "unknown";
  consequence: "late" | "missed" | "cost" | "citation" | "safety_concern" | "confusion" | "unknown";
  /** Exact substring of the record text that supports the category. */
  span: string;
  extractor: string;
}

// ---------------------------------------------------------------------------
// Minimization
// ---------------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const HANDLE = /(^|\s)[@u]\/?[A-Za-z0-9_-]{3,}/g;
const URL_QUERY = /(https?:\/\/[^\s?#]+)[?#][^\s]*/g;
const STREET_ADDRESS = /\b\d{2,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Court|Way|Pl)\b\.?/g;
const GT_GTID = /\b9\d{8}\b/g;

/** Strip contact details, handles, tracking parameters, home addresses and student IDs. */
export function minimizeText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(URL_QUERY, "$1")
    .replace(PHONE, "[phone]")
    .replace(GT_GTID, "[id]")
    .replace(STREET_ADDRESS, "[address]")
    .replace(HANDLE, "$1[user]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a 32-bit hash of the normalized text. */
export function textHash(text: string): string {
  const s = normalizeForHash(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const STOP = new Set("the a an and or but to of in on at for is it was i my me we our you your this that with be are have has had not no so just get got can could would there their they them at as by from if when then than too very".split(" "));

export function tokens(text: string): Set<string> {
  return new Set(
    normalizeForHash(text)
      .split(" ")
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DedupeResult {
  kept: EvidenceRecord[];
  exactDuplicates: { id: string; of: string }[];
  nearDuplicates: { id: string; of: string; similarity: number }[];
}

/**
 * Exact duplicates by normalized-text hash, then near-duplicates (crossposts,
 * repeated comments) within the same campus and a 7-day window.
 */
export function dedupe(records: EvidenceRecord[], nearThreshold = 0.8): DedupeResult {
  const byHash = new Map<string, string>();
  const kept: EvidenceRecord[] = [];
  const exactDuplicates: DedupeResult["exactDuplicates"] = [];
  const nearDuplicates: DedupeResult["nearDuplicates"] = [];
  const sorted = [...records].sort((a, b) => a.postedAt.localeCompare(b.postedAt) || a.id.localeCompare(b.id));
  const keptTokens: { r: EvidenceRecord; t: Set<string> }[] = [];
  for (const r of sorted) {
    const h = textHash(r.text);
    const prior = byHash.get(h);
    if (prior) {
      exactDuplicates.push({ id: r.id, of: prior });
      continue;
    }
    byHash.set(h, r.id);
    const t = tokens(r.text);
    const near = keptTokens.find((k) => k.r.campus === r.campus && Math.abs(Date.parse(k.r.postedAt) - Date.parse(r.postedAt)) < 7 * 86_400_000 && jaccard(k.t, t) >= nearThreshold);
    if (near) {
      nearDuplicates.push({ id: r.id, of: near.r.id, similarity: Math.round(jaccard(near.t, t) * 100) / 100 });
      continue;
    }
    keptTokens.push({ r, t });
    kept.push(r);
  }
  return { kept, exactDuplicates, nearDuplicates };
}

// ---------------------------------------------------------------------------
// Extraction (versioned keyword classifier with strict validation)
// ---------------------------------------------------------------------------

const RULES: { category: Category; patterns: RegExp[] }[] = [
  { category: "accessibility", patterns: [/\b(wheelchair|accessible|accessibility|ada|elevator|ramp|disab\w*|mobility)\b/i] },
  { category: "event_closure", patterns: [/\b(game ?day|football|home game|event parking|closed for (the )?(game|event)|tailgat\w*)\b/i] },
  { category: "night_travel", patterns: [/\b(stingerette|safe ?ride|ride smart|late at night|after dark|night (bus|shuttle|route)s?)\b/i] },
  { category: "transit_pickup", patterns: [/\b(pick ?up|pickup location|pickup point|stop (moved|removed|closed)|can'?t (select|find) (the )?(stop|pickup))\b/i] },
  { category: "parking_full", patterns: [/\b(deck|lot|garage)\b.*\b(full|no (spots|spaces|parking))\b/i, /\b(full|no (spots|spaces))\b.*\b(deck|lot|garage)\b/i, /\bcan'?t (get|find) parking\b/i] },
  { category: "parking_rules", patterns: [/\b(permit|ticket|citation|tow(ed)?|enforce\w*|registered vehicle|registration|park ?mobile|meter)\b/i] },
  { category: "transit_reliability", patterns: [/\b(late|never (came|showed|arrived)|skipped|no ?show|delay\w*|on time|wait(ed|ing)? \d+)\b.*\b(bus|stinger|marta|route|train|shuttle)\b/i, /\b(bus|stinger|marta|route|train|shuttle)\b.*\b(late|never (came|showed|arrived)|skipped|delay\w*|didn'?t (come|show))\b/i] },
  { category: "transit_coverage", patterns: [/\b(weekend|sunday|saturday|city bus|athens transit|acc transit|myStop|park (and|&) ride|doesn'?t (go|run) to)\b/i] },
  { category: "app_feedback", patterns: [/\b(crossmetric|this app|the app|map clutter|filter)\b/i] },
];

const GT_HINTS = /\b(gt|georgia tech|gatech|stinger(ette)?|tech square|klaus|culc|student center|marta|midtown|north ave)\b/i;
const UGA_HINTS = /\b(uga|university of georgia|athens|tate|mlc|sanford|passio|myStop|acc transit|east campus|park (and|&) ride)\b/i;
const PLACE = /\b([NSEW]\d{2}[A-Z]?|TSL|W2[23]|E81|Student Center Deck|North Deck|Tech Square Deck|Tate (Center )?Deck|North Campus Deck|South (Campus )?Deck|East (Campus )?Deck)\b/g;

export function extract(r: EvidenceRecord): Extraction {
  let category: Category = "other";
  let span = "";
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      const m = re.exec(r.text);
      if (m) {
        category = rule.category;
        span = m[0];
        break;
      }
    }
    if (span) break;
  }
  let campus: Campus = r.campus;
  if (campus === "UNKNOWN") {
    const gt = GT_HINTS.test(r.text);
    const uga = UGA_HINTS.test(r.text);
    campus = gt && uga ? "BOTH" : gt ? "GT" : uga ? "UGA" : "UNKNOWN";
  }
  const stance = /\?\s*$/.test(r.text) || /^(does|is|are|can|where|how|what|why|anyone)\b/i.test(r.text) ? "question" : /\b(i heard|someone said|apparently|rumor)\b/i.test(r.text) ? "hearsay" : /\b(i|my|me|we)\b/i.test(r.text) ? "firsthand" : "unknown";
  const consequence = /\blate\b/i.test(r.text)
    ? "late"
    : /\bmiss(ed)?\b/i.test(r.text)
      ? "missed"
      : /\b(ticket|citation|fine|towed)\b/i.test(r.text)
        ? "citation"
        : /\b(\$\d+|expensive|cost|price)\b/i.test(r.text)
          ? "cost"
          : /\b(unsafe|scared|dark|harass\w*)\b/i.test(r.text)
            ? "safety_concern"
            : /\b(confus\w*|unclear|no idea|don'?t know)\b/i.test(r.text)
              ? "confusion"
              : "unknown";
  const places = [...new Set([...r.text.matchAll(PLACE)].map((m) => m[0]))];
  return { recordId: r.id, campus, category, places, stance, consequence, span, extractor: EXTRACTOR_VERSION };
}

const CATEGORIES: Category[] = ["parking_full", "parking_rules", "event_closure", "transit_reliability", "transit_pickup", "transit_coverage", "night_travel", "accessibility", "app_feedback", "other"];

/** Strict output check: known enums, and the supporting span really occurs in the input. */
export function validateExtraction(x: Extraction, r: EvidenceRecord): string[] {
  const errors: string[] = [];
  if (x.recordId !== r.id) errors.push("recordId mismatch");
  if (!CATEGORIES.includes(x.category)) errors.push("unknown category");
  if (!["GT", "UGA", "BOTH", "UNKNOWN"].includes(x.campus)) errors.push("unknown campus");
  if (x.category !== "other" && (!x.span || !r.text.includes(x.span))) errors.push("span not found in input");
  if (x.extractor !== EXTRACTOR_VERSION) errors.push("extractor version mismatch");
  return errors;
}

// ---------------------------------------------------------------------------
// Clustering, priority and drafts
// ---------------------------------------------------------------------------

export interface Cluster {
  clusterId: string;
  campus: Campus;
  category: Category;
  recordIds: string[];
  sources: string[];
  firstObserved: string;
  lastObserved: string;
  distinctDays: number;
  places: string[];
}

/**
 * Group by campus + category, then link records whose token similarity is at least
 * `threshold` (single linkage). Singletons are kept. The threshold is a product
 * setting to calibrate on labelled pairs, not a validated value.
 */
export function cluster(records: EvidenceRecord[], extractions: Extraction[], threshold = 0.25): Cluster[] {
  const ex = new Map(extractions.map((e) => [e.recordId, e]));
  const groups = new Map<string, EvidenceRecord[]>();
  for (const r of records) {
    const e = ex.get(r.id);
    if (!e) continue;
    const key = `${e.campus}|${e.category}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: Cluster[] = [];
  for (const [key, rs] of groups) {
    const [campus, category] = key.split("|") as [Campus, Category];
    const t = rs.map((r) => tokens(r.text));
    const parent = rs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const placesI = ex.get(rs[i]!.id)!.places;
        const placesJ = ex.get(rs[j]!.id)!.places;
        const samePlace = placesI.some((p) => placesJ.includes(p));
        if (samePlace || jaccard(t[i]!, t[j]!) >= threshold) parent[find(i)] = find(j);
      }
    const comps = new Map<number, EvidenceRecord[]>();
    rs.forEach((r, i) => comps.set(find(i), [...(comps.get(find(i)) ?? []), r]));
    for (const members of comps.values()) {
      const ids = members.map((m) => m.id).sort();
      const dates = members.map((m) => m.postedAt).sort();
      out.push({
        clusterId: `${campus.toLowerCase()}-${category}-${textHash(ids[0]!)}`,
        campus,
        category,
        recordIds: ids,
        sources: [...new Set(members.map((m) => m.sourceId))].sort(),
        firstObserved: dates[0]!,
        lastObserved: dates[dates.length - 1]!,
        distinctDays: new Set(dates.map((d) => d.slice(0, 10))).size,
        places: [...new Set(members.flatMap((m) => ex.get(m.id)!.places))].sort(),
      });
    }
  }
  return out;
}

/** Provisional default severity by category until a reviewer sets one (0-1). */
export const PROVISIONAL_IMPACT: Record<Category, number> = {
  accessibility: 1,
  night_travel: 0.9,
  parking_rules: 0.75,
  event_closure: 0.7,
  transit_reliability: 0.7,
  transit_pickup: 0.65,
  parking_full: 0.6,
  transit_coverage: 0.55,
  app_feedback: 0.4,
  other: 0.3,
};

export interface PriorityInputs {
  impact: number;
  frequency: number;
  recency: number;
  confidence: number;
  campusCoverage: number;
  effort: number;
}

/** priority = 4·impact + 3·frequency + 2·recency + 3·confidence + 2·campus_coverage − 2·effort (all 0-1). */
export function priorityScore(p: PriorityInputs): number {
  return Math.round((4 * p.impact + 3 * p.frequency + 2 * p.recency + 3 * p.confidence + 2 * p.campusCoverage - 2 * p.effort) * 100) / 100;
}

export function frequencyNorm(independentThreads: number): number {
  return Math.min(1, Math.log(1 + independentThreads) / Math.log(11));
}

export function recencyNorm(lastObservedIso: string, now: number, halfLifeDays = 14): number {
  const ageDays = Math.max(0, (now - Date.parse(lastObservedIso)) / 86_400_000);
  return Math.pow(2, -ageDays / halfLifeDays);
}

export interface BacklogDraft {
  cluster_id: string;
  title: string;
  campus: Campus;
  evidence_ids: string[];
  independent_thread_count: number;
  observed_date_range: { from: string; to: string } | null;
  retrieval_limitations: string[];
  problem_summary: string;
  official_corroboration: string[];
  contradictions: string[];
  impact_estimate: null;
  proposed_user_story: string;
  acceptance_criteria: string[];
  required_data_and_permissions: string[];
  success_metric: string;
  effort_estimate: "unreviewed";
  confidence: "low" | "medium" | "high";
  status: "draft";
  requires_human_review: true;
  priority: { score: number; inputs: PriorityInputs; provisional: true };
  extractor: string;
}

const TEMPLATES: Record<Category, { title: string; story: string; criteria: string[]; data: string[]; metric: string }> = {
  parking_full: {
    title: "Students arrive at full parking with no eligible backup",
    story: "As a commuter, I want an eligible backup parking place before I commit, so a full deck doesn't make me late.",
    criteria: ["Backup place shown before arrival when the first choice has recent full reports", "Backup satisfies the full-stay rules"],
    data: ["Consented availability reports", "Verified rules for backup places"],
    metric: "Share of trips that switch to a backup and still arrive by the deadline (pilot, by campus).",
  },
  parking_rules: {
    title: "Parking eligibility is unclear (permits, registration, enforcement hours)",
    story: "As a student without a permit, I want to know where I may legally park for my whole stay.",
    criteria: ["Eligibility shown for the full intended stay", "Permit vs. registration distinguished"],
    data: ["Official enforcement pages per campus, re-verified on schedule"],
    metric: "Wrong-eligibility incidents reported in the pilot (target: zero).",
  },
  event_closure: {
    title: "Event and game-day restrictions disrupt regular parking",
    story: "As a commuter, I want event closures flagged on affected places with a replacement.",
    criteria: ["Affected places show the event notice for the right dates", "An eligible replacement is offered"],
    data: ["Official event parking announcements with dates"],
    metric: "Share of game-day trips planned without an affected place.",
  },
  transit_reliability: {
    title: "Buses run late or skip stops, making students late",
    story: "As a rider, I want an earlier leave time that accounts for unreliable service.",
    criteria: ["Planning buffer reflects the route's measured lateness once data exists", "Uncertainty shown"],
    data: ["Authorized realtime feeds", "Consented trip outcomes"],
    metric: "Predicted vs. observed arrival error on held-out pilot trips.",
  },
  transit_pickup: {
    title: "Pickup locations are hard to find or changed",
    story: "As a rider, I want the exact supported pickup pin with a recognizable label.",
    criteria: ["Pickup pins come from current official data", "Removed pickups disappear by their effective date"],
    data: ["Official pickup locations with effective dates"],
    metric: "Time to find the pickup in usability sessions.",
  },
  transit_coverage: {
    title: "City, weekend and park-and-ride service is hard to understand",
    story: "As a rider, I want campus and city buses in one itinerary that respects the service calendar.",
    criteria: ["Joined itineraries across agencies", "Weekend and break calendars applied"],
    data: ["Agency GTFS feeds and official service calendars"],
    metric: "Share of weekend trips with a valid plan in the pilot.",
  },
  night_travel: {
    title: "Night service availability and requests are unclear",
    story: "As a student traveling at night, I want to see which official services operate now and how to request them.",
    criteria: ["Operating status from effective-dated hours", "Official booking hand-off"],
    data: ["Official night service hours, holidays and pickup rules"],
    metric: "Taps to an official booking hand-off (target ≤3).",
  },
  accessibility: {
    title: "Accessible routes and entrances are not clear",
    story: "As a student with a mobility need, I want routes and entrances that work for me.",
    criteria: ["Accessible entrances marked when documented", "Routes respect mobility settings"],
    data: ["Documented accessible entrances and paths"],
    metric: "Accessibility issues found in consented usability sessions.",
  },
  app_feedback: {
    title: "App usability feedback",
    story: "As a student, I want the app to show only what I need for this trip.",
    criteria: ["Feedback reviewed and reproduced"],
    data: ["First-party feedback"],
    metric: "Task success in usability sessions.",
  },
  other: {
    title: "Uncategorized commuting issue",
    story: "Needs reviewer triage before a user story can be written.",
    criteria: ["Reviewer assigns a category"],
    data: [],
    metric: "Not defined until triaged.",
  },
};

export function draftFor(c: Cluster, records: Map<string, EvidenceRecord>, extractions: Map<string, Extraction>, now: number, corroboration: string[] = []): BacklogDraft {
  const t = TEMPLATES[c.category];
  const members = c.recordIds.map((id) => records.get(id)!).filter(Boolean);
  const firsthand = members.filter((m) => extractions.get(m.id)?.stance === "firsthand").length;
  const threads = new Set(members.map((m) => m.sourceRef)).size;
  const confidence: BacklogDraft["confidence"] = threads >= 5 && c.distinctDays >= 3 ? "high" : threads >= 2 || firsthand >= 1 ? "medium" : "low";
  const inputs: PriorityInputs = {
    impact: PROVISIONAL_IMPACT[c.category],
    frequency: frequencyNorm(threads),
    recency: recencyNorm(c.lastObserved, now),
    confidence: confidence === "high" ? 1 : confidence === "medium" ? 0.6 : 0.3,
    campusCoverage: c.campus === "BOTH" ? 1 : c.campus === "UNKNOWN" ? 0.25 : 0.5,
    effort: 0.5,
  };
  return {
    cluster_id: c.clusterId,
    title: t.title,
    campus: c.campus,
    evidence_ids: c.recordIds,
    independent_thread_count: threads,
    observed_date_range: c.firstObserved ? { from: c.firstObserved.slice(0, 10), to: c.lastObserved.slice(0, 10) } : null,
    retrieval_limitations: ["First-party feedback only; not a representative sample", "Counts are deduplicated reports, not prevalence"],
    problem_summary: `${members.length} deduplicated ${members.length === 1 ? "report" : "reports"} (${firsthand} firsthand) about ${c.category.replace(/_/g, " ")}${c.places.length ? ` at ${c.places.join(", ")}` : ""}, ${c.distinctDays} distinct ${c.distinctDays === 1 ? "day" : "days"}.`,
    official_corroboration: corroboration,
    contradictions: [],
    impact_estimate: null,
    proposed_user_story: t.story,
    acceptance_criteria: t.criteria,
    required_data_and_permissions: t.data,
    success_metric: t.metric,
    effort_estimate: "unreviewed",
    confidence,
    status: "draft",
    requires_human_review: true,
    priority: { score: priorityScore(inputs), inputs, provisional: true },
    extractor: EXTRACTOR_VERSION,
  };
}

export interface RunReport {
  startedAt: string;
  sources: { id: string; status: string; records: number; reason?: string }[];
  input: number;
  excludedOutOfWindow: number;
  excludedOverCap: number;
  exactDuplicates: number;
  nearDuplicates: number;
  invalidExtractions: number;
  clusters: number;
  drafts: number;
}

/**
 * One bounded batch: records from enabled sources inside the window, capped
 * (stratified round-robin by campus and source so one thread can't take it all).
 */
export function runBatch(
  bySource: { sourceId: string; status: string; reason?: string; records: EvidenceRecord[] }[],
  now: number,
  opts: { windowDays: number; cap: number } = { windowDays: 30, cap: 1000 },
): { report: RunReport; drafts: BacklogDraft[]; clusters: Cluster[]; extractions: Extraction[] } {
  const since = now - opts.windowDays * 86_400_000;
  let outOfWindow = 0;
  const pools = new Map<string, EvidenceRecord[]>();
  for (const s of bySource) {
    if (s.status !== "enabled") continue;
    for (const r of s.records) {
      if (Date.parse(r.postedAt) < since) {
        outOfWindow++;
        continue;
      }
      const key = `${r.campus}|${r.sourceId}`;
      pools.set(key, [...(pools.get(key) ?? []), r]);
    }
  }
  const lists = [...pools.values()].map((l) => l.sort((a, b) => b.postedAt.localeCompare(a.postedAt)));
  const selected: EvidenceRecord[] = [];
  let total = lists.reduce((s, l) => s + l.length, 0);
  for (let i = 0; selected.length < opts.cap && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length && selected.length < opts.cap) selected.push(l[i]!);
  const overCap = total - selected.length;
  total = selected.length;
  const d = dedupe(selected);
  const extractions: Extraction[] = [];
  let invalid = 0;
  for (const r of d.kept) {
    const x = extract(r);
    if (validateExtraction(x, r).length) invalid++;
    else extractions.push(x);
  }
  const valid = d.kept.filter((r) => extractions.some((x) => x.recordId === r.id));
  const clusters = cluster(valid, extractions);
  const recMap = new Map(valid.map((r) => [r.id, r]));
  const exMap = new Map(extractions.map((x) => [x.recordId, x]));
  const drafts = clusters.map((c) => draftFor(c, recMap, exMap, now)).sort((a, b) => b.priority.score - a.priority.score);
  return {
    report: {
      startedAt: new Date(now).toISOString(),
      sources: bySource.map((s) => ({ id: s.sourceId, status: s.status, records: s.records.length, reason: s.reason })),
      input: total + overCap,
      excludedOutOfWindow: outOfWindow,
      excludedOverCap: overCap,
      exactDuplicates: d.exactDuplicates.length,
      nearDuplicates: d.nearDuplicates.length,
      invalidExtractions: invalid,
      clusters: clusters.length,
      drafts: drafts.length,
    },
    drafts,
    clusters,
    extractions,
  };
}

/** After an evidence record is deleted: drop it from drafts, and drafts left without evidence. */
export function removeEvidence(drafts: BacklogDraft[], deletedIds: Set<string>): BacklogDraft[] {
  return drafts
    .map((d) => ({ ...d, evidence_ids: d.evidence_ids.filter((id) => !deletedIds.has(id)) }))
    .filter((d) => d.evidence_ids.length > 0)
    .map((d) => (d.evidence_ids.length === d.independent_thread_count ? d : { ...d, problem_summary: `${d.problem_summary} (evidence changed; re-run to update counts)` }));
}
