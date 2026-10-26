import "server-only";

import { buildDayTimetable, reverseTimetable, serviceActive, type DayTimetable, type TransitNetwork } from "@crossmetric/engine/commute";
import type { CampusId } from "@/lib/commute-types";
import { getCampus, getNetwork } from "./data";

export type TransitDayStatus = "scheduled" | "calendar_unconfirmed" | "modified" | "no_service" | "not_covered";

export interface TransitDay {
  net: TransitNetwork;
  date: string;
  forward: DayTimetable;
  reversed: DayTimetable;
  status: TransitDayStatus;
  /** One short phrase for the person, or null when the schedule is normal. */
  note: string | null;
}

/** Whether any service in a feed runs on `date` according to the feed itself. */
function feedCovers(net: TransitNetwork, feed: string, date: string): boolean {
  return net.services.some((s) => s.id.startsWith(`${feed}:`) && serviceActive(s, date));
}

const cache = new Map<string, Promise<TransitDay>>();
const CACHE_MAX = 8;

async function build(campus: CampusId, date: string, walkSpeedMps: number): Promise<TransitDay> {
  const [net, data] = await Promise.all([getNetwork(campus), getCampus(campus)]);
  const overlay = data.config.transit.calendarOverlay;
  const exclude: string[] = [];
  let status: TransitDayStatus = "scheduled";
  let note: string | null = null;
  if (overlay) {
    const entry = overlay.dates.find((d) => d.date === date);
    const agency = data.bundle.transit.feeds.find((f) => f.id === overlay.agency)?.name ?? overlay.agency;
    if (entry?.status === "none") {
      exclude.push(overlay.agency);
      status = "no_service";
      note = `${agency}: no service today`;
    } else if (entry) {
      status = "modified";
      note = `${agency}: ${entry.label.toLowerCase()} — times may differ`;
    } else if (date > overlay.publishedThrough) {
      status = "calendar_unconfirmed";
      note = `${agency} calendar not yet published for this date`;
    }
  }
  const uncovered = net.feeds.filter((f) => !exclude.includes(f.id) && !feedCovers(net, f.id, date));
  if (uncovered.length === net.feeds.length) {
    status = "not_covered";
    note = "No published schedule for this date";
  }
  const forward = buildDayTimetable(net, date, { walkSpeedMps, detourFactor: 1.3, excludeFeeds: exclude }, data.config.timezone);
  return { net, date, forward, reversed: reverseTimetable(forward), status, note };
}

export function transitDay(campus: CampusId, date: string, walkSpeedMps = 1.25): Promise<TransitDay> {
  const key = `${campus}|${date}|${walkSpeedMps.toFixed(2)}`;
  let p = cache.get(key);
  if (p) {
    cache.delete(key);
    cache.set(key, p);
    return p;
  }
  p = build(campus, date, walkSpeedMps);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return p;
}
