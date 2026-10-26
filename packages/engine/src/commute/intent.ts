/**
 * Reading a typed request ("Get me to Georgia Tech without driving") as a trip:
 * what to do, where to, and which preferences the words asked for. Deterministic
 * keyword rules only, so the result is predictable and is always shown back to
 * the person ("Avoid driving · Least walking") before anything is planned.
 */

import type { JourneyMode, Priority } from "./rank";

export interface TripIntent {
  action: "route" | "nearby_transit" | "parking";
  /** The place text left after the instructions are removed (may be empty: "nearest MARTA station" means near the start). */
  place: string;
  modesOff: JourneyMode[];
  modesOn: JourneyMode[];
  prefer: JourneyMode[];
  priority: Priority | null;
  maxTransfers: number | null;
  accessible: boolean;
  /** Only rail stations (e.g. "MARTA station", "train station"). */
  railOnly: boolean;
  /** Short phrases describing what was understood, in order. */
  understood: string[];
}

interface Rule {
  re: RegExp;
  apply: (i: TripIntent) => void;
}

const add = <T>(list: T[], ...items: T[]) => {
  for (const x of items) if (!list.includes(x)) list.push(x);
};

// Order matters: the more specific qualifiers come first and win over "fastest".
const RULES: Rule[] = [
  {
    re: /\b(?:without|no|not|don'?t|do not|avoid(?:ing)?|skip(?:ping)?)\s+(?:a\s+|my\s+|the\s+)?(?:car|driving|drive|driven)\b|\bcar[- ]?free\b|\bno car\b/gi,
    apply: (i) => {
      add(i.modesOff, "drive", "park_ride");
      add(i.understood, "Avoid driving");
    },
  },
  {
    re: /\b(?:without|no|avoid(?:ing)?)\s+(?:the\s+)?(?:transit|bus(?:es)?|marta|trains?|public transport(?:ation)?)\b/gi,
    apply: (i) => {
      add(i.modesOff, "transit", "park_ride");
      add(i.understood, "Avoid transit");
    },
  },
  {
    re: /\b(?:no|zero|without(?: any)?)\s+(?:transfers?|connections?|changes?)\b/gi,
    apply: (i) => {
      i.maxTransfers = 0;
      add(i.understood, "No transfers");
    },
  },
  {
    re: /\b(?:fewer|fewest|few|less|least|minimal|minimum|minimi[sz]e)\s+(?:transfers?|connections?|changes?)\b/gi,
    apply: (i) => {
      i.priority = "fewest_transfers";
      add(i.understood, "Fewer transfers");
    },
  },
  {
    re: /\b(?:minimal|minimum|less|least|little|minimi[sz]e|limited|not much|without much)\s+walking\b|\bwalk(?:ing)? less\b|\bas little walking\b/gi,
    apply: (i) => {
      i.priority ??= "least_walking";
      add(i.understood, "Least walking");
    },
  },
  {
    re: /\b(?:cheapest|cheap|cheaper|lowest[- ]cost|least expensive|inexpensive|lowest price|save money|on a budget|budget)\b/gi,
    apply: (i) => {
      i.priority ??= "cheapest";
      add(i.understood, "Lowest cost");
    },
  },
  {
    re: /\b(?:safest|safer|safe|well[- ]lit)\b/gi,
    apply: (i) => {
      i.priority ??= "safety";
      add(i.understood, "Fewer risk indicators");
    },
  },
  {
    re: /\b(?:fastest|quickest|fast|quick|soonest|asap)\b/gi,
    apply: (i) => {
      i.priority ??= "fastest";
      add(i.understood, "Fastest");
    },
  },
  {
    re: /\b(?:wheelchair|accessible|step[- ]free|stroller|no stairs)\b/gi,
    apply: (i) => {
      i.accessible = true;
      add(i.understood, "Step-free access");
    },
  },
  {
    re: /\b(?:by|on|using|take|taking)\s+(?:the\s+)?(?:marta|bus(?:es)?|trains?|transit|public transport(?:ation)?|subway)\b/gi,
    apply: (i) => {
      add(i.prefer, "transit");
      add(i.understood, "Prefer transit");
    },
  },
  {
    re: /\b(?:by|on)\s+(?:bike|bicycle)\b|\bbik(?:e|ing)\s+(?:to|there)\b/gi,
    apply: (i) => {
      add(i.modesOn, "bike");
      add(i.prefer, "bike");
      add(i.understood, "Bike");
    },
  },
  {
    re: /\b(?:on foot|walk(?:ing)? (?:to|there|route))\b/gi,
    apply: (i) => {
      add(i.prefer, "walk");
      add(i.understood, "Prefer walking");
    },
  },
];

const NEARBY_TRANSIT = /\b(?:nearest|closest|nearby|near me|close by)\b[^,.;]*?\b(?:marta|station|stations|train|trains|rail|bus stop|bus stops|stops?|transit)\b|\b(?:marta|train|rail|bus)\s+(?:stations?|stops?)\s+(?:near|close to|around)\b|\bwhere(?:'s| is) the (?:nearest|closest)\s+(?:marta|station|bus stop|stop)\b/i;
const RAIL = /\b(?:marta station|train|rail|subway|station)\b/i;
const PARKING = /\b(?:find|show|need|any|cheap|free)?\s*parking\b|\bwhere (?:can|do|should) i park\b|\bpark(?:ing)? near\b/i;

const LEADS = [
  /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:help me\s+)?(?:get|take|bring|route|navigate|direct|guide)\s+me\s+(?:to|towards?)\s+/i,
  /^(?:please\s+)?(?:help me\s+)?(?:reach|get to|go to|head to|travel to)\s+/i,
  /^(?:how (?:do|can|should) i|how to|best way to|what(?:'s| is) the [a-z ]*?way to)\s+(?:get|go|travel|reach)\s+(?:to\s+)?/i,
  /^(?:i (?:need|want|have) to|i'?m going to|i'?d like to)\s+(?:get|go|be)\s+(?:to\s+)?/i,
  /^(?:directions|route|routes|a route|trip|plan a trip|plan a route|find (?:me )?(?:a |the )?(?:route|way))\s+(?:to\s+)?/i,
  /^find (?:me )?(?:the )?[a-z ]*?(?:route|way)\s+(?:to\s+)?/i,
];

const FILLER = /\b(?:please|thanks?|thank you|route|routes|trip|journey|option|way|with|using|via|for me|me|my|a|the|an|and|that has|that is|which has|going|to get)\b/gi;

function tidy(s: string): string {
  return s
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^(?:to|from|near|at|around)\s+/i, "")
    .trim();
}

/** Remove instruction words, keeping the place name. */
function placeText(text: string, matched: RegExp[]): string {
  let s = ` ${text} `;
  for (const re of matched) s = s.replace(re, " ");
  s = s.trim();
  for (const lead of LEADS) s = s.replace(lead, "");
  // Anything after an instruction joiner ("with fewer transfers") was handled above; drop joiners and filler at the edges.
  s = s.replace(/\b(?:with|without|using|by|via|on)\s*$/i, "");
  const words = tidy(s).split(" ");
  while (words.length && new RegExp(`^${FILLER.source}$`, "i").test(words[0]!)) words.shift();
  while (words.length && new RegExp(`^${FILLER.source}$`, "i").test(words[words.length - 1]!)) words.pop();
  return tidy(words.join(" "));
}

export function parseTripIntent(input: string): TripIntent {
  const text = input.replace(/\s+/g, " ").trim().slice(0, 200);
  const intent: TripIntent = { action: "route", place: "", modesOff: [], modesOn: [], prefer: [], priority: null, maxTransfers: null, accessible: false, railOnly: false, understood: [] };
  if (!text) return intent;
  const matched: RegExp[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text)) {
      rule.apply(intent);
      matched.push(new RegExp(rule.re.source, "gi"));
    }
  }

  if (NEARBY_TRANSIT.test(text)) {
    intent.action = "nearby_transit";
    intent.railOnly = RAIL.test(text) && !/\bbus\b/i.test(text);
    intent.understood.unshift(intent.railOnly ? "Nearest rail station" : "Nearby transit");
    // "nearest MARTA station to 123 Main St" → the anchor is the address after to/near/from.
    const m = /\b(?:to|near|from|around|by)\s+(.+)$/i.exec(text.replace(/\bnear me\b/i, ""));
    intent.place = m ? placeText(m[1]!, matched) : "";
    if (/^(?:me|here|my location|i am|where i am)$/i.test(intent.place)) intent.place = "";
    return intent;
  }
  if (PARKING.test(text) && !/\bpark (?:and|&) ride\b/i.test(text)) {
    intent.action = "parking";
    intent.understood.unshift("Parking");
    const m = /\b(?:near|at|by|around|close to|for)\s+(.+)$/i.exec(text);
    const rest = m ? m[1]! : text.replace(PARKING, " ");
    intent.place = /^(?:this destination|my destination|there|here|it)$/i.test(rest.trim()) ? "" : placeText(rest, matched);
    return intent;
  }
  intent.place = placeText(text, matched);
  return intent;
}

/**
 * Common place words that a geocoder cannot resolve on their own, expanded with
 * the region the person is in. Everything else is passed through unchanged.
 */
export function expandPlaceAlias(place: string, region: "atlanta" | "athens" | null): string {
  const p = place.trim().toLowerCase();
  if (p === "downtown" || p === "downtown area" || p === "the city") return region === "athens" ? "Downtown Athens, GA" : "Downtown Atlanta, GA";
  if (p === "midtown") return "Midtown Atlanta, GA";
  if (p === "the airport" || p === "airport" || p === "atl") return "Hartsfield-Jackson Atlanta International Airport";
  if (p === "gt" || p === "georgia tech" || p === "tech") return "Georgia Institute of Technology";
  if (p === "uga" || p === "university of georgia") return "University of Georgia";
  return place.trim();
}
