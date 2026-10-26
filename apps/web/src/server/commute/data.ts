import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { addDays, hhmm, zonedToUtc, type ParkingOverride, type ParkingPlaceRules, type ParkingRule, type RateSpec, type TransitNetwork, type Weekday, type WeeklyWindow } from "@crossmetric/engine/commute";
import type { Building, CampusBundle, CampusId, HelpContact, NightService, ParkingPlaceInfo, SourceRef } from "@/lib/commute-types";

/**
 * Commuter data:
 *   data/commute/<campus>.json                 hand-verified rules, services and sources (in git)
 *   data/published/commute/campus-<campus>.json  OSM buildings, entrances, parking geometry (pipeline)
 *   data/published/commute/transit-<net>.json    compiled timetables (pipeline)
 */

function publishedDir(): string {
  return path.join(process.env.CROSSMETRIC_DATA_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "published"), "commute");
}

function rulesDir(): string {
  return process.env.COMMUTE_RULES_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "commute");
}

export class CommuteDataMissing extends Error {}

async function readJson<T>(file: string): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new CommuteDataMissing(`Missing ${path.basename(file)}. Run: python -m pipeline.commute.campus && python -m pipeline.commute.transit`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Raw file shapes
// ---------------------------------------------------------------------------

type RawWindow = { days: number[]; start: string; end: string };
type RawRule = { id: string; windows: "all" | RawWindow[]; audience: ParkingRule["audience"]; access: ParkingRule["access"]; rate?: string | RateSpec | null; maxStayMin?: number; sourceId: string; label?: string; note?: string };

interface RawConfig {
  campus: CampusId;
  name: string;
  shortName: string;
  city: string;
  timezone: string;
  center: [number, number];
  bounds: [[number, number], [number, number]];
  sources: Record<string, Omit<SourceRef, "id">>;
  parking: {
    notes: string[];
    places?: { id: string; code: string; name: string; label?: string; kind: "deck" | "lot"; osm: string[]; payment?: string; rules: RawRule[] }[];
    rates?: Record<string, RateSpec>;
    lotCategories?: {
      sourceId: string;
      weekdayPermitOnly: { start: string; end: string };
      afterHours: { start: string; end: string };
      registeredAfterHours: string[];
      permitOnlyAfterHours: string[];
      anyVehicleAfterHours: string[];
      payPerHourAfterFive: string[];
      weekendEnforced: { lots: string[]; start: string; end: string };
      earlyStart: Record<string, string>;
      gates: Record<string, { open: string; close: string }>;
    };
    decks?: { code: string; name: string; osmName: string; rate: string; restrictedMornings: boolean }[];
    remoteDaily?: { lots: string[]; price: number; payment: string; sourceId: string };
    parkAndRide?: { lots: string[]; permitMonthly: number; sourceId: string };
  };
  events: { id: string; label: string; date: string; eveFrom?: string; start: string; end: string; effect: "closed" | "unknown"; places: "all" | string[]; sourceId: string }[];
  night: NightService[];
  help: HelpContact[];
  transit: {
    networks: string[];
    notIncluded: { name: string; reason: string; url: string }[];
    trackers: { agency: string; url: string }[];
    calendarOverlay: null | { agency: string; sourceId: string; publishedThrough: string; dates: { date: string; status: "modified" | "reduced" | "none"; label: string }[] };
  };
}

interface RawGeo {
  campus: CampusId;
  osmTimestamp: string;
  attribution: string;
  buildings: (Building & { osm: string })[];
  parking: { id: string; code: string; name: string; kind: "deck" | "lot"; center: [number, number]; polygons: [number, number][][][]; osm: string[] }[];
}

// ---------------------------------------------------------------------------
// Rule compilation
// ---------------------------------------------------------------------------

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const WEEKEND: Weekday[] = [0, 6];

function win(days: Weekday[], start: string, end: string): WeeklyWindow {
  return { days, start: hhmm(start), end: hhmm(end) };
}

function windowsOf(w: "all" | RawWindow[]): WeeklyWindow[] {
  if (w === "all") return [{ days: ALL_DAYS, start: 0, end: 1440 }];
  return w.map((x) => win(x.days as Weekday[], x.start, x.end));
}

/** Rules from a person's own permit (as they entered it) are not official records and do not expire. */
export const USER_PERMIT_SOURCE = "user-permit";

function compileExplicit(cfg: RawConfig, code: string, rules: RawRule[]): ParkingRule[] {
  const permit: ParkingRule = { id: `${code}-your-permit`, windows: windowsOf("all"), audience: "permit", access: "free", sourceId: USER_PERMIT_SOURCE, label: "Your permit (as entered)" };
  return [permit, ...rules.map((r) => ({
    id: r.id,
    windows: windowsOf(r.windows),
    audience: r.audience,
    access: r.access,
    rate: typeof r.rate === "string" ? (cfg.parking.rates?.[r.rate] ?? null) : (r.rate ?? null),
    maxStayMin: r.maxStayMin,
    sourceId: r.sourceId,
    label: r.label ?? (r.access === "pay" ? "Pay to park" : undefined),
    note: r.note,
  }))];
}

/** UGA: lot rules from the enforcement-hours table, deck rules from the visitor page. */
function compileUga(cfg: RawConfig, code: string, isDeck: boolean): ParkingRule[] {
  const cats = cfg.parking.lotCategories!;
  const src = cats.sourceId;
  const rules: ParkingRule[] = [];
  const dayStart = cats.earlyStart[code] ?? cats.weekdayPermitOnly.start;
  rules.push({ id: `${code}-permit-day`, windows: [win(WEEKDAYS, dayStart, cats.weekdayPermitOnly.end)], audience: "permit", access: "free", sourceId: src, label: "Your permit" });

  const gate = cats.gates[code];
  const evEnd = gate ? gate.close : cats.afterHours.end;
  const evening = [win(WEEKDAYS, cats.afterHours.start, evEnd)];
  const registered = cats.registeredAfterHours.includes(code);
  if (registered) rules.push({ id: `${code}-registered-evening`, windows: evening, audience: "registered", access: "free", sourceId: src, label: "Registered vehicles · after 5 PM" });
  else if (cats.permitOnlyAfterHours.includes(code)) rules.push({ id: `${code}-permit-evening`, windows: evening, audience: "permit", access: "free", sourceId: src, label: "Your permit" });
  else if (cats.anyVehicleAfterHours.includes(code)) rules.push({ id: `${code}-any-evening`, windows: evening, audience: "any", access: "free", sourceId: src, label: "Any vehicle · after 5 PM" });
  if (cats.payPerHourAfterFive.includes(code)) rules.push({ id: `${code}-pph-evening`, windows: evening, audience: "any", access: "pay", rate: null, sourceId: src, label: "Pay-per-hour" });

  if (cats.weekendEnforced.lots.includes(code)) {
    const w = [win(WEEKEND, cats.weekendEnforced.start, cats.weekendEnforced.end)];
    rules.push({ id: `${code}-weekend-registered`, windows: w, audience: "registered", access: "free", sourceId: src, label: "Registered vehicles" });
    rules.push({ id: `${code}-weekend-pph`, windows: w, audience: "any", access: "pay", rate: null, sourceId: src, label: "Pay-per-hour" });
  } else if (isDeck) {
    rules.push({ id: `${code}-weekend-deck`, windows: [win(WEEKEND, "00:00", "24:00")], audience: "any", access: "unknown", sourceId: src, note: "Weekend deck rules not published" });
  } else {
    rules.push({ id: `${code}-weekend-free`, windows: [win(WEEKEND, "00:00", "24:00")], audience: "any", access: "free", sourceId: src, label: "Weekend · any vehicle" });
  }

  if (isDeck) {
    const deck = cfg.parking.decks!.find((d) => d.code === code)!;
    const rate = cfg.parking.rates?.[deck.rate] ?? null;
    const visitor = deck.restrictedMornings ? [win([1, 2, 3, 4], "13:00", "17:00"), win([5], "07:00", "17:00")] : [win(WEEKDAYS, "07:00", "17:00")];
    rules.push({ id: `${code}-visitor`, windows: visitor, audience: "any", access: "pay", rate, sourceId: "uga-visitors", label: "Visitor rate · pay at exit" });
    if (registered) {
      rules.push({ id: `${code}-visitor-evening`, windows: evening, audience: "any", access: "unknown", sourceId: "uga-visitors", note: "After 5 PM: registered vehicles only; visitor rate not confirmed" });
    }
  }

  const remote = cfg.parking.remoteDaily;
  if (remote?.lots.includes(code)) {
    rules.push({ id: `${code}-daily`, windows: [win(WEEKDAYS, "07:00", "17:00")], audience: "any", access: "pay", rate: { kind: "daily", price: remote.price }, sourceId: remote.sourceId, label: `${remote.payment} · $${remote.price}/day` });
  }
  return rules;
}

function overridesFor(cfg: RawConfig, placeId: string): ParkingOverride[] {
  const out: ParkingOverride[] = [];
  for (const e of cfg.events) {
    if (e.places !== "all" && !e.places.includes(placeId)) continue;
    const start = e.eveFrom ? zonedToUtc(addDays(e.date, -1), hhmm(e.eveFrom), cfg.timezone) : zonedToUtc(e.date, hhmm(e.start), cfg.timezone);
    const end = hhmm(e.end) >= 1440 ? zonedToUtc(addDays(e.date, 1), 0, cfg.timezone) : zonedToUtc(e.date, hhmm(e.end), cfg.timezone);
    out.push({ id: e.id, start, end, effect: e.effect, label: e.label, sourceId: e.sourceId });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loaded campus
// ---------------------------------------------------------------------------

export interface CampusData {
  config: RawConfig;
  bundle: CampusBundle;
  rules: Map<string, ParkingPlaceRules>;
  buildings: Map<string, Building>;
}

const loaded = new Map<CampusId, Promise<CampusData>>();

async function load(id: CampusId): Promise<CampusData> {
  const [config, geo] = await Promise.all([readJson<RawConfig>(path.join(rulesDir(), `${id}.json`)), readJson<RawGeo>(path.join(publishedDir(), `campus-${id}.json`))]);
  const feeds = await Promise.all(config.transit.networks.length ? [readNetworkMeta(id)] : []);
  const sources: Record<string, SourceRef> = {};
  for (const [sid, s] of Object.entries(config.sources)) sources[sid] = { id: sid, ...s };

  const rules = new Map<string, ParkingPlaceRules>();
  const parking: ParkingPlaceInfo[] = [];
  const explicit = new Map((config.parking.places ?? []).map((p) => [p.id, p]));
  const deckCodes = new Set((config.parking.decks ?? []).map((d) => d.code));
  const parkAndRide = new Set(config.parking.parkAndRide?.lots ?? []);
  for (const g of geo.parking) {
    const ex = explicit.get(g.id);
    const placeRules = ex ? compileExplicit(config, g.code, ex.rules) : compileUga(config, g.code, deckCodes.has(g.code));
    const used = [...new Set(placeRules.map((r) => r.sourceId))].filter((s) => s !== USER_PERMIT_SOURCE);
    const reviewBy = used.map((s) => sources[s]?.reviewBy ?? "1970-01-01").sort()[0] ?? "1970-01-01";
    rules.set(g.id, { placeId: g.id, code: g.code, rules: placeRules, overrides: overridesFor(config, g.id), reviewBy, tz: config.timezone });
    const deck = config.parking.decks?.find((d) => d.code === g.code);
    parking.push({
      id: g.id,
      code: g.code,
      name: ex?.name ?? deck?.name ?? g.name,
      label: ex?.label ?? (parkAndRide.has(g.code) ? "Park & Ride" : null),
      kind: g.kind,
      center: g.center,
      polygons: g.polygons,
      payment: ex?.payment ?? (deck ? "Pay at exit" : config.parking.remoteDaily?.lots.includes(g.code) ? `${config.parking.remoteDaily.payment} · $${config.parking.remoteDaily.price}/day` : null),
      parkAndRide: parkAndRide.has(g.code),
      osm: g.osm,
    });
  }

  const buildings: Building[] = geo.buildings.map((b) => ({ id: b.id, name: b.name, aliases: b.aliases, ref: b.ref, center: b.center, outline: b.outline, entrances: b.entrances }));
  const bundle: CampusBundle = {
    id,
    name: config.name,
    shortName: config.shortName,
    city: config.city,
    center: config.center,
    bounds: config.bounds,
    sources,
    buildings,
    parking,
    parkingNotes: config.parking.notes,
    night: config.night,
    help: config.help,
    transit: { feeds: feeds[0] ?? [], notIncluded: config.transit.notIncluded, trackers: config.transit.trackers },
    osm: { timestamp: geo.osmTimestamp, attribution: geo.attribution },
  };
  return { config, bundle, rules, buildings: new Map(buildings.map((b) => [b.id, b])) };
}

export function getCampus(id: CampusId): Promise<CampusData> {
  let p = loaded.get(id);
  if (!p) {
    p = load(id);
    loaded.set(id, p);
    p.catch(() => loaded.delete(id));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Transit networks
// ---------------------------------------------------------------------------

const networks = new Map<CampusId, Promise<TransitNetwork>>();

export function getNetwork(id: CampusId): Promise<TransitNetwork> {
  let p = networks.get(id);
  if (!p) {
    p = readJson<TransitNetwork>(path.join(publishedDir(), `transit-${id}.json`));
    networks.set(id, p);
    p.catch(() => networks.delete(id));
  }
  return p;
}

async function readNetworkMeta(id: CampusId) {
  const net = await getNetwork(id);
  return net.feeds.map((f) => ({ id: f.id, name: f.name, tracker: f.tracker, fileDate: f.fileDate }));
}

export type CalendarOverlay = RawConfig["transit"]["calendarOverlay"];
