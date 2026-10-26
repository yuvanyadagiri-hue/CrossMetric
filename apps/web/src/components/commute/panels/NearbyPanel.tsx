"use client";

import { Accessibility, Bus, Car, CircleParking, ExternalLink, Footprints, LocateFixed, MapPin, Navigation, RefreshCw, TrainFront } from "lucide-react";
import type { NearbyStation } from "@/lib/nearby-types";
import type { JourneyPlace } from "@/lib/journey-types";
import { clock, distance, duration, lineName } from "../format";
import type { AppModel } from "../model";
import { Notice, PanelHeader, PrimaryButton, SecondaryButton, Segmented, Skeleton, StateMessage, TextButton } from "../ui";
import { listRow, RouteBadge } from "./common";

export type NearbyFilter = "all" | "rail" | "bus";

export interface NearbyState {
  anchor: JourneyPlace | null;
  setAnchor: (p: JourneyPlace | null) => void;
  filter: NearbyFilter;
  setFilter: (f: NearbyFilter) => void;
  stations: NearbyStation[];
  nearestRail: { station: NearbyStation; driveMin: number | null; driveM: number | null } | null;
  coverage: string | null;
  notes: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  walk: { minutes: number; meters: number | null } | null;
  walkLoading: boolean;
}

const TRACKERS: Record<string, string> = { MARTA: "https://www.itsmarta.com/", "UGA Campus Transit": "https://routes.uga.edu/", "Athens-Clarke County Transit": "https://bustracker.accgov.com/InfoPoint/" };

function asPlace(s: NearbyStation): JourneyPlace {
  return { label: s.name, sublabel: s.agencies.join(", "), lon: s.lon, lat: s.lat, source: "station" };
}

function Departures({ s, now, max }: { s: NearbyStation; now: number; max: number }) {
  if (!s.departures.length) return <p className="text-small text-app-muted">No scheduled departures in the next hour.</p>;
  return (
    <ul className="space-y-2" aria-label={`Scheduled departures at ${s.name}`}>
      {s.departures.slice(0, max).map((d, i) => (
        <li key={i} className="flex items-start gap-3 text-small">
          <RouteBadge route={{ ...d.route, short: lineName(d.route.short, d.route.agency) }} />
          <span className="line-clamp-2 min-w-0 flex-1 pt-0.5 leading-snug [overflow-wrap:anywhere]">{d.headsign || d.route.long}</span>
          <span className="t-num shrink-0 text-right leading-snug">
            <span className="block font-medium text-app-ink">{Math.max(0, Math.round((d.time - now) / 60_000))} min</span>
            <span className="block text-app-muted">
              {d.headway ? "~" : ""}
              {clock(d.time)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One station or stop, as type on the sheet: a bare icon, the name, what serves it, the walk time in a
 * right-hand column and the next departures. Only the open one is a surface, and it adds the walking
 * route, access, parking and the two actions.
 */
function StationRow({ app, s, selected }: { app: AppModel; s: NearbyStation; selected: boolean }) {
  const n = app.nearby;
  const Icon = s.kind === "rail" ? TrainFront : Bus;
  return (
    <li className={`transition-colors duration-200 ${listRow(selected)}`}>
      <button type="button" aria-expanded={selected} onClick={() => n.select(selected ? null : s.id)} className="flex w-full items-start gap-3 py-3 text-left">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium leading-snug [overflow-wrap:anywhere]">{s.name}</span>
          <span className="block text-small text-app-muted">
            {s.kind === "rail" ? "Rail station" : "Bus stop"} · {s.agencies.join(", ")} · {s.walkMin !== null ? distance(s.walkM) : "straight-line distance"}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {s.routes.slice(0, selected ? 12 : 6).map((r) => (
              <RouteBadge key={r.short} route={{ ...r, short: lineName(r.short, r.agency) }} />
            ))}
            {!selected && s.routes.length > 6 ? <span className="text-small text-app-muted">+{s.routes.length - 6}</span> : null}
          </span>
        </span>
        <span className="t-num shrink-0 text-right">
          <span className="block text-component font-semibold leading-tight">{s.walkMin !== null ? s.walkMin : distance(s.straightM)}</span>
          <span className="block text-small text-app-muted">{s.walkMin !== null ? "min walk" : "away"}</span>
        </span>
      </button>
      <div className="space-y-3 pb-3 pl-8">
        <Departures s={s} now={app.now} max={selected ? 6 : 2} />
        {selected ? (
          <div className="space-y-3 border-t border-app-line pt-3">
            <ul className="space-y-2 text-small">
              <li className="flex items-start gap-2">
                <Footprints className="mt-0.5 h-4 w-4 shrink-0 text-app-muted" aria-hidden />
                <span>{n.walkLoading ? "Routing the walk…" : n.walk ? `Walking route on the map: ${duration(n.walk.minutes)}${n.walk.meters ? `, ${distance(n.walk.meters)}` : ""}` : "Walking route unavailable"}</span>
              </li>
              <li className="flex items-start gap-2">
                <Accessibility className="mt-0.5 h-4 w-4 shrink-0 text-app-muted" aria-hidden />
                <span>{s.wheelchair === "yes" ? "Wheelchair accessible (published)" : s.wheelchair === "no" ? "Not wheelchair accessible (published)" : "Accessibility not published"}</span>
              </li>
              {s.parking ? (
                <li className="flex items-start gap-2">
                  <CircleParking className="mt-0.5 h-4 w-4 shrink-0 text-app-muted" aria-hidden />
                  <span>{s.parking}</span>
                </li>
              ) : null}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <SecondaryButton
                className="!px-3"
                icon={<Navigation className="h-4 w-4 shrink-0" aria-hidden />}
                onClick={() => {
                  app.journey.startSearch(asPlace(s), { origin: n.anchor });
                  app.go({ kind: "plan" }, "half");
                }}
              >
                Directions
              </SecondaryButton>
              <SecondaryButton
                className="!px-3"
                icon={<MapPin className="h-4 w-4 shrink-0" aria-hidden />}
                onClick={() => {
                  app.journey.setOrigin(asPlace(s));
                  app.openPicker("destination");
                }}
              >
                Trip from here
              </SecondaryButton>
            </div>
            {TRACKERS[s.agencies[0] ?? ""] ? (
              <a href={TRACKERS[s.agencies[0]!]} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 text-small font-medium text-app-route hover:underline">
                Live tracker · {s.agencies[0]} <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Stations and stops near a place, ranked by walking time, with scheduled departures. */
export function NearbyPanel({ app }: { app: AppModel }) {
  const n = app.nearby;
  const list = n.stations.filter((s) => n.filter === "all" || s.kind === n.filter);
  return (
    <div className="space-y-3 pt-1">
      <PanelHeader
        title="Nearby transit"
        sub={
          n.anchor ? (
            <span className="flex flex-wrap items-center gap-x-2">
              Near {n.anchor.label}
              <TextButton onClick={() => app.openPicker("nearby")} className="!min-h-[32px] text-small">
                Change
              </TextButton>
            </span>
          ) : (
            "Stations and stops by walking time"
          )
        }
        action={
          n.anchor ? (
            <button type="button" onClick={n.refresh} aria-label="Refresh departures" className="grid h-11 w-11 place-items-center rounded-full hover:bg-app-chip">
              <RefreshCw className={`h-5 w-5 ${n.loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          ) : undefined
        }
      />
      {!n.anchor ? (
        <StateMessage
          icon={<LocateFixed className="h-5 w-5" />}
          title="Find transit near you or an address"
          action={
            <>
              <SecondaryButton
                icon={<LocateFixed className="h-4 w-4" aria-hidden />}
                onClick={async () => {
                  const p = await app.currentPlace();
                  if (p) n.setAnchor(p);
                }}
              >
                {app.locating ? "Finding you…" : "Use my location"}
              </SecondaryButton>
              <SecondaryButton onClick={() => app.openPicker("nearby")}>Enter an address</SecondaryButton>
            </>
          }
        >
          {app.locError ?? (app.locationPermission === "denied" ? "Location is blocked for this site. Enter an address instead." : "Covers MARTA in Metro Atlanta, and Athens-Clarke County Transit and UGA Campus Transit in Athens.")}
        </StateMessage>
      ) : (
        <>
          <Segmented
            label="Show"
            hideLabel
            value={n.filter}
            options={[
              ["all", "All"],
              ["rail", "Rail"],
              ["bus", "Bus"],
            ]}
            onChange={n.setFilter}
          />
          {n.notes.map((x) => (
            <Notice key={x} tone="amber">
              {x}
            </Notice>
          ))}
          {n.error ? <StateMessage tone="error" icon={<RefreshCw className="h-5 w-5" />} title="Transit data couldn't be loaded" action={<SecondaryButton onClick={n.refresh}>Try again</SecondaryButton>}>{n.error}</StateMessage> : null}
          {n.loading && !n.stations.length ? (
            <div className="space-y-2" aria-busy="true">
              <StateMessage busy title="Finding stations and stops…">Ranking them by walking time.</StateMessage>
              <Skeleton className="h-24 w-full rounded-surface" />
            </div>
          ) : null}
          {list.length ? (
            <ul className="cm-stagger" aria-label="Stations and stops">
              {list.map((s) => (
                <StationRow key={s.id} app={app} s={s} selected={n.selectedId === s.id} />
              ))}
            </ul>
          ) : !n.loading && !n.error && n.coverage ? (
            <StateMessage icon={<MapPin className="h-5 w-5" />} title={n.filter === "bus" ? "No bus stops nearby" : "No transit stops nearby"}>
              {n.coverage}
            </StateMessage>
          ) : !n.loading && !n.error && n.stations.length && !list.length ? (
            <StateMessage icon={<MapPin className="h-5 w-5" />} title={`No ${n.filter === "rail" ? "rail stations" : "bus stops"} within walking distance`}>
              Try All.
            </StateMessage>
          ) : null}
          {n.nearestRail && n.filter !== "bus" ? (
            <section className="space-y-2 border-t border-app-line pt-4" aria-label="Nearest rail station">
              <h3 className="t-component">Nearest rail station</h3>
              <p className="flex items-center gap-2 text-body font-medium">
                <TrainFront className="h-5 w-5 shrink-0" aria-hidden /> {n.nearestRail.station.name}
              </p>
              <p className="text-small text-app-muted">
                {n.nearestRail.driveMin !== null ? (
                  <>
                    <Car className="mr-1 inline h-4 w-4" aria-hidden />
                    About {duration(n.nearestRail.driveMin)} by car ({distance(n.nearestRail.driveM)}), too far to walk.
                  </>
                ) : (
                  `${distance(n.nearestRail.station.straightM)} away in a straight line.`
                )}
                {n.nearestRail.station.parking ? ` ${n.nearestRail.station.parking}.` : ""}
              </p>
              <PrimaryButton
                className="!min-h-[48px]"
                onClick={() => {
                  app.journey.startSearch(asPlace(n.nearestRail!.station), { origin: n.anchor });
                  app.go({ kind: "plan" }, "half");
                }}
              >
                Plan a trip there
              </PrimaryButton>
            </section>
          ) : null}
          <p className="text-small text-app-muted">Departure times are scheduled times from published timetables, not live predictions. Walking times are routed on OpenStreetMap paths.</p>
        </>
      )}
    </div>
  );
}
