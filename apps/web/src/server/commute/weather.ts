import "server-only";

import { parseGridSeries, rainStateFor, type GridValue } from "@crossmetric/engine/commute";
import type { WeatherView } from "@/lib/commute-types";

/**
 * National Weather Service adapter (api.weather.gov), server-side and cached.
 * NWS asks for an identifying User-Agent; set NWS_USER_AGENT to include a
 * contact (site or email) for production use. NWS provides forecasts and
 * alerts, not walking delays: the walking penalty is CrossMetric's estimate.
 */

const BASE = "https://api.weather.gov";
const UA = process.env.NWS_USER_AGENT ?? "CrossMetric/3.0 (student commuter app)";
const POINT_TTL = 24 * 3600_000;
const GRID_TTL = 15 * 60_000;
const ALERT_TTL = 5 * 60_000;

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

async function get<T>(url: string, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/geo+json" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (res.ok) return (await res.json()) as T;
      last = new Error(`NWS ${res.status}`);
      if (res.status < 500) break;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw last;
}

interface Grid {
  qpf: GridValue[];
  pop: GridValue[];
  updatedAt: number | null;
}

function gridFor(lat: number, lon: number): Promise<Grid> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(`grid:${key}`, GRID_TTL, async () => {
    const point = await cached(`point:${key}`, POINT_TTL, () => get<{ properties: { forecastGridData: string } }>(`${BASE}/points/${key}`));
    const grid = await get<{ properties: { updateTime?: string; quantitativePrecipitation?: { values: { validTime: string; value: number | null }[] }; probabilityOfPrecipitation?: { values: { validTime: string; value: number | null }[] } } }>(point.properties.forecastGridData);
    return {
      qpf: parseGridSeries(grid.properties.quantitativePrecipitation),
      pop: parseGridSeries(grid.properties.probabilityOfPrecipitation),
      updatedAt: grid.properties.updateTime ? Date.parse(grid.properties.updateTime) : null,
    };
  });
}

function alertsFor(lat: number, lon: number): Promise<WeatherView["alerts"]> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(`alerts:${key}`, ALERT_TTL, async () => {
    const json = await get<{ features: { id: string; properties: { event: string; headline: string | null; severity: string; ends: string | null; expires: string | null } }[] }>(`${BASE}/alerts/active?point=${key}`);
    return json.features.map((f) => ({ event: f.properties.event, headline: f.properties.headline ?? f.properties.event, severity: f.properties.severity, ends: f.properties.ends ?? f.properties.expires, url: f.id }));
  });
}

/** Rain state over [start, end) at a point. Failures yield "unavailable", never "dry". */
export async function weatherFor(lat: number, lon: number, start: number, end: number): Promise<WeatherView> {
  const [grid, alerts] = await Promise.allSettled([gridFor(lat, lon), alertsFor(lat, lon)]);
  const g = grid.status === "fulfilled" ? grid.value : null;
  const state = g ? rainStateFor(g.qpf, g.pop, start, end) : { state: "unavailable" as const, avgMmPerHour: null, pop: null };
  return { ...state, updatedAt: g?.updatedAt ?? null, alerts: alerts.status === "fulfilled" ? alerts.value : [] };
}
