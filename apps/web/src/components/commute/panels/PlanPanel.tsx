"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Clock3, CloudOff, ExternalLink, History, Info, ListFilter, LocateFixed, RefreshCw, Route, ServerCrash, SlidersHorizontal, TrainFront, WifiOff } from "lucide-react";
import { type JourneyMode, timingLabel } from "@crossmetric/engine/commute";
import { Glyph } from "@/components/brand/Glyph";
import { buildUberRideLink, readUberClientId } from "@/lib/uber";
import { PRIORITY_LABEL } from "@/lib/journey-client";
import { MODE_LABEL } from "@/lib/journey-types";
import { clock, duration, distance, tz, when } from "../format";
import { useRecentSearches } from "@/lib/commute-store";
import { dayLabel } from "../format";
import { JourneyFields, MODE_CHIP_LABEL, ModeChips, ModeSummary, OverrideChips, PriorityPicker, priorityOf, prioritySettings, RouteCard, RouteCardSkeleton, TimingControl, type RoutePriority } from "../journey-ui";
import type { AppModel } from "../model";
import { Notice, PanelHeader, PrimaryButton, SecondaryButton, StateMessage, TextButton } from "../ui";
import { Disclosure } from "./common";

function lyftLink(o: { lat: number; lon: number }, d: { lat: number; lon: number }): string {
  const p = new URLSearchParams({ id: "lyft", "pickup[latitude]": o.lat.toFixed(6), "pickup[longitude]": o.lon.toFixed(6), "destination[latitude]": d.lat.toFixed(6), "destination[longitude]": d.lon.toFixed(6) });
  return `https://lyft.com/ride?${p.toString()}`;
}

/** Route planner and comparison: where from, where to, when, how — then the options for exactly that. */
export function PlanPanel({ app }: { app: AppModel }) {
  const j = app.journey;
  // Once both ends are set the trip form folds away to "from …" on the line under the title (the
  // map shows both ends), so the first options sit right under it, as in Uber's "Choose a ride".
  const [editing, setEditing] = useState(false);
  const showForm = editing || !j.origin || !j.destination || !!j.timingError;
  const setShowForm = setEditing;
  const travel = app.prefs.travel;
  const toggleMode = (m: JourneyMode) => {
    const on = j.prefs.modes[m];
    app.setPrefs((p) => ({ ...p, travel: { ...p.travel, modes: { ...p.travel.modes, [m]: !on } } }));
    if (j.overrides) j.setOverrides({ ...j.overrides, modesOff: on ? j.overrides.modesOff : j.overrides.modesOff.filter((x) => x !== m), modesOn: on ? j.overrides.modesOn.filter((x) => x !== m) : j.overrides.modesOn });
  };
  const prefsSummary = [j.prefs.maxWalkMin ? `walk ≤ ${j.prefs.maxWalkMin} min` : null, j.prefs.maxTransfers !== null ? `≤ ${j.prefs.maxTransfers} transfers` : null, app.prefs.hasCar ? null : "no car"].filter(Boolean).join(" · ") || "Walking, transfers, car";
  // The four priorities set the saved travel preferences (and clear what a typed request set for this search).
  const setPriority = (r: RoutePriority | null) => {
    const next = prioritySettings(r);
    app.setPrefs((p) => ({ ...p, travel: { ...p.travel, ...next } }));
    if (j.overrides && (j.overrides.priority !== null || j.overrides.accessible)) j.setOverrides({ ...j.overrides, priority: null, accessible: false });
  };
  const originNote = j.origin?.source === "saved" && app.prefs.origin && j.origin.label === app.prefs.origin.label ? "Saved start" : j.origin?.source === "current" ? "Your location" : null;
  // "Leave now · 6 options · from …" sits under the title; an out-of-date notice stays above the list.
  const statusInHeader = !showForm && !!j.result && j.phase !== "loading" && j.phase !== "stale";

  return (
    <div className="space-y-3 pt-1">
      <PanelHeader
        title={j.destination && !showForm ? <span className="line-clamp-1 [overflow-wrap:anywhere]">To {j.destination.label}</span> : "Plan a route"}
        sub={statusInHeader ? <StatusLine app={app} onEdit={() => setShowForm(true)} /> : j.destination ? undefined : "Choose where you're going, then compare the options."}
        action={j.destination && !showForm ? <TextButton onClick={() => setShowForm(true)}>Edit</TextButton> : undefined}
      />
      {showForm || !j.destination ? (
        <section aria-label="Trip" className="space-y-3 rounded-surface border border-app-line bg-app-surface p-3.5">
          <JourneyFields origin={j.origin} destination={j.destination} onOrigin={() => app.openPicker("origin")} onDestination={() => app.openPicker("destination")} onSwap={j.swap} originNote={originNote} />
          <TimingControl timing={j.timing} onChange={j.setTiming} now={app.now} error={j.timingError} />
          {j.offerTiming ? (
            <p className="flex flex-wrap items-center gap-2 text-small text-app-muted">
              Planned for leaving now.
              <TextButton onClick={() => j.setTiming(j.offerTiming!)}>Use the original time ({timingLabel(j.offerTiming, app.now, tz).replace(/^(Depart|Arrive by) /, "")})</TextButton>
            </p>
          ) : null}
          <ModeChips modes={j.prefs.modes} onToggle={toggleMode} hasCar={app.prefs.hasCar} />
          <OverrideChips items={j.overrides?.understood ?? []} onClear={() => j.setOverrides(null)} />
          <button type="button" onClick={() => app.go({ kind: "prefs" }, "full")} className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-ctl px-1 text-left text-small hover:bg-app-chip">
            <span className="inline-flex items-center gap-2 font-medium">
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Limits
            </span>
            <span className="truncate text-app-muted">{prefsSummary}</span>
          </button>
          {j.destination && j.origin && !j.result && !j.loading && j.phase !== "error" ? (
            <PrimaryButton onClick={() => j.run()} icon={<Route className="h-5 w-5" aria-hidden />} disabled={!j.request}>
              Find routes
            </PrimaryButton>
          ) : null}
        </section>
      ) : null}

      {j.destination ? <PriorityPicker value={priorityOf(j.prefs)} onChange={setPriority} /> : null}

      <Results app={app} onCollapse={() => setShowForm(false)} statusInHeader={statusInHeader} travelChanged={travel !== app.prefs.travel} />
    </div>
  );
}

function Results({ app, onCollapse, statusInHeader }: { app: AppModel; onCollapse: () => void; statusInHeader: boolean; travelChanged: boolean }) {
  const j = app.journey;
  const r = j.result;
  const phase = j.phase;
  // Like Uber's list, rows open with the recommended one highlighted but closed; a row shows its
  // journey bar, facts and CrossScore once it is tapped (or picked by its mode chip). Keyed to the
  // result, so a new search starts closed again.
  const [opened, setOpened] = useState<{ at: number; id: string } | null>(null);
  // A short list first: the best match and two alternatives; the rest on request.
  const [showAll, setShowAll] = useState<number | null>(null);

  if (phase === "needs_destination") return <RecentRoutes app={app} />;
  if (phase === "needs_origin") {
    return (
      <StateMessage
        icon={<LocateFixed className="h-5 w-5" />}
        title="Where are you starting?"
        action={
          <>
            <SecondaryButton
              icon={<LocateFixed className="h-4 w-4" aria-hidden />}
              onClick={async () => {
                const p = await app.currentPlace();
                if (p) j.setOrigin(p);
              }}
            >
              {app.locating ? "Finding you…" : "Use my location"}
            </SecondaryButton>
            <SecondaryButton onClick={() => app.openPicker("origin")}>Choose a start</SecondaryButton>
          </>
        }
      >
        {app.locError ?? (app.locationPermission === "denied" ? "Location is blocked for this site. Enter a start instead." : "CrossMetric only uses your location when you ask, and does not store it.")}
      </StateMessage>
    );
  }
  if (phase === "loading") {
    return (
      <div className="space-y-2" aria-busy="true">
        <div className="relative h-[3px] overflow-hidden rounded-full bg-app-chip" aria-hidden>
          <span className="cm-indeterminate absolute inset-y-0 left-0 w-1/2 rounded-full bg-app-primary" />
        </div>
        <p className="pt-1 text-small leading-snug text-app-muted" role="status">
          <span className="font-semibold text-app-ink">Finding routes…</span> Checking walking, driving and timetabled transit for {timingLabel(j.timing, app.now, tz).toLowerCase()}.
        </p>
        <RouteCardSkeleton />
        <RouteCardSkeleton delay={120} />
        <RouteCardSkeleton delay={240} />
      </div>
    );
  }
  if ((phase === "error" || phase === "offline") && !r) return <ErrorState app={app} />;
  if (!r) return null;

  const dim = phase === "updating" || phase === "stale" || ((phase === "error" || phase === "offline") && !j.cachedAt);
  const arriveMode = r.timing.mode === "arrive";
  const pick = (id: string) => {
    j.select(id);
    setOpened({ at: r.generatedAt, id });
    onCollapse();
    // The opened row grows downwards; keep all of it above the footer.
    requestAnimationFrame(() => document.getElementById(`cm-option-${id}`)?.scrollIntoView({ block: "nearest", behavior: app.reducedMotion ? "auto" : "smooth" }));
  };
  return (
    <section aria-label="Route options" className="space-y-3">
      {statusInHeader ? null : <StatusLine app={app} />}
      {phase === "error" || phase === "offline" ? <ErrorState app={app} compact /> : null}
      {r.notes.some(important) ? (
        <ul className="space-y-1">
          {r.notes.filter(important).slice(0, 2).map((n) => (
            <li key={n}>
              <Notice tone={/unavailable/i.test(n) ? "amber" : "gray"} icon={/unavailable/i.test(n) ? <CloudOff className="h-4 w-4" /> : undefined}>
                {n}
              </Notice>
            </li>
          ))}
        </ul>
      ) : null}

      {arriveMode && r.timing.mode === "arrive" && j.destination?.buildingId ? (
        <button type="button" onClick={() => app.openArrive({ destination: j.destination!, arriveBy: r.timing.mode === "arrive" ? r.timing.by : undefined })} className="cm-press flex min-h-[48px] w-full items-center gap-2 rounded-ctl bg-app-chip px-3 text-left text-small font-medium hover:bg-app-chip-hover">
          <Clock3 className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Open the ArriveBy plan: leave-by time, parking for your permit and a backup</span>
        </button>
      ) : null}
      {r.rideshare && j.origin && j.destination && app.searchIntent === "rideshare" ? <RideshareCard app={app} drive={r.rideshare} /> : null}
      {r.options.length ? (
        <>
        <ul className={`cm-stagger -mx-1 space-y-1 transition-opacity duration-200 ${dim ? "pointer-events-none opacity-50" : ""}`} aria-label="Options" aria-busy={phase === "updating" || undefined}>
          {(showAll === r.generatedAt ? r.options : r.options.filter((o, i) => i < 3 || o.id === j.selected?.id)).map((o) => (
            <li key={o.id} id={`cm-option-${o.id}`} className="scroll-mt-2">
              <RouteCard
                o={o}
                selected={j.selected?.id === o.id}
                expanded={j.selected?.id === o.id && opened?.at === r.generatedAt && opened.id === o.id}
                onSelect={() => pick(o.id)}
                arriveMode={arriveMode}
                now={app.now}
                generatedAt={r.generatedAt}
                showAccess={j.prefs.accessible}
                disabled={dim}
              />
            </li>
          ))}
        </ul>
        {r.options.length > 3 && showAll !== r.generatedAt ? (
          <button type="button" onClick={() => setShowAll(r.generatedAt)} className="cm-press flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-ctl text-small font-medium text-app-muted hover:bg-app-chip hover:text-app-ink">
            <ChevronDown className="h-4 w-4" aria-hidden />
            {r.options.length - 3} more {r.options.length - 3 === 1 ? "option" : "options"}
          </button>
        ) : null}
        </>
      ) : r.late ? (
        <div className="space-y-2">
          <StateMessage tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={`Nothing arrives by ${clock(arriveMode && r.timing.mode === "arrive" ? r.timing.by : r.late.option.arriveAt)}`}>
            Leaving now, the earliest arrival is {clock(r.late.option.arriveAt)}
            {r.late.lateMin > 0 ? `, about ${r.late.lateMin} min late` : ""}.
          </StateMessage>
          <RouteCard o={r.late.option} selected={false} onSelect={() => undefined} arriveMode={false} now={app.now} showAccess={j.prefs.accessible} disabled />
        </div>
      ) : (
        <StateMessage
          tone="warn"
          icon={<ListFilter className="h-5 w-5" />}
          title="No route fits your preferences"
          action={<SecondaryButton onClick={() => app.go({ kind: "prefs" }, "full")}>Change preferences</SecondaryButton>}
        >
          {r.excluded.length ? `${r.excluded.length} ${r.excluded.length === 1 ? "option was" : "options were"} left out by your limits (listed below).` : r.coverage.transitSummary ?? "No walking, driving or transit route was found between these places at this time."}
        </StateMessage>
      )}

      {/* Below the list, so the first rows fill the half-open sheet. */}
      {r.options.length && !dim ? <ModeSummary options={r.options} selectedId={j.selected?.id ?? null} onPick={(o) => pick(o.id)} /> : null}
      {r.tradeoffs.length && !dim ? <Notice tone="gray" icon={<Info className="h-4 w-4" />}>{r.tradeoffs[0]}</Notice> : null}
      {r.coverage.transitSummary && r.options.length ? <Notice tone="gray" icon={<TrainFront className="h-4 w-4" />}>{r.coverage.transitSummary}</Notice> : null}

      {r.rideshare && j.origin && j.destination && app.searchIntent !== "rideshare" ? <RideshareCard app={app} drive={r.rideshare} /> : null}

      {r.excluded.length ? (
        <Disclosure summary={`Left out by your preferences (${r.excluded.length})`}>
          <ul className="space-y-2">
            {r.excluded.map((e, i) => (
              <li key={i}>
                <span className="font-medium text-app-ink">{e.title}</span>
                <span className="block">{e.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      <Disclosure summary="How these are compared">
        <ul className="list-disc space-y-1 pl-4">
          <li>Best match follows your priority ({PRIORITY_LABEL[j.prefs.priority].toLowerCase()}) among options at most {r.toleranceMin} min slower than the fastest. Labels appear only when an option is clearly different.</li>
          <li>Times are planning estimates. Driving has no live traffic, so a buffer is added. Transit uses published timetables, not live vehicle positions.</li>
          <li>Costs are shown only when known: transit fares, gas when you have entered mpg and a gas price, and campus parking from verified rules. Parking at other destinations is not included.</li>
          {r.coverage.safety ? <li>{r.coverage.safety}</li> : <li>No safety comparison was available for these options.</li>}
          {r.notes.filter((n) => !important(n)).map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            Transit timetables:{" "}
            {r.coverage.transit
              .filter((c) => c.agencies.length)
              .map((c) => c.agencies.join(", "))
              .join("; ")}
            .
          </li>
        </ul>
      </Disclosure>
    </section>
  );
}

/** Before a destination: the trips searched recently on this device, to run again in one tap. */
function RecentRoutes({ app }: { app: AppModel }) {
  const [recents] = useRecentSearches();
  const list = app.prefs.keepHistory ? recents.slice(0, 4) : [];
  if (!list.length) return <p className="text-small text-app-muted">Any address or place in Georgia, a saved place, or a Georgia Tech or UGA building. Search keeps no history unless you allow it in Account.</p>;
  return (
    <section aria-label="Recent routes" className="space-y-1">
      <h3 className="t-component">Recent</h3>
      <ul className="divide-y divide-app-line">
        {list.map((r) => (
          <li key={r.id + r.at}>
            <button
              type="button"
              onClick={() => {
                const x = app.journey.restore(r, app.now);
                if (x.needsLocation) void app.currentPlace().then((p) => p && app.journey.setOrigin(p));
              }}
              className="cm-press flex min-h-[60px] w-full items-center gap-3 text-left"
            >
              <History className="h-5 w-5 shrink-0 text-app-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{r.to.label}</span>
                <span className="block truncate text-small text-app-muted">
                  {"current" in r.from ? "From your location" : `From ${r.from.label}`} · {dayLabel(r.at, app.now)}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => app.go({ kind: "activity" }, "full")} className="inline-flex min-h-[40px] items-center text-small font-medium text-app-route hover:underline">
        Your past trips
      </button>
    </section>
  );
}

/** Notes that change what you can do (a service is down, a weather alert); the rest go under "How these are compared". */
const important = (n: string) => /unavailable|in effect|Driving is off/i.test(n);

function StatusLine({ app, onEdit }: { app: AppModel; onEdit?: () => void }) {
  const j = app.journey;
  const r = j.result!;
  const o = j.origin;
  const d = j.destination;
  const age = Math.max(0, Math.round((app.now - r.generatedAt) / 60_000));
  if (j.phase === "updating")
    return (
      <p className="flex items-center gap-2 text-small font-medium text-app-muted" role="status">
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> Updating for your changes…
      </p>
    );
  if (j.phase === "stale")
    return (
      <Notice tone="amber" icon={<RefreshCw className="h-4 w-4" />}>
        <span className="flex flex-wrap items-center gap-2">
          {r.timing.mode === "now" ? `These times are from ${when(r.generatedAt, app.now)} and are out of date.` : "This time has passed. Choose a new time or Leave now."}
          {r.timing.mode === "now" ? (
            <button type="button" className="min-h-[32px] font-semibold underline" onClick={() => j.run()}>
              Refresh
            </button>
          ) : null}
        </span>
      </Notice>
    );
  const modes = (Object.keys(j.prefs.modes) as JourneyMode[]).filter((m) => j.prefs.modes[m]).map((m) => MODE_LABEL[m]).join(", ");
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-small text-app-muted" role="status">
      <span className="font-medium text-app-ink">{r.timingLabel}</span>
      <span>· {r.options.length} {r.options.length === 1 ? "option" : "options"}</span>
      {j.cachedAt ? <span>· saved {when(j.cachedAt, app.now)}</span> : j.phase === "aging" ? (
        <>
          <span>· times from {age} min ago</span>
          <button type="button" onClick={() => j.run()} className="min-h-[32px] font-medium text-app-route hover:underline">
            Refresh
          </button>
        </>
      ) : null}
      {onEdit && o && d ? (
        // Takes what is left of the line (a long start is cut short rather than adding a line).
        <span className="flex min-w-[6rem] flex-1 items-center gap-1 overflow-hidden">
          <span aria-hidden>·</span>
          <button type="button" onClick={onEdit} aria-label={`Change trip: from ${o.label} to ${d.label}, ${timingLabel(j.timing, app.now, tz)} · ${modes}`} className="-my-1.5 min-h-[32px] min-w-0 truncate text-left hover:text-app-ink hover:underline">
            from {o.label}
          </button>
        </span>
      ) : null}
    </p>
  );
}

function ErrorState({ app, compact }: { app: AppModel; compact?: boolean }) {
  const j = app.journey;
  const e = j.error;
  const offline = !app.online || e?.offline;
  if (offline)
    return (
      <StateMessage tone="warn" icon={<WifiOff className="h-5 w-5" />} title="You're offline" action={<SecondaryButton onClick={() => j.run()}>Try again</SecondaryButton>}>
        {j.cachedAt ? `Showing the result saved on this device at ${when(j.cachedAt, app.now)}. It may be out of date.` : compact ? "These results are for your previous inputs." : "Routes need a connection. Saved places and your settings still work."}
      </StateMessage>
    );
  if (e?.field === "timing") return <StateMessage tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title="Check the time">{e.error}</StateMessage>;
  return (
    <StateMessage tone="error" icon={<ServerCrash className="h-5 w-5" />} title={e?.kind === "invalid" ? "Check this trip" : "Routes couldn't be calculated"} action={e?.kind === "invalid" ? undefined : <SecondaryButton onClick={() => j.run()}>Try again</SecondaryButton>}>
      {e?.error ?? "Something went wrong."}
      {compact ? " The options below are for your previous inputs." : ""}
    </StateMessage>
  );
}

/**
 * Ride-hail hand-off, as a row in the options: CrossMetric shows the driving time
 * only; the provider's own app shows prices and pickup times and books the ride.
 */
function RideshareCard({ app, drive }: { app: AppModel; drive: { driveMin: number; distanceM: number } }) {
  const j = app.journey;
  const o = j.origin!;
  const d = j.destination!;
  const uber = buildUberRideLink({ pickup: { latitude: o.lat, longitude: o.lon, name: o.source === "current" ? undefined : o.label }, dropoff: { latitude: d.lat, longitude: d.lon, name: d.label }, clientId: readUberClientId() });
  const btn = "cm-press inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-ctl px-4 text-small font-medium";
  return (
    <section aria-label="Rideshare" className="space-y-2.5 rounded-surface border border-app-line px-3 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center text-app-ink [--glyph-cut:var(--app-surface)]">
          <Glyph name="rideshare" className="h-8 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold leading-snug">Rideshare</p>
          <p className="text-small text-app-muted">Uber or Lyft · price and pickup in their app</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="t-num text-component font-semibold leading-snug">{duration(drive.driveMin)}</p>
          <p className="t-num text-small text-app-muted">{distance(drive.distanceM)} + pickup</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-[52px]">
        {uber.ok ? (
          <a href={uber.url} target="_blank" rel="noopener noreferrer" className={`${btn} bg-app-primary text-app-on-primary hover:bg-app-primary-hover`}>
            Open Uber <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : (
          <span className={`${btn} border border-dashed border-app-line-strong font-medium text-app-muted`} title="Needs NEXT_PUBLIC_UBER_CLIENT_ID">
            Uber hand-off not set up
          </span>
        )}
        <a href={lyftLink(o, d)} target="_blank" rel="noopener noreferrer" className={`${btn} bg-app-chip hover:bg-app-chip-hover`}>
          Open Lyft <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
      <p className="pl-[52px] text-small text-app-muted">Driving time only. CrossMetric doesn&rsquo;t book rides or see their prices.</p>
    </section>
  );
}

/** The Uber app's one bold action under the list: choose the selected option. */
export function PlanFooter({ app }: { app: AppModel }) {
  const j = app.journey;
  if (!j.selected || !j.actionable) return null;
  const o = j.selected;
  return (
    <div className="flex items-center gap-2">
      <PrimaryButton onClick={() => app.go({ kind: "detail" }, "full")} className="flex-1" aria-label={`Choose ${MODE_CHIP_LABEL[o.kind]}: ${duration(o.durationMin)}, arrive ${clock(o.arriveAt)}`}>
        Choose {MODE_CHIP_LABEL[o.kind]}
      </PrimaryButton>
    </div>
  );
}
