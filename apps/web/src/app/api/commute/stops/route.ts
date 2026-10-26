import { NextResponse, type NextRequest } from "next/server";
import { localDate, nearbyStops } from "@crossmetric/engine/commute";
import type { StopView } from "@/lib/commute-types";
import { isCampusId } from "@/lib/commute-types";
import { commuteError, handleCommuteFailure, inGeorgia } from "@/server/commute/api";
import { getCampus } from "@/server/commute/data";
import { transitDay } from "@/server/commute/transit";

/**
 * GET /api/commute/stops?campus=&lon=&lat=[&stop=]
 * The nearest stops (or one stop by id) with scheduled departures in the next 90 minutes.
 * These are timetable times, never live vehicle positions.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const campus = sp.get("campus");
  const lon = Number(sp.get("lon"));
  const lat = Number(sp.get("lat"));
  const stopId = sp.get("stop");
  if (!isCampusId(campus) || !inGeorgia(lon, lat)) return commuteError("Invalid request.", "invalid", 400);
  try {
    const now = Date.now();
    const data = await getCampus(campus);
    const day = await transitDay(campus, localDate(now, data.config.timezone));
    const net = day.net;
    const stops = stopId ? [{ stop: net.stops.id.indexOf(stopId), seconds: 0 }].filter((s) => s.stop >= 0) : nearbyStops(net, lon, lat, 450, undefined, 4);
    const nowS = (now - day.forward.ref) / 1000;
    const views: StopView[] = stops.map(({ stop }) => {
      const arrivals: StopView["arrivals"] = [];
      for (const { pattern, index } of day.forward.stopPatterns[stop] ?? []) {
        const p = day.forward.patterns[pattern]!;
        if (index === p.stops.length - 1) continue;
        const src = net.patterns[p.source]!;
        const r = net.routes[src.route]!;
        let n = 0;
        for (const t of p.trips) {
          const dep = t.start + t.profile[2 * index + 1]!;
          if (dep < nowS || dep > nowS + 90 * 60) continue;
          arrivals.push({
            route: { short: r.short || r.long, long: r.long, color: r.color, text: r.text, agency: net.feeds.find((f) => f.id === r.feed)?.name ?? r.feed },
            headsign: src.headsign,
            time: day.forward.ref + dep * 1000,
            headway: t.headway,
          });
          if (++n >= 3) break;
        }
      }
      arrivals.sort((a, b) => a.time - b.time);
      return { id: net.stops.id[stop]!, name: net.stops.name[stop]!, lon: net.stops.lon[stop]!, lat: net.stops.lat[stop]!, arrivals: arrivals.slice(0, 8), scheduledOnly: true, calendarNote: day.note };
    });
    return NextResponse.json({ stops: views, now }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleCommuteFailure(err);
  }
}
