import { CAMPUS_TZ, clockLabel, localDate, localMinutes } from "@crossmetric/engine/commute";

export const tz = CAMPUS_TZ;

/** "9:05 AM" in campus time. */
export function clock(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "—" : clockLabel(ms, tz);
}

/** "9:05" without AM/PM, for tight rows. */
export function clockShort(ms: number): string {
  return clock(ms).replace(/ (AM|PM)$/, "");
}

/** "Today", "Tomorrow", or "Mon, Oct 19" relative to `now` (campus dates). */
export function dayLabel(ms: number, now: number): string {
  const d = localDate(ms, tz);
  const today = localDate(now, tz);
  if (d === today) return "Today";
  const tomorrow = localDate(now + 24 * 3600_000, tz);
  if (d === tomorrow) return "Tomorrow";
  return new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

/** "9:05 AM" today, "Tomorrow 9:05 AM", "Mon 9:05 AM" later. */
export function when(ms: number, now: number): string {
  const day = dayLabel(ms, now);
  if (day === "Today") return clock(ms);
  if (day === "Tomorrow") return `Tomorrow ${clock(ms)}`;
  return `${new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short" })} ${clock(ms)}`;
}

export function minutes(n: number): string {
  const m = Math.max(0, Math.round(n));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** The single dominant instruction on the home sheet. */
export function leaveText(leaveBy: number, now: number): string {
  const m = Math.floor((leaveBy - now) / 60_000);
  if (m <= 0) return "Leave now";
  if (m < 60) return `Leave in ${m} min`;
  if (m <= 180) return `Leave in ${minutes(m)}`;
  return `Leave ${when(leaveBy, now)}`;
}

export function usd(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "$0";
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

export function metersLabel(m: number): string {
  const ft = m * 3.28084;
  if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
  const mi = m / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

export function minutesOfDay(ms: number): number {
  return localMinutes(ms, tz);
}

/** "42 min", "1 hr 5 min". */
export function duration(min: number): string {
  return minutes(min);
}

/** Miles for longer distances, feet for short ones. */
export function distance(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  return metersLabel(m);
}

/** "9:05 AM" today, otherwise "Tomorrow 9:05 AM" / "Thu 9:05 AM". */
export function clockDay(ms: number, now: number): string {
  return when(ms, now);
}

/** MARTA rail lines are published as "RED", "GOLD"…; show them as "Red line". */
export function lineName(short: string, agency: string): string {
  if (/marta/i.test(agency) && /^(RED|GOLD|BLUE|GREEN)$/i.test(short)) return `${short.charAt(0)}${short.slice(1).toLowerCase()} line`;
  if (/^ATLSC$/i.test(short)) return "Streetcar";
  return short;
}
