/**
 * Solar elevation (NOAA approximation, accurate to well under a degree), used
 * to tell whether a trip happens in daylight. GDOT's "low light" crashes are
 * those at dawn, dusk or in the dark.
 */

const RAD = Math.PI / 180;

export function solarElevationDeg(date: Date, lat: number, lon: number): number {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.0000004 * n) * RAD;
  const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * RAD;
  const hourAngle = lst - ra;
  const elev = Math.asin(Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle));
  return elev / RAD;
}

export type LightCondition = "daylight" | "twilight" | "dark";

/** Daylight above 0°, twilight (dawn/dusk) down to −6° (civil twilight), dark below. */
export function lightAt(date: Date, lat: number, lon: number): LightCondition {
  const e = solarElevationDeg(date, lat, lon);
  return e > 0 ? "daylight" : e > -6 ? "twilight" : "dark";
}
