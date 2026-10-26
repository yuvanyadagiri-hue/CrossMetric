/**
 * A predictable stand-in for the Valhalla routing service (straight lines at fixed
 * speeds with a detour factor), so integration tests never call a live service.
 * Same behaviour as the helper in journey.integration.test.ts.
 */
import { vi } from "vitest";

function haversine(a: [number, number], b: [number, number]) {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_195;
}
function encode(points: [number, number][]) {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of points) {
    const iLat = Math.round(lat * 1e6);
    const iLon = Math.round(lon * 1e6);
    enc(iLat - pLat);
    enc(iLon - pLon);
    pLat = iLat;
    pLon = iLon;
  }
  return out;
}
const SPEED: Record<string, number> = { pedestrian: 1.3, bicycle: 4.5, auto: 13 };
type Loc = { lon: number; lat: number };

export const calls: string[] = [];
export function fakeRouting(down = false) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (down) throw new TypeError("fetch failed");
    if (!url.includes("valhalla")) return new Response("unavailable", { status: 503 });
    const body = JSON.parse(String(init?.body ?? "{}")) as { locations?: Loc[]; sources?: Loc[]; targets?: Loc[]; costing?: string; alternates?: number };
    const speed = SPEED[body.costing ?? "auto"] ?? 13;
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/route")) {
      const [a, b] = body.locations!;
      const m = haversine([a!.lon, a!.lat], [b!.lon, b!.lat]) * 1.3;
      const trip = (bend: number) => {
        const mid: [number, number] = [(a!.lon + b!.lon) / 2 + bend, (a!.lat + b!.lat) / 2 - bend];
        return { trip: { summary: { length: (m * (1 + Math.abs(bend) * 40)) / 1000, time: (m * (1 + Math.abs(bend) * 20)) / speed }, legs: [{ shape: encode([[a!.lon, a!.lat], mid, [b!.lon, b!.lat]]), maneuvers: [{ instruction: "Head north.", length: m / 1000, time: m / speed, begin_shape_index: 0 }] }] } };
      };
      return json({ ...trip(0), alternates: body.alternates ? [trip(0.004)] : [] });
    }
    if (url.endsWith("/sources_to_targets")) {
      return json({ sources_to_targets: body.sources!.map((s) => body.targets!.map((t) => { const m = haversine([s.lon, s.lat], [t.lon, t.lat]) * 1.3; return { distance: m / 1000, time: m / speed }; })) });
    }
    if (url.endsWith("/trace_attributes")) return json({ edges: [] });
    return new Response("{}", { status: 404 });
  });
}

