"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Car, ChevronRight, ExternalLink, GraduationCap, SlidersHorizontal } from "lucide-react";
import { instantToLocalInputs, localDate, localInputsToInstant, suggestedTime } from "@crossmetric/engine/commute";
import type { CampusBundle, ParkingPlaceInfo, ParkingResult } from "@/lib/commute-types";
import { clock, tz, usd, when } from "../format";
import type { useParking } from "../hooks";
import type { AppModel } from "../model";
import { Chip, EligibilityBadge, IconButton, Notice, PanelHeader, PrimaryButton, SecondaryButton, Skeleton, StateMessage } from "../ui";
import { Disclosure, SourceLinks } from "./common";

const NEAR_M = 2200;

/** Parking places near the destination (or the whole campus without one). */
export function visibleParking(bundle: CampusBundle | null, results: Map<string, ParkingResult>, near: [number, number] | null): ParkingPlaceInfo[] {
  if (!bundle) return [];
  if (!near) return bundle.parking;
  const k = Math.cos((near[1] * Math.PI) / 180);
  return bundle.parking.filter((p) => Math.hypot((p.center[0] - near[0]) * k, p.center[1] - near[1]) * 111_195 <= NEAR_M || results.get(p.id)?.status === "allowed");
}

const RANK = { allowed: 0, requires_action: 1, unknown: 2, prohibited: 3 } as const;

/** The badge text: "$0 · Eligible until 5 PM", "$12 · Pay at exit", "Permit required", "Rules unknown". */
function badgeText(r: ParkingResult, place: ParkingPlaceInfo): string {
  if (r.status === "allowed") {
    const until = r.mode === "stay" ? r.usableUntil : (r.nextChange?.at ?? null);
    return `$0 · Eligible${until ? ` until ${clock(until)}` : ""}`;
  }
  if (r.status === "requires_action") {
    const how = (place.payment ?? r.reason).split(" · ")[0];
    return r.price !== null ? `${usd(r.price)} · ${how}` : r.mode === "now" ? `Pay · ${how}` : `Pay · rate not published`;
  }
  return r.reason;
}

type Filter = "all" | "free" | "cheapest";

export function ParkingPanel({
  app,
  parking,
  results,
  near,
}: {
  app: AppModel;
  parking: ReturnType<typeof useParking>;
  results: Map<string, ParkingResult>;
  near: [number, number] | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [mine, setMine] = useState(false);
  const [shortWalk, setShortWalk] = useState(false);
  const selectedId = app.view.kind === "parking" ? (app.view.placeId ?? null) : null;
  const bundle = app.bundle;

  const list = useMemo(() => {
    const places = visibleParking(bundle, results, near).filter((p) => results.has(p.id));
    let rows = places.map((p) => ({ p, r: results.get(p.id)! }));
    if (mine) rows = rows.filter(({ p }) => app.prefs.permits.some((x) => x.toUpperCase() === p.code.toUpperCase()));
    if (shortWalk) rows = rows.filter(({ r }) => r.walkMin !== null && r.walkMin <= 10);
    if (filter === "free") rows = rows.filter(({ r }) => r.status === "allowed");
    if (filter === "cheapest") rows = rows.filter(({ r }) => r.status === "allowed" || r.status === "requires_action");
    return rows.sort((a, b) => {
      if (filter === "cheapest") {
        const pa = a.r.status === "allowed" ? 0 : (a.r.price ?? Infinity);
        const pb = b.r.status === "allowed" ? 0 : (b.r.price ?? Infinity);
        if (pa !== pb) return pa - pb;
      }
      return RANK[a.r.status] - RANK[b.r.status] || (a.r.walkMin ?? 99) - (b.r.walkMin ?? 99);
    });
  }, [bundle, results, near, filter, mine, shortWalk, app.prefs.permits]);

  if (selectedId && bundle) {
    const place = bundle.parking.find((p) => p.id === selectedId);
    const r = results.get(selectedId);
    if (place) return <ParkingDetail app={app} place={place} result={r ?? null} list={list} />;
  }

  const title = app.destBuilding ? `Parking near ${app.destBuilding.name}` : `Parking at ${bundle?.shortName ?? "campus"}`;
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-start gap-1">
        <IconButton label="Back" onClick={() => window.history.back()} className="-ml-2">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="t-section [overflow-wrap:anywhere]">{title}</h2>
          <ParkingTimes app={app} />
        </div>
      </div>

      {app.journey.destination && !near ? (
        <Notice tone="gray">
          {app.journey.destination.label} isn&rsquo;t on the {bundle?.shortName ?? "campus"} map. CrossMetric has verified parking rules only for Georgia Tech and UGA, so parking near it isn&rsquo;t listed. Campus places are shown below.
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Parking filters">
        <Chip active={filter === "free"} onClick={() => setFilter(filter === "free" ? "all" : "free")}>
          Free
        </Chip>
        <Chip active={filter === "cheapest"} onClick={() => setFilter(filter === "cheapest" ? "all" : "cheapest")}>
          Cheapest
        </Chip>
        <Chip active={showFilters || mine || shortWalk} aria-expanded={showFilters} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />} onClick={() => setShowFilters((v) => !v)}>
          Filters
        </Chip>
      </div>
      {showFilters ? (
        <div className="flex flex-wrap gap-4 text-body">
          <label className="inline-flex min-h-[44px] items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-[var(--app-ink)]" checked={mine} onChange={(e) => setMine(e.target.checked)} disabled={!app.prefs.permits.length} />
            My permit{app.prefs.permits.length ? ` (${app.prefs.permits.join(", ")})` : " (none set)"}
          </label>
          <label className="inline-flex min-h-[44px] items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-[var(--app-ink)]" checked={shortWalk} onChange={(e) => setShortWalk(e.target.checked)} />
            Walk ≤10 min
          </label>
        </div>
      ) : null}

      {parking.error ? <Notice tone="gray">{parking.error}</Notice> : null}
      {parking.loading || !parking.data ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : list.length ? (
        <ul className="divide-y divide-app-line" aria-label="Parking places">
          {list.slice(0, app.snap === "rest" ? 2 : 40).map(({ p, r }) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => app.go({ kind: "parking", placeId: p.id }, app.snap === "rest" ? "half" : app.snap)}
                className="cm-press flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium [overflow-wrap:anywhere]">{p.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <EligibilityBadge status={r.status}>{badgeText(r, p)}</EligibilityBadge>
                  </span>
                </span>
                {r.walkMin !== null ? (
                  <span className="t-num shrink-0 text-right">
                    <span className="block text-component font-semibold leading-tight">{r.walkMin}</span>
                    <span className="block text-small text-app-muted">min walk</span>
                  </span>
                ) : null}
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-app-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : filter === "free" ? (
        <div className="space-y-2">
          <p className="text-body font-medium">No verified free parking</p>
          <SecondaryButton onClick={() => setFilter("cheapest")}>Show cheapest</SecondaryButton>
        </div>
      ) : (
        <p className="text-body text-app-muted">No parking places match.</p>
      )}

      {parking.data && app.snap !== "rest" ? (
        <Disclosure summary="About these rules">
          <ul className="list-disc space-y-1 pl-4">
            {parking.data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

/**
 * Parking times: when you arrive at the lot and until when you stay. Separate from
 * the route search's time. A stay end before the arrival is reported, never moved
 * to another day; a suggestion from today's classes is only applied when chosen.
 */
function ParkingTimes({ app }: { app: AppModel }) {
  const t = app.parkingTiming;
  const [editing, setEditing] = useState(false);
  const arrive = t.at ?? app.now;
  const today = localDate(app.now, tz);
  const ends = app.occurrences.filter((o) => o.date === today && o.end > app.now && o.status !== "cancelled" && !o.remote).map((o) => o.end);
  const suggestion = ends.length ? Math.max(...ends) + 15 * 60_000 : null;
  const initial = instantToLocalInputs(t.until ?? suggestedTime(arrive, 120), tz);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState<string | null>(null);
  if (editing) {
    return (
      <form
        className="mt-2 space-y-2 rounded-ctl bg-app-chip p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const r = localInputsToInstant(date, time, tz);
          if (!r) return setError("Choose a valid date and time.");
          if (r.at <= arrive + 60_000) return setError("The end of your stay must be after you arrive.");
          app.setParkingTiming({ ...t, until: r.at, untilSource: "chosen" });
          setError(null);
          setEditing(false);
        }}
      >
        <p className="text-small font-medium text-app-ink">Staying until</p>
        <div className="grid grid-cols-[1.25fr_1fr] gap-2">
          <label className="sr-only" htmlFor="park-until-date">
            Date
          </label>
          <input id="park-until-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-chip border border-app-line-strong bg-app-surface px-3 text-body" />
          <label className="sr-only" htmlFor="park-until">
            Time
          </label>
          <input id="park-until" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11 rounded-chip border border-app-line-strong bg-app-surface px-3 text-body" />
        </div>
        {error ? (
          <p role="alert" className="text-small font-medium text-app-red">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="submit" className="h-11 flex-1 rounded-chip bg-app-primary px-4 text-body font-semibold text-app-on-primary hover:bg-app-primary-hover">
            Set
          </button>
          <button type="button" onClick={() => setEditing(false)} className="h-11 rounded-chip px-3 text-body text-app-muted">
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="mt-0.5 space-y-0.5 text-small text-app-muted">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span>Arriving {t.at ? <span className="tnum font-medium text-app-ink">{when(t.at, app.now)}</span> : "now"}</span>
        <span aria-hidden>·</span>
        {t.until ? (
          <span>
            staying until <span className="tnum font-medium text-app-ink">{when(t.until, app.now)}</span>
            {t.untilSource === "class" ? " (after your last class)" : ""}
          </span>
        ) : (
          <span>stay not set</span>
        )}
        <button type="button" onClick={() => setEditing(true)} className="min-h-[36px] font-medium text-app-route">
          {t.until ? "Edit" : "Set stay"}
        </button>
        {t.until ? (
          <button type="button" onClick={() => app.setParkingTiming({ ...t, until: null, untilSource: null })} className="min-h-[36px] font-medium text-app-muted">
            Clear
          </button>
        ) : null}
      </p>
      {!t.until ? <p>Only the rules at arrival are checked.</p> : null}
      {!t.until && suggestion && suggestion > arrive ? (
        <button type="button" onClick={() => app.setParkingTiming({ ...t, until: suggestion, untilSource: "class" })} className="min-h-[36px] text-left font-medium text-app-route">
          Use {clock(suggestion)} (15 min after your last class today)
        </button>
      ) : null}
    </div>
  );
}

/** Campus tools need a campus; routes do not. */
export function CampusPrompt({ app, what }: { app: AppModel; what: string }) {
  return (
    <div className="space-y-3 pt-1">
      <PanelHeader title={what} onBack={app.back} />
      <StateMessage
        icon={<GraduationCap className="h-5 w-5" />}
        title="Choose a campus"
        action={
          <>
            <SecondaryButton onClick={() => app.setCampus("gt")}>Georgia Tech</SecondaryButton>
            <SecondaryButton onClick={() => app.setCampus("uga")}>UGA</SecondaryButton>
          </>
        }
      >
        Hand-verified records cover Georgia Tech and UGA. Other places in Georgia aren&rsquo;t covered yet; routes still work everywhere.
      </StateMessage>
    </div>
  );
}

function ParkingDetail({
  app,
  place,
  result: r,
  list,
}: {
  app: AppModel;
  place: ParkingPlaceInfo;
  result: ParkingResult | null;
  list: { p: ParkingPlaceInfo; r: ParkingResult }[];
}) {
  const usable = r && (r.status === "allowed" || r.status === "requires_action");
  const backup = list.find((x) => x.p.id !== place.id && (x.r.status === "allowed" || x.r.status === "requires_action"));
  // Directions: a new search to this parking place (Leave now), preferring driving.
  const directions = () => {
    app.journey.startSearch(
      { label: place.name, sublabel: "Parking", lon: place.center[0], lat: place.center[1], source: "place" },
      { overrides: { modesOff: [], modesOn: [], prefer: ["drive"], priority: null, maxTransfers: null, accessible: false, understood: ["Prefer driving"] } },
    );
    if (!app.journey.origin && app.origin) app.journey.setOrigin({ ...app.origin, source: "saved" });
    app.go({ kind: "plan" }, "half");
  };
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-start gap-1">
        <IconButton label="Back to list" onClick={() => app.go({ kind: "parking", placeId: null }, app.snap)} className="-ml-2">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="text-component font-semibold leading-tight [overflow-wrap:anywhere]">{place.name}</h2>
          <p className="text-small text-app-muted">
            {[place.code !== place.name ? place.code : null, place.label, r?.walkMin != null && app.destBuilding ? `~${r.walkMin} min walk to ${app.destBuilding.name}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {r ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <EligibilityBadge status={r.status}>{badgeText(r, place)}</EligibilityBadge>
            {r.mode === "stay" && app.parkUntil ? <span className="text-small text-app-muted">for your stay until {clock(app.parkUntil)}</span> : <span className="text-small text-app-muted">{app.parkingTiming.at ? "rules at arrival" : "rules now"}</span>}
          </div>
          {r.nextChange ? (
            <p className="text-small text-app-muted">
              From {clock(r.nextChange.at)}: <span className="font-medium text-app-ink">{r.nextChange.reason}</span>
            </p>
          ) : null}
          {/registered/i.test(r.reason) || r.reason === "Vehicle registration not set" ? <p className="text-small text-app-muted">Registration is free and is not a permit. Set it in Settings.</p> : null}
        </div>
      ) : (
        <Skeleton className="h-6 w-48" />
      )}

      <div className="grid grid-cols-2 gap-2">
        <PrimaryButton onClick={directions} disabled={!usable} icon={<Car className="h-5 w-5" aria-hidden />} className="!min-h-[48px] text-body">
          Directions
        </PrimaryButton>
        <SecondaryButton onClick={() => backup && app.go({ kind: "parking", placeId: backup.p.id }, app.snap)} disabled={!backup}>
          Backup
        </SecondaryButton>
      </div>

      <Disclosure summary="Rules & source">
        {r ? (
          <div className="space-y-2">
            {r.reviewBy < localDate(app.now, tz) ? <p className="font-medium text-app-amber">These rules are past their re-check date, so they show as unknown.</p> : null}
            <SourceLinks sources={app.bundle?.sources ?? {}} ids={r.sourceIds} />
            {app.prefs.permits.length ? <p>Permit rules use the permit you entered.</p> : null}
            <p>
              Map shape: {app.bundle?.osm.attribution}.{" "}
              <a href={`https://www.openstreetmap.org/${place.osm[0] ?? ""}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                View <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </p>
          </div>
        ) : null}
      </Disclosure>
    </div>
  );
}
