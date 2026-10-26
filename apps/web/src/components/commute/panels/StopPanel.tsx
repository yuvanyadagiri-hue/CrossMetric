"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import { clock } from "../format";
import { useStops } from "../hooks";
import type { AppModel } from "../model";
import { IconButton, LinkButton, Notice, Skeleton } from "../ui";
import { RouteBadge } from "./common";

/** Scheduled departures at one stop. Timetable times, never live vehicle positions. */
export function StopPanel({ app, stop }: { app: AppModel; stop: { id: string; name: string; lon: number; lat: number } }) {
  // Stop ids carry their feed: MARTA stops are in the Atlanta network, UGA and ACC stops in Athens.
  const network = stop.id.startsWith("marta:") ? "gt" : stop.id.startsWith("uga:") || stop.id.startsWith("acc:") ? "uga" : app.campus;
  const s = useStops(network, [stop.lon, stop.lat], stop.id);
  const view = s.stops?.[0];
  const tracker = network === app.campus ? app.bundle?.transit.trackers[0] : network === "gt" ? { agency: "MARTA", url: "https://www.itsmarta.com/" } : null;
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-start gap-1">
        <IconButton label="Back" onClick={() => window.history.back()} className="-ml-2">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </IconButton>
        <div className="min-w-0">
          <h2 className="text-component font-semibold leading-tight [overflow-wrap:anywhere]">{stop.name}</h2>
          <p className="text-small text-app-muted">Scheduled · not live</p>
        </div>
      </div>
      {view?.calendarNote ? <Notice tone="amber">{view.calendarNote}</Notice> : null}
      {s.error ? <Notice tone="gray">{s.error}</Notice> : null}
      {!s.stops && !s.error ? <Skeleton className="h-24 w-full" /> : null}
      {view ? (
        view.arrivals.length ? (
          <ul className="divide-y divide-app-line" aria-label="Next departures">
            {view.arrivals.map((a, i) => (
              <li key={i} className="flex min-h-[52px] items-center gap-3 py-2">
                <RouteBadge route={a.route} />
                <span className="min-w-0 flex-1 truncate text-body">{a.headsign || a.route.long}</span>
                <span className="tnum shrink-0 text-right text-body">
                  <span className="font-semibold">{a.headway ? "~" : ""}{clock(a.time)}</span>
                  <span className="block text-small text-app-muted">{Math.max(0, Math.round((a.time - app.now) / 60_000))} min</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-app-muted">No scheduled departures in the next 90 minutes.</p>
        )
      ) : null}
      {view?.arrivals.some((a) => a.headway) ? <p className="text-small text-app-muted">~ This route runs on a frequency; buses come about that often, not to the minute.</p> : null}
      {tracker ? (
        <LinkButton href={tracker.url} icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
          Live tracker · {tracker.agency}
        </LinkButton>
      ) : null}
    </div>
  );
}
