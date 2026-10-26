/**
 * Commuter app unit tests: .ics import (RFC 5545 recurrence, time zones,
 * overrides, cancellations, remote and all-day events) and building search.
 */
import { describe, expect, it } from "vitest";
import { dailyTargets, dedupeOccurrences, expandManual, plannable, zonedToUtc, type BuildingRef } from "@crossmetric/engine/commute";
import { applySeries, parseIcs } from "@/lib/ics";
import { searchBuildings } from "@/components/commute/search";
import type { Building } from "@/lib/commute-types";

const BUILDINGS: BuildingRef[] = [
  { id: "w1", name: "Christopher W. Klaus Advanced Computing Building", aliases: ["Klaus Advanced Computing Building", "Klaus"] },
  { id: "w2", name: "G. Wayne Clough Undergraduate Learning Commons", aliases: ["CULC"] },
  { id: "w3", name: "Engineering Building A", aliases: [] },
  { id: "w4", name: "Engineering Building B", aliases: [] },
];

const VTIMEZONE = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

// Tue/Thu 9:30 class across the Nov 1 DST change, with one skipped date (EXDATE),
// one moved occurrence (RECURRENCE-ID override) and one cancelled occurrence.
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
${VTIMEZONE}
BEGIN:VEVENT
UID:cs1332@example.edu
SUMMARY:CS 1332
LOCATION:Klaus 1443
DESCRIPTION:Private notes that must not be kept
ATTENDEE:mailto:someone@example.edu
DTSTART;TZID=America/New_York:20261020T093000
DTEND;TZID=America/New_York:20261020T104500
RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261106T000000Z
EXDATE;TZID=America/New_York:20261022T093000
END:VEVENT
BEGIN:VEVENT
UID:cs1332@example.edu
RECURRENCE-ID;TZID=America/New_York:20261027T093000
SUMMARY:CS 1332 (moved)
LOCATION:CULC 144
DTSTART;TZID=America/New_York:20261027T110000
DTEND;TZID=America/New_York:20261027T121500
END:VEVENT
BEGIN:VEVENT
UID:cs1332@example.edu
RECURRENCE-ID;TZID=America/New_York:20261029T093000
STATUS:CANCELLED
SUMMARY:CS 1332
DTSTART;TZID=America/New_York:20261029T093000
DTEND;TZID=America/New_York:20261029T104500
END:VEVENT
BEGIN:VEVENT
UID:online@example.edu
SUMMARY:HIST 2111
LOCATION:Online - Zoom
DTSTART;TZID=America/New_York:20261021T130000
DTEND;TZID=America/New_York:20261021T140000
END:VEVENT
BEGIN:VEVENT
UID:holiday@example.edu
SUMMARY:Fall break
DTSTART;VALUE=DATE:20261019
DTEND;VALUE=DATE:20261020
END:VEVENT
BEGIN:VEVENT
UID:eng@example.edu
SUMMARY:ME 2110
LOCATION:Engineering 100
DTSTART:20261021T140000Z
DTEND:20261021T150000Z
END:VEVENT
BEGIN:VEVENT
UID:floating@example.edu
SUMMARY:Lab
LOCATION:CULC
DTSTART:20261023T080000
DTEND:20261023T090000
END:VEVENT
END:VCALENDAR`;

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};

describe(".ics import", () => {
  const res = parseIcs(ICS, BUILDINGS, "2026-10-18", "2026-11-10");
  const cs = res.occurrences.filter((o) => o.sourceRef === "cs1332@example.edu");

  it("expands the weekly rule with EXDATE, overrides and cancellations", () => {
    expect(cs.map((o) => o.date)).toEqual(["2026-10-20", "2026-10-27", "2026-10-29", "2026-11-03", "2026-11-05"]);
    const moved = cs.find((o) => o.date === "2026-10-27")!;
    expect(moved.start).toBe(at("2026-10-27", "11:00"));
    expect(moved.location).toBe("CULC 144");
    expect(cs.find((o) => o.date === "2026-10-29")!.status).toBe("cancelled");
  });

  it("keeps local class times across the DST change", () => {
    expect(new Date(cs.find((o) => o.date === "2026-10-20")!.start).toISOString()).toBe("2026-10-20T13:30:00.000Z");
    expect(new Date(cs.find((o) => o.date === "2026-11-03")!.start).toISOString()).toBe("2026-11-03T14:30:00.000Z");
  });

  it("uses the original recurrence identity, not the (mutable) start time, as the occurrence key", () => {
    const moved = cs.find((o) => o.date === "2026-10-27")!;
    expect(moved.key).toBe("ics|cs1332@example.edu|20261027T093000");
    expect(new Set(cs.map((o) => o.key)).size).toBe(cs.length);
  });

  it("matches locations to buildings and flags ambiguous, remote and all-day events", () => {
    const series = new Map(res.series.map((s) => [s.uid, s]));
    expect(series.get("cs1332@example.edu")).toMatchObject({ buildingId: "w1", match: "likely" });
    expect(series.get("online@example.edu")).toMatchObject({ match: "remote", buildingId: null });
    expect(series.get("eng@example.edu")).toMatchObject({ match: "ambiguous", candidates: ["w3", "w4"] });
    const allDay = res.occurrences.find((o) => o.sourceRef === "holiday@example.edu")!;
    expect(allDay.allDay).toBe(true);
    expect(plannable(allDay)).toBe(false);
  });

  it("reads floating times as campus time and UTC times exactly", () => {
    expect(res.occurrences.find((o) => o.sourceRef === "floating@example.edu")!.start).toBe(at("2026-10-23", "08:00"));
    expect(res.occurrences.find((o) => o.sourceRef === "eng@example.edu")!.start).toBe(Date.UTC(2026, 9, 21, 14, 0));
  });

  it("drops descriptions and attendees", () => {
    const text = JSON.stringify(res);
    expect(text).not.toMatch(/Private notes/);
    expect(text).not.toMatch(/someone@example\.edu/);
  });

  it("plans only in-person, located, confirmed classes, and a chosen building fixes an ambiguous series", () => {
    const targets = dailyTargets(res.occurrences);
    expect(targets.map((t) => t.date)).toEqual(["2026-10-20", "2026-10-23", "2026-10-27", "2026-11-03", "2026-11-05"]);
    const fixed = applySeries(
      res.occurrences,
      res.series.map((s) => (s.uid === "eng@example.edu" ? { ...s, buildingId: "w3", match: "chosen" as const, candidates: [] } : s)),
    );
    expect(dailyTargets(fixed).map((t) => t.date)).toContain("2026-10-21");
  });

  it("is idempotent: importing twice and adding the same class by hand yields one occurrence", () => {
    const again = parseIcs(ICS, BUILDINGS, "2026-10-18", "2026-11-10");
    const manual = expandManual({ id: "m1", campus: "gt", buildingId: "w1", days: [2], start: "09:30", end: "10:45", from: "2026-10-20", until: "2026-10-20" }, "2026-10-18", "2026-11-10");
    const merged = dedupeOccurrences([...res.occurrences, ...again.occurrences, ...manual]);
    const oct20 = merged.filter((o) => o.date === "2026-10-20" && o.buildingId === "w1");
    expect(oct20).toHaveLength(1);
    expect(oct20[0]!.source).toBe("manual");
  });

  it("rejects text that is not a calendar", () => {
    expect(() => parseIcs("hello", BUILDINGS, "2026-10-18", "2026-11-10")).toThrow();
  });
});

describe("building search", () => {
  const buildings = BUILDINGS.map((b) => ({ ...b, ref: null, center: [0, 0], outline: [], entrances: [] })) as Building[];
  it("finds buildings by short name and prefix", () => {
    expect(searchBuildings("klaus", buildings)[0]!.id).toBe("w1");
    expect(searchBuildings("culc", buildings)[0]!.id).toBe("w2");
    expect(searchBuildings("engineering building b", buildings)[0]!.id).toBe("w4");
    expect(searchBuildings("eng", buildings).map((b) => b.id)).toEqual(["w3", "w4"]);
    expect(searchBuildings("zzz", buildings)).toEqual([]);
  });
});
