"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bookmark, Briefcase, CarTaxiFront, ChevronDown, ChevronRight, CircleParking, Clock3, GraduationCap, Home, LayoutGrid, LocateFixed, MapPin, MapPinPlus, Moon, Route, Search, ShieldCheck, TrainFront } from "lucide-react";
import type { CampusId } from "@/lib/commute-types";
import { useRecentSearches, useSavedPlaces, type SavedPlace2 } from "@/lib/commute-store";
import type { JourneyPlace } from "@/lib/journey-types";
import { reportStatus, timeAgo, type CommunityReport } from "@/lib/reports";
import { clock, dayLabel, leaveText, minutesOfDay, when } from "../format";
import { useWeather } from "../hooks";
import type { AppModel } from "../model";
import { TextButton } from "../ui";
import { WhenChip } from "../WhenChip";
import { ReportRow } from "./CommunityPanel";

const KIND_ICON: Record<SavedPlace2["kind"], typeof Home> = { home: Home, work: Briefcase, school: GraduationCap, other: Bookmark };
const CAMPUS_NAME: Record<CampusId, string> = { gt: "Georgia Tech", uga: "UGA" };

function greeting(now: number): string {
  const h = Math.floor(minutesOfDay(now) / 60);
  if (h < 5 || h >= 22) return "Out late?";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** The next 45 minutes outside, in a few words; nothing when the forecast could not be read. */
function weatherPhrase(w: ReturnType<typeof useWeather>): string | null {
  if (!w) return null;
  if (w.alerts.length) return "Weather alert";
  switch (w.state) {
    case "dry":
      return "Dry for 45 min";
    case "light":
      return "Light rain soon";
    case "moderate":
    case "wet_unknown_intensity":
      return "Rain soon";
    case "heavy":
      return "Heavy rain soon";
    default:
      return null;
  }
}

/** Metres between two points (equirectangular; plenty for "near you"). */
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111_195;

// The sections rise in once per launch; coming back to Explore does not replay them.
let dealt = false;

/**
 * Explore: the map is the screen, and this sheet (the side panel on a desktop) holds what is useful
 * around you right now — four ways in (plan a route, transit, parking, report a barrier), your trip
 * and places, what is leaving nearby, the barriers people reported nearby, and the rest of
 * CrossMetric. The search lives above the map on a phone and at the top of the panel on a desktop.
 */
export function ExplorePanel({ app }: { app: AppModel }) {
  const [places] = useSavedPlaces();
  const [recents] = useRecentSearches();
  const [first] = useState(() => !dealt);
  useEffect(() => {
    dealt = true;
  }, []);
  const desktop = app.layout === "desktop";
  const go = (p: JourneyPlace) => app.planTo(p);
  const dest = app.journey.destination;
  const saved = places.slice(0, 2);
  const savedLabels = new Set(saved.map((p) => p.place.label));
  const seen = new Set<string>(dest ? [dest.label] : []);
  const recent = app.prefs.keepHistory
    ? recents
        .filter((r) => {
          if (savedLabels.has(r.to.label) || seen.has(r.to.label)) return false;
          seen.add(r.to.label);
          return true;
        })
        .slice(0, saved.length ? 1 : 2)
    : [];

  // The weather where the person is (or at their campus), asked once.
  const here = app.nearby.anchor;
  const bounds = app.bundle?.bounds;
  const lon = here ? here.lon : bounds ? (bounds[0][0] + bounds[1][0]) / 2 : null;
  const lat = here ? here.lat : bounds ? (bounds[0][1] + bounds[1][1]) / 2 : null;
  const point = useMemo<[number, number] | null>(() => (lon !== null && lat !== null ? [lon, lat] : null), [lon, lat]);
  const weather = weatherPhrase(useWeather(point, null));

  const actions: { id: string; label: string; Icon: typeof Route; run: () => void; accent?: boolean }[] = [
    { id: "route", label: "Plan route", Icon: Route, run: () => app.openPicker("destination") },
    { id: "transit", label: "Transit", Icon: TrainFront, run: () => app.go({ kind: "nearby" }, "half") },
    { id: "parking", label: "Parking", Icon: CircleParking, run: () => app.go({ kind: "parking" }, "half") },
    { id: "report", label: "Report", Icon: MapPinPlus, run: () => app.openReport(), accent: true },
  ];

  return (
    <div className="space-y-6 pb-2 pt-1">
      {desktop ? (
        <header className="space-y-4">
          <div>
            <h2 className="t-section">CrossMetric</h2>
            <p className="text-small text-app-muted">Map. Plan. Move. Safer routes, stronger communities.</p>
          </div>
          <button
            type="button"
            onClick={() => app.openPicker("destination")}
            className="cm-press flex h-[52px] w-full items-center gap-3 rounded-surface border border-app-line bg-app-surface px-4 text-left hover:border-app-line-strong"
            aria-label="Search: where to explore or check?"
          >
            <Search className="h-5 w-5 shrink-0 text-app-ink" strokeWidth={2.2} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-body text-app-muted">Where to explore or check?</span>
            <kbd className="rounded-tag border border-app-line px-1.5 text-meta text-app-muted">/</kbd>
          </button>
          {/* The time chip sits at the right end so its chooser opens inside the panel. */}
          <div className="flex items-center justify-end gap-2">
            <CampusChip campus={app.campus} onChange={app.setCampus} />
            <WhenChip timing={app.homeTiming} onChange={app.setHomeTiming} now={app.now} className="shrink-0" />
          </div>
        </header>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <p className="hidden min-w-0 flex-1 truncate text-small text-app-muted min-[400px]:block">
            <span className="font-medium text-app-ink">{greeting(app.now)}</span>
            {weather ? <span> · {weather}</span> : null}
          </p>
          <CampusChip campus={app.campus} onChange={app.setCampus} />
          <WhenChip timing={app.homeTiming} onChange={app.setHomeTiming} now={app.now} className="shrink-0" onOpen={() => app.setSnap("full")} />
        </div>
      )}

      <div className={`space-y-7 ${first ? "cm-deal" : ""}`}>
        <nav aria-label="Ways in" className="grid grid-cols-4 gap-2">
          {actions.map(({ id, label, Icon, run, accent }) => (
            <button key={id} type="button" onClick={run} className="cm-press group flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-surface border border-app-line bg-app-surface px-1 text-small font-medium hover:border-app-line-strong max-[359px]:text-meta">
              <span className={`grid h-9 w-9 place-items-center rounded-full ${accent ? "bg-app-accent text-app-on-accent" : "bg-app-chip text-app-ink"}`}>
                <Icon className="h-5 w-5" strokeWidth={2.1} aria-hidden />
              </span>
              <span className="max-w-full truncate">{label}</span>
            </button>
          ))}
        </nav>

        {dest || saved.length || recent.length ? (
          <section aria-label="Your trip and places">
            <ul className="divide-y divide-app-line">
              {dest ? (
                <li>
                  <PlaceRow icon={<MapPin className="h-5 w-5" aria-hidden />} title={dest.label} sub="Your route options are ready" onClick={() => app.go({ kind: "plan" }, "half")} strong />
                </li>
              ) : null}
              {saved.map((p) => {
                const Icon = KIND_ICON[p.kind];
                return (
                  <li key={p.id}>
                    <PlaceRow icon={<Icon className="h-5 w-5" aria-hidden />} title={p.name} sub={p.place.sublabel ?? p.place.label} onClick={() => go(p.place)} />
                  </li>
                );
              })}
              {recent.map((r) => (
                <li key={r.id + r.at}>
                  <PlaceRow
                    icon={<Clock3 className="h-5 w-5" aria-hidden />}
                    title={r.to.label}
                    sub={r.to.sublabel ?? `${"current" in r.from ? "From your location" : `From ${r.from.label}`} · ${dayLabel(r.at, app.now)}`}
                    onClick={() => {
                      const x = app.journey.restore(r, app.now);
                      if (x.needsLocation) void app.currentPlace().then((p) => p && app.journey.setOrigin(p));
                      app.go({ kind: "plan" }, "half");
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ComingUp app={app} />

        <NearYou app={app} />

        <BarriersNearby app={app} />

        <section aria-label="More from CrossMetric" className="space-y-1">
          <h3 className="t-component">More</h3>
          <ul className="divide-y divide-app-line">
            <li>
              <MoreRow Icon={Clock3} title="Arrive by a set time" sub="When to leave, where you may park, and a backup" onClick={() => app.openArrive()} />
            </li>
            <li>
              <MoreRow Icon={CarTaxiFront} title="Rideshare" sub="See the driving time, then open Uber or Lyft" onClick={() => app.searchFor("rideshare")} />
            </li>
            {app.campus ? (
              <li>
                <MoreRow Icon={Moon} title="Night travel" sub="Official escorts and safe rides on campus" onClick={() => app.go({ kind: "night" }, "half")} />
              </li>
            ) : null}
            <li>
              <MoreRow Icon={ShieldCheck} title="Safety toolkit" sub="Share a trip, call for help, CrossScore" onClick={() => app.go({ kind: "safety" }, "full")} />
            </li>
            <li>
              <MoreRow Icon={LayoutGrid} title="All services" sub="Walk, bike, drive, park & ride, classes, your car" onClick={() => app.go({ kind: "services" }, "full")} />
            </li>
          </ul>
        </section>

        <p className="text-small text-app-muted">No account. Your places and trips stay on this device; reports are anonymous.</p>
      </div>
    </div>
  );
}

function PlaceRow({ icon, title, sub, onClick, strong }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; strong?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="cm-press flex min-h-[60px] w-full items-center gap-3 text-left">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${strong ? "bg-app-route-bg text-app-route" : "bg-app-chip text-app-ink"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{title}</span>
        <span className="block truncate text-small text-app-muted">{sub}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-app-muted" aria-hidden />
    </button>
  );
}

function MoreRow({ Icon, title, sub, onClick }: { Icon: typeof Route; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="cm-press flex min-h-[60px] w-full items-center gap-3 text-left">
      <Icon className="h-5 w-5 shrink-0 text-app-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{title}</span>
        <span className="block truncate text-small text-app-muted">{sub}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-app-muted" aria-hidden />
    </button>
  );
}

/** The next class, when there is one, with an explicit "Arrive by". */
function ComingUp({ app }: { app: AppModel }) {
  const next = app.nextClass;
  const building = next?.buildingId ? app.buildings.get(next.buildingId) : null;
  if (!next || !building) return null;
  const rec = app.classPlan.plan?.recommended ?? null;
  const by = next.start - app.prefs.entryBufferMin * 60_000;
  return (
    <section className="rounded-surface border border-app-line bg-app-surface p-4" aria-label="Next class">
      <p className="flex items-center gap-2 text-small font-medium text-app-muted">
        <GraduationCap className="h-4 w-4" aria-hidden /> Coming up · {when(next.start, app.now)}
      </p>
      <p className="mt-1 truncate t-component">{next.title ?? building.name}</p>
      <p className="truncate text-small text-app-muted">
        {building.name}
        {rec?.leaveBy ? (
          <span className="tnum">
            {" "}
            · <span className="font-semibold text-app-ink">{leaveText(rec.leaveBy, app.now)}</span>
          </span>
        ) : null}
      </p>
      <button
        type="button"
        className="cm-press mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-ctl bg-app-chip px-4 text-small font-semibold hover:bg-app-chip-hover"
        onClick={() => {
          const e = building.entrances[0];
          app.openArrive({ destination: { label: building.name, lon: e?.lon ?? building.center[0], lat: e?.lat ?? building.center[1], source: "building", campus: app.campus, buildingId: building.id }, arriveBy: by });
        }}
      >
        Arrive by {clock(by)}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}

/** What is leaving near the person: scheduled times only (a timetable, never a live position). */
function NearYou({ app }: { app: AppModel }) {
  const stations = app.nearby.stations.slice(0, 2);
  const rows = stations
    .flatMap((s) => s.departures.slice(0, 2).map((d) => ({ s, d })))
    .sort((a, b) => a.d.time - b.d.time)
    .slice(0, 3);
  return (
    <section className="space-y-1" aria-label="Leaving near you">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-component">Leaving near you</h3>
        {stations.length ? (
          <TextButton onClick={() => app.go({ kind: "nearby" }, "half")} className="text-small">
            All stops
          </TextButton>
        ) : null}
      </div>
      {rows.length ? (
        <>
          <ul className="divide-y divide-app-line">
            {rows.map(({ s, d }) => {
              const min = Math.max(0, Math.round((d.time - app.now) / 60_000));
              return (
                <li key={`${s.id}-${d.route.short}-${d.time}`}>
                  <button
                    type="button"
                    onClick={() => {
                      app.nearby.select(s.id);
                      app.go({ kind: "nearby" }, "half");
                    }}
                    className="cm-press flex min-h-[60px] w-full items-center gap-3 text-left"
                  >
                    <BoardBadge route={d.route} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium leading-tight">{d.headsign || s.name}</span>
                      <span className="block truncate text-small text-app-muted">
                        {s.name}
                        {s.walkMin !== null ? ` · ${s.walkMin} min walk` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="t-num block text-component font-semibold leading-none text-app-teal">{min}</span>
                      <span className="mt-0.5 block text-meta text-app-muted">min</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-meta text-app-muted">Scheduled times from published timetables, not live vehicle positions.</p>
        </>
      ) : app.nearby.anchor ? (
        <p className="py-1 text-small text-app-muted">{app.nearby.loading ? "Looking for stations and stops…" : (app.nearby.coverage ?? "No scheduled departures within walking distance in the next hour.")}</p>
      ) : (
        <div className="flex items-center gap-3 py-1">
          <p className="min-w-0 flex-1 text-small text-app-muted">{app.locError ?? "See trains and buses leaving near you. Uses your location once; not stored."}</p>
          <button
            type="button"
            onClick={async () => {
              const p = await app.currentPlace();
              if (p) app.nearby.setAnchor(p);
            }}
            className="cm-press inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-ctl bg-app-chip px-3.5 text-small font-semibold hover:bg-app-chip-hover"
          >
            <LocateFixed className="h-4 w-4" aria-hidden />
            {app.locating ? "Finding you…" : "Use my location"}
          </button>
        </div>
      )}
    </section>
  );
}

/** Open barrier reports nearest the person (or the newest, before a location is known). */
function BarriersNearby({ app }: { app: AppModel }) {
  const all = app.community.reports;
  const anchor = app.nearby.anchor;
  const list: (CommunityReport & { m: number | null })[] = (all ?? [])
    .filter((r) => reportStatus(r) === "open")
    .map((r) => ({ ...r, m: anchor ? metres(anchor, r) : null }))
    .filter((r) => r.m === null || r.m <= 3219)
    .sort((a, b) => (a.m !== null && b.m !== null ? a.m - b.m : b.createdAt.localeCompare(a.createdAt)))
    .slice(0, 3);
  return (
    <section className="space-y-1" aria-label="Barriers reported nearby">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-component">{anchor ? "Barriers reported nearby" : "Recently reported barriers"}</h3>
        <TextButton onClick={() => app.go({ kind: "community" }, "half")} className="text-small">
          Community
        </TextButton>
      </div>
      {all === null ? (
        <p className="py-1 text-small text-app-muted" role="status">
          {app.community.error ?? (app.community.loading ? "Loading community reports…" : "Community reports load with a connection.")}
        </p>
      ) : list.length ? (
        <ul className="divide-y divide-app-line">
          {list.map((r) => (
            <li key={r.id}>
              <ReportRow
                report={r}
                detail={`${r.locationLabel ?? "Pinned on the map"} · ${r.m !== null ? `${r.m < 950 ? `${Math.round(r.m / 10) * 10} m` : `${(r.m / 1609).toFixed(1)} mi`} away` : timeAgo(r.createdAt, app.now)}`}
                onClick={() => app.go({ kind: "community", reportId: r.id }, "half")}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-3 py-1">
          <p className="min-w-0 flex-1 text-small text-app-muted">No open reports {anchor ? "within 2 miles" : "yet"}. Seen a blocked sidewalk or a missing curb ramp?</p>
          <button type="button" onClick={() => app.openReport()} className="cm-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-ctl bg-app-chip px-3.5 text-small font-semibold hover:bg-app-chip-hover">
            <MapPinPlus className="h-4 w-4" aria-hidden />
            Report
          </button>
        </div>
      )}
    </section>
  );
}

/** A route badge that stays readable on dark surfaces (dark route colours get a light chip). */
function BoardBadge({ route }: { route: { short: string; color?: string; text?: string; agency: string; long?: string } }) {
  const c = route.color && route.color !== "#000000" ? route.color : "#F5F8FC";
  const dark = /^#(0|1)[0-9a-f]/i.test(c) && c.toLowerCase() !== "#f5f8fc";
  const bg = dark ? "#F5F8FC" : c;
  const fg = dark ? "#07111F" : route.text || "#07111F";
  return (
    <span className="inline-flex h-[30px] min-w-[46px] shrink-0 items-center justify-center rounded-chip px-2 text-small font-semibold leading-none" style={{ background: bg, color: fg }} title={`${route.agency} ${route.long || route.short}`}>
      {route.short}
    </span>
  );
}

/** Optional campus context (buildings, campus parking, night services). Routes work anywhere in Georgia without one. */
function CampusChip({ campus, onChange }: { campus: CampusId | null; onChange: (c: CampusId | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" className="cm-press inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ctl border border-app-line px-3 text-small font-medium hover:bg-app-chip">
        <GraduationCap className="h-[18px] w-[18px]" aria-hidden />
        {campus ? CAMPUS_NAME[campus] : "Campus"}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="cm-reveal absolute right-0 top-full z-40 mt-2 w-64 rounded-surface border border-app-line bg-app-surface p-1.5 text-app-ink shadow-[var(--app-shadow-float)]">
          {([null, "gt", "uga"] as (CampusId | null)[]).map((c) => (
            <button
              key={c ?? "none"}
              role="menuitemradio"
              aria-checked={c === campus}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={`flex min-h-[46px] w-full items-center rounded-ctl px-3 text-left text-body ${c === campus ? "font-semibold" : "font-medium"} hover:bg-app-chip`}
            >
              {c ? CAMPUS_NAME[c] : "No campus"}
            </button>
          ))}
          <p className="px-3 pb-2 pt-1 text-meta text-app-muted">A campus adds its buildings, verified parking rules and night services. Routes work anywhere in Georgia.</p>
        </div>
      ) : null}
    </div>
  );
}
