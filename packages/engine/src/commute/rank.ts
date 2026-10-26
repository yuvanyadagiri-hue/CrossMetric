/**
 * Comparing journeys: hard constraints decide which options are eligible; the
 * person's priority orders what is left. Every label is a plain comparison of
 * measured values (minutes, metres, dollars, transfers, CrossScore), and is shown
 * only when an option is genuinely different from the fastest one. Nothing here
 * invents a value: an unknown cost or distance stays unknown and is never
 * treated as zero.
 */

export type JourneyMode = "walk" | "bike" | "transit" | "drive" | "park_ride";
export const JOURNEY_MODES: JourneyMode[] = ["walk", "bike", "transit", "drive", "park_ride"];

export type Priority = "balanced" | "fastest" | "cheapest" | "least_walking" | "fewest_transfers" | "safety";

export interface TravelPreferences {
  /** Hard: which kinds of journey may be offered at all. Turning off driving also removes park & ride. */
  modes: Record<JourneyMode, boolean>;
  /** Hard: the most walking accepted in one journey, minutes (null: no limit). */
  maxWalkMin: number | null;
  /** Hard: the most transfers accepted (null: no limit). */
  maxTransfers: number | null;
  /** Hard: only journeys whose step-free access is verified (or does not apply). */
  accessible: boolean;
  /** Soft: what "Best match" optimises among reasonably quick options. */
  priority: Priority;
  /** Soft: among reasonably quick options, these kinds come first. */
  prefer: JourneyMode[];
}

export const DEFAULT_TRAVEL_PREFERENCES: TravelPreferences = {
  modes: { walk: true, bike: false, transit: true, drive: true, park_ride: true },
  maxWalkMin: null,
  maxTransfers: null,
  accessible: false,
  priority: "balanced",
  prefer: [],
};

export type TimingMode = "now" | "depart" | "arrive";

export interface RankOption {
  id: string;
  kind: JourneyMode;
  /** Everything this option needs (park & ride needs drive and transit). */
  requires: JourneyMode[];
  /** Planned departure from the start (epoch ms). */
  leaveAt: number;
  /** Planned arrival at the destination (epoch ms). */
  arriveAt: number;
  /** Door-to-door minutes, including waits. */
  durationMin: number;
  /** Total distance travelled in metres; null when not measured. */
  distanceM: number | null;
  walkMin: number;
  waitMin: number;
  transfers: number;
  /** Cash cost for the journey; null when any part of it is unknown. */
  costUsd: number | null;
  /** CrossScore of the street legs, comparable only with options of the same `mode`. */
  safety: { score: number; mode: "walk" | "bike" | "drive" } | null;
  /** Step-free access: verified from published data, not verified, or not relevant (driving). */
  access: "verified" | "unverified" | "not_applicable";
  /** Options with the same signature are the same journey in practice. */
  signature: string;
}

export interface Exclusion {
  id: string;
  reasons: string[];
}

const MODE_WORD: Record<JourneyMode, string> = { walk: "walking", bike: "biking", transit: "transit", drive: "driving", park_ride: "park & ride" };

/** Apply the hard constraints. Every excluded option says why. */
export function applyConstraints<T extends RankOption>(options: T[], prefs: TravelPreferences): { eligible: T[]; excluded: Exclusion[] } {
  const eligible: T[] = [];
  const excluded: Exclusion[] = [];
  for (const o of options) {
    const reasons: string[] = [];
    const off = o.requires.filter((m) => !prefs.modes[m]);
    if (off.length) reasons.push(`Uses ${off.map((m) => MODE_WORD[m]).join(" and ")}, which you turned off`);
    if (prefs.maxWalkMin !== null && o.walkMin > prefs.maxWalkMin + 0.5) reasons.push(`${Math.round(o.walkMin)} min of walking (your limit is ${prefs.maxWalkMin})`);
    if (prefs.maxTransfers !== null && o.transfers > prefs.maxTransfers) reasons.push(`${o.transfers} ${o.transfers === 1 ? "transfer" : "transfers"} (your limit is ${prefs.maxTransfers})`);
    if (prefs.accessible && o.access === "unverified") reasons.push("Step-free access is not verified in the published data");
    if (reasons.length) excluded.push({ id: o.id, reasons });
    else eligible.push(o);
  }
  return { eligible, excluded };
}

export type RoleId = "best" | "fastest" | "leaveLatest" | "shortest" | "cheapest" | "lessWalking" | "fewestTransfers" | "saferStreets";

export const ROLE_LABEL: Record<RoleId, string> = {
  best: "Best match",
  fastest: "Fastest",
  leaveLatest: "Leave latest",
  shortest: "Shortest",
  cheapest: "Cheapest",
  lessWalking: "Less walking",
  fewestTransfers: "Fewer transfers",
  saferStreets: "Fewer risk indicators",
};

export interface Ranking<T extends RankOption> {
  /** Eligible options, best match first, then by travel time. */
  ordered: T[];
  roles: Map<string, RoleId[]>;
  /** One sentence per option, from its own numbers compared with the fastest. */
  explanations: Map<string, string>;
  /** Trade-offs worth saying out loud (e.g. the best match is slower than the fastest). */
  tradeoffs: string[];
  bestId: string | null;
  fastestId: string | null;
  /** How much slower than the fastest an option may be and still be the best match. */
  toleranceMin: number;
}

/** Minimum differences before an alternative earns its own label. */
export const LABEL_THRESHOLDS = {
  /** Shorter by at least this share and 200 m. */
  shorterShare: 0.05,
  shorterMinM: 200,
  /** Cheaper by more than a cent. */
  cheaperUsd: 0.01,
  lessWalkingMin: 3,
  saferPoints: 5,
} as const;

/** Best match may be at most max(10 min, 25%) slower than the fastest. Stated in every explanation that relies on it. */
export function toleranceFor(fastestMin: number): number {
  return Math.max(10, Math.round(fastestMin * 0.25));
}

function byTime(a: RankOption, b: RankOption): number {
  if (Math.abs(a.durationMin - b.durationMin) > 1) return a.durationMin - b.durationMin;
  if (a.transfers !== b.transfers) return a.transfers - b.transfers;
  if (Math.abs(a.walkMin - b.walkMin) > 1) return a.walkMin - b.walkMin;
  return (a.costUsd ?? Infinity) - (b.costUsd ?? Infinity) || a.durationMin - b.durationMin;
}

function byLeaveLatest(a: RankOption, b: RankOption): number {
  if (Math.abs(a.leaveAt - b.leaveAt) > 60_000) return b.leaveAt - a.leaveAt;
  return byTime(a, b);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd = (v: number) => (v === 0 ? "$0" : Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

/** Lowest cost is claimed only when no option with an unknown cost could be cheaper. */
function cheapestOf<T extends RankOption>(options: T[]): T | null {
  const known = options.filter((o) => o.costUsd !== null).sort((a, b) => a.costUsd! - b.costUsd! || byTime(a, b));
  const best = known[0];
  if (!best) return null;
  const unknown = options.some((o) => o.costUsd === null);
  return unknown && best.costUsd! > 0 ? null : best;
}

/**
 * Rank eligible options and decide which labels each one has earned.
 * `timing` changes only how "Best match" reads for arrive-by plans (leaving latest matters most).
 */
export function rankOptions<T extends RankOption>(eligible: T[], prefs: TravelPreferences, timing: TimingMode): Ranking<T> {
  const roles = new Map<string, RoleId[]>();
  const explanations = new Map<string, string>();
  const tradeoffs: string[] = [];
  const give = (o: T | null | undefined, r: RoleId) => {
    if (!o) return;
    const list = roles.get(o.id) ?? [];
    if (!list.includes(r)) list.push(r);
    roles.set(o.id, list);
  };
  if (!eligible.length) return { ordered: [], roles, explanations, tradeoffs, bestId: null, fastestId: null, toleranceMin: 0 };

  const timeOrder = [...eligible].sort(byTime);
  const fastest = timeOrder[0]!;
  const tolerance = toleranceFor(fastest.durationMin);
  const quick = timeOrder.filter((o) => o.durationMin <= fastest.durationMin + tolerance);
  give(fastest, "fastest");

  // Arrive-by: the option that lets you leave latest, when that is not the fastest.
  const latest = timing === "arrive" ? [...eligible].sort(byLeaveLatest)[0]! : null;
  if (latest && latest.signature !== fastest.signature && latest.leaveAt - fastest.leaveAt >= 60_000) give(latest, "leaveLatest");

  const withDistance = eligible.filter((o) => o.distanceM !== null).sort((a, b) => a.distanceM! - b.distanceM! || byTime(a, b));
  const shortest = withDistance[0];
  if (shortest && shortest.signature !== fastest.signature && fastest.distanceM !== null) {
    const saved = fastest.distanceM - shortest.distanceM!;
    if (saved >= LABEL_THRESHOLDS.shorterMinM && saved >= fastest.distanceM * LABEL_THRESHOLDS.shorterShare) give(shortest, "shortest");
  }

  const cheapest = cheapestOf(eligible);
  if (cheapest && cheapest.signature !== fastest.signature && (fastest.costUsd === null || cheapest.costUsd! < fastest.costUsd - LABEL_THRESHOLDS.cheaperUsd)) give(cheapest, "cheapest");

  const leastWalk = [...eligible].sort((a, b) => a.walkMin - b.walkMin || byTime(a, b))[0]!;
  if (leastWalk.signature !== fastest.signature && leastWalk.walkMin <= fastest.walkMin - LABEL_THRESHOLDS.lessWalkingMin) give(leastWalk, "lessWalking");

  const fewest = [...eligible].sort((a, b) => a.transfers - b.transfers || byTime(a, b))[0]!;
  if (fewest.signature !== fastest.signature && fewest.transfers < fastest.transfers) give(fewest, "fewestTransfers");

  // CrossScores are comparable only within one mode (walking, biking or driving).
  const safer = saferAlternative(eligible);
  if (safer) give(safer.option, "saferStreets");

  // Best match: the person's priority, among options no more than `tolerance` slower than the fastest.
  const preferred = (o: RankOption) => (prefs.prefer.includes(o.kind) ? 0 : 1);
  const pool = prefs.prefer.length && quick.some((o) => prefs.prefer.includes(o.kind)) ? quick.filter((o) => preferred(o) === 0) : quick;
  let best: T;
  let why: string;
  const slack = `options at most ${tolerance} min slower than the fastest`;
  switch (prefs.priority) {
    case "cheapest": {
      const c = cheapestOf(pool);
      best = c ?? pool[0]!;
      why = c ? `Lowest cost among ${slack}` : "Costs are not known for every option, so the quickest is shown";
      break;
    }
    case "least_walking":
      best = [...pool].sort((a, b) => a.walkMin - b.walkMin || byTime(a, b))[0]!;
      why = `Least walking among ${slack}`;
      break;
    case "fewest_transfers":
      best = [...pool].sort((a, b) => a.transfers - b.transfers || byTime(a, b))[0]!;
      why = `Fewest transfers among ${slack}`;
      break;
    case "safety": {
      const s = saferAlternative(pool);
      best = s?.option ?? pool[0]!;
      why = s ? `Fewer crash risk indicators than the quicker ${MODE_WORD[s.mode]} route, among ${slack}` : "No comparable safety information, so the quickest is shown";
      break;
    }
    case "fastest":
      best = pool[0]!;
      why = "Quickest door to door";
      break;
    default:
      if (timing === "arrive") {
        best = [...pool].sort(byLeaveLatest)[0]!;
        why = "Leaves latest and still arrives on time";
      } else {
        best = pool[0]!;
        why = pool[0] === fastest ? "Quickest door to door" : "Quickest of the kinds you prefer";
      }
  }
  if (prefs.prefer.length && pool !== quick) why += ` (you prefer ${prefs.prefer.map((m) => MODE_WORD[m]).join(" or ")})`;
  give(best, "best");

  for (const o of eligible) explanations.set(o.id, explain(o, fastest, o === best ? why : null));
  if (best !== fastest) {
    const extra = Math.round(best.durationMin - fastest.durationMin);
    const parts: string[] = [];
    if (extra > 0) parts.push(`takes ${extra} min longer`);
    if (best.costUsd !== null && fastest.costUsd !== null && fastest.costUsd - best.costUsd > LABEL_THRESHOLDS.cheaperUsd) parts.push(`saves ${usd(fastest.costUsd - best.costUsd)}`);
    if (fastest.walkMin - best.walkMin >= LABEL_THRESHOLDS.lessWalkingMin) parts.push(`walks ${Math.round(fastest.walkMin - best.walkMin)} min less`);
    if (best.transfers < fastest.transfers) parts.push(`has ${plural(fastest.transfers - best.transfers, "fewer transfer", "fewer transfers")}`);
    if (parts.length) tradeoffs.push(`Your best match ${parts.join(", ")} than the fastest option.`);
  }

  const ordered = [best, ...timeOrder.filter((o) => o !== best)];
  return { ordered, roles, explanations, tradeoffs, bestId: best.id, fastestId: fastest.id, toleranceMin: tolerance };
}

/** The highest CrossScore within one mode, when it beats that mode's quickest option by a clear margin. */
function saferAlternative<T extends RankOption>(options: T[]): { option: T; mode: "walk" | "bike" | "drive" } | null {
  let pick: { option: T; mode: "walk" | "bike" | "drive"; gain: number } | null = null;
  for (const mode of ["walk", "bike", "drive"] as const) {
    const group = options.filter((o) => o.safety?.mode === mode && o.kind === mode);
    if (group.length < 2) continue;
    const quickest = [...group].sort(byTime)[0]!;
    const top = [...group].sort((a, b) => b.safety!.score - a.safety!.score || byTime(a, b))[0]!;
    const gain = top.safety!.score - quickest.safety!.score;
    if (top !== quickest && gain >= LABEL_THRESHOLDS.saferPoints && (!pick || gain > pick.gain)) pick = { option: top, mode, gain };
  }
  return pick ? { option: pick.option, mode: pick.mode } : null;
}

/** One sentence built only from this option's numbers. */
export function explain(o: RankOption, fastest: RankOption, lead: string | null): string {
  const parts: string[] = [];
  if (lead) parts.push(lead);
  else if (o === fastest) parts.push("Quickest door to door");
  else {
    const extra = Math.round(o.durationMin - fastest.durationMin);
    parts.push(extra > 0 ? `${extra} min slower than the fastest` : "About as quick as the fastest");
  }
  if (o.kind === "transit" || o.kind === "park_ride") parts.push(o.transfers === 0 ? "no transfers" : plural(o.transfers, "transfer"));
  if (o.walkMin >= 1 && o.kind !== "walk") parts.push(`${Math.round(o.walkMin)} min walking`);
  if (o !== fastest && fastest.walkMin - o.walkMin >= LABEL_THRESHOLDS.lessWalkingMin) parts.push(`${Math.round(fastest.walkMin - o.walkMin)} min less walking`);
  if (o.costUsd !== null && fastest.costUsd !== null && o !== fastest && fastest.costUsd - o.costUsd > LABEL_THRESHOLDS.cheaperUsd) parts.push(`${usd(fastest.costUsd - o.costUsd)} cheaper`);
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
