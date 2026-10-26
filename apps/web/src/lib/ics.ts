/**
 * .ics import, entirely in the browser (the file is never uploaded).
 *
 * Uses ical.js for RFC 5545 parsing: RRULE, RDATE, EXDATE, RECURRENCE-ID
 * overrides and VTIMEZONE definitions. Floating times are read as campus
 * local time. Only identifiers, times, status, title and location are kept;
 * descriptions and attendees are dropped.
 */

import ICAL from "ical.js";
import { addDays, CAMPUS_TZ, isRemoteLocation, localDate, resolveBuilding, zonedToUtc, type BuildingRef, type ClassOccurrence } from "@crossmetric/engine/commute";
import type { ImportedSeries } from "./commute-store";

export interface IcsImport {
  series: ImportedSeries[];
  occurrences: ClassOccurrence[];
  skipped: number;
}

const MAX_OCCURRENCES_PER_SERIES = 400;

function toMs(t: ICAL.Time): number {
  // UTC and VTIMEZONE-backed times convert exactly; floating times are campus wall-clock.
  const zone = t.zone;
  const floating = !zone || zone === ICAL.Timezone.localTimezone || zone.tzid === "floating";
  if (!floating) return t.toUnixTime() * 1000;
  const date = `${String(t.year).padStart(4, "0")}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  return zonedToUtc(date, t.hour * 60 + t.minute, CAMPUS_TZ);
}

function text(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 160) : "";
}

/** Parse an .ics file and expand occurrences between `fromDate` and `toDate` (YYYY-MM-DD, campus time). */
export function parseIcs(raw: string, buildings: BuildingRef[], fromDate: string, toDate: string): IcsImport {
  const root = new ICAL.Component(ICAL.parse(raw));
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {
      // A broken VTIMEZONE leaves those events floating (campus time).
    }
  }
  const rangeStart = zonedToUtc(fromDate, 0);
  const rangeEnd = zonedToUtc(addDays(toDate, 1), 0);
  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of vevents) {
    const ev = new ICAL.Event(v);
    if (!ev.uid) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const series: ImportedSeries[] = [];
  const occurrences: ClassOccurrence[] = [];
  let skipped = 0;
  for (const ev of masters.values()) {
    const location = text(ev.location);
    const title = text(ev.summary);
    const remote = isRemoteLocation(location) || isRemoteLocation(title);
    const match = remote || !location ? null : resolveBuilding(location, buildings);
    const s: ImportedSeries = {
      uid: ev.uid,
      title: title || "Class",
      location,
      buildingId: match && (match.status === "exact" || match.status === "likely") ? match.matches[0]!.id : null,
      match: remote ? "remote" : (match?.status ?? "none"),
      candidates: match?.status === "ambiguous" ? match.matches.map((m) => m.id) : [],
      include: null,
    };
    const push = (start: ICAL.Time, end: ICAL.Time, item: ICAL.Event, recurrenceId: string) => {
      const startMs = toMs(start);
      if (startMs < rangeStart || startMs >= rangeEnd) return;
      const status = String(item.component.getFirstPropertyValue("status") ?? "CONFIRMED").toUpperCase();
      const loc = text(item.location) || location;
      occurrences.push({
        key: `ics|${ev.uid}|${recurrenceId}`,
        source: "ics",
        sourceRef: ev.uid,
        title: s.title,
        start: startMs,
        end: toMs(end),
        date: localDate(startMs),
        buildingId: s.buildingId,
        location: loc,
        status: status === "CANCELLED" ? "cancelled" : status === "TENTATIVE" ? "tentative" : "confirmed",
        allDay: start.isDate,
        remote: remote || isRemoteLocation(loc),
        include: null,
        needsLocation: !s.buildingId,
      });
    };
    if (ev.isRecurring()) {
      const it = ev.iterator();
      let next: ICAL.Time | null;
      let n = 0;
      while ((next = it.next()) && n++ < MAX_OCCURRENCES_PER_SERIES) {
        if (toMs(next) >= rangeEnd) break;
        const d = ev.getOccurrenceDetails(next);
        push(d.startDate, d.endDate, d.item, d.recurrenceId.toICALString());
      }
    } else {
      push(ev.startDate, ev.endDate, ev, ev.startDate.toICALString());
    }
    if (occurrences.some((o) => o.sourceRef === ev.uid)) series.push(s);
    else skipped++;
  }
  return { series, occurrences, skipped };
}

export { applySeries } from "./ics-series";
