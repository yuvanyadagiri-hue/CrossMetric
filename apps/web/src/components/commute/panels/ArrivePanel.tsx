"use client";

import { useId, useRef, useState } from "react";
import { Accessibility, AlertTriangle, CircleParking, Clock3, ExternalLink, Info, ListChecks, LocateFixed, MapPin, Navigation, RefreshCw, ServerCrash, ShieldAlert, WifiOff } from "lucide-react";
import { addDays, instantToLocalInputs, localDate, localInputsToInstant, suggestedTime, zonedToUtc, type ArrivalComponent, type ArrivalPlan, type ArrivePreference, type ComparisonRow, type ParkingAssessment } from "@crossmetric/engine/commute";
import { accessText, provenanceLine, rangeText, STATUS_WORD, usablePlace, VERDICT_LABEL } from "@/lib/arriveby-format";
import type { CampusId } from "@/lib/commute-types";
import { clock, dayLabel, duration, leaveText, tz, usd, when } from "../format";
import { ModeTile, optionTitle } from "../journey-ui";
import type { AppModel } from "../model";
import { Chip, Notice, PanelHeader, PrimaryButton, Segmented, SecondaryButton, StateMessage, TextButton, Toggle } from "../ui";
import { Disclosure, listRow } from "./common";

export { arriveParkingStatus } from "@/lib/arriveby-format";

const PREFER_OPTIONS: [ArrivePreference, string][] = [
  ["best", "Best"],
  ["drive", "Drive"],
  ["transit", "Transit"],
  ["walk", "Walk"],
];

const CAMPUS_NAME: Record<CampusId, string> = { gt: "Georgia Tech", uga: "UGA" };

/**
 * ArriveBy: "I need to be at this building by this time." One plan with the leave-by
 * time first, the parts it is made of, where you may park with your permit, a backup,
 * and the other ways to arrive in time. Every time on screen comes from the plan; data
 * that is missing is said to be missing.
 */
export function ArrivePanel({ app }: { app: AppModel }) {
  const a = app.arrive;
  const incomplete = a.phase === "needs_destination" || a.phase === "needs_origin" || a.phase === "needs_time" || a.phase === "passed";
  // Opened with everything chosen (a class, an arrive-by search) the plan comes first; otherwise the
  // form stays open while the plan appears under it, until Done, so it never folds away mid-edit.
  const editing = a.formOpen;
  const setEditing = a.setFormOpen;
  const showForm = editing || incomplete;
  const root = useRef<HTMLDivElement>(null);
  // Folding the inputs away brings the plan's first line (the leave-by time) back into view.
  const done = () => {
    setEditing(false);
    requestAnimationFrame(() => root.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0, behavior: app.reducedMotion ? "auto" : "smooth" }));
  };
  return (
    <div ref={root} className="space-y-4 pt-1">
      <PanelHeader title="Arrive by" sub={showForm ? "When to leave, where to park, and a backup." : <Summary app={app} onEdit={() => setEditing(true)} />} onBack={app.back} action={!showForm ? <TextButton onClick={() => setEditing(true)} className="!text-app-ink underline">Edit</TextButton> : undefined} />
      {showForm ? <ArriveForm app={app} onDone={!incomplete ? done : undefined} /> : null}
      <ArriveResult app={app} />
    </div>
  );
}

function Summary({ app, onEdit }: { app: AppModel; onEdit: () => void }) {
  const a = app.arrive;
  const from = app.journey.origin;
  return (
    <button type="button" onClick={onEdit} className="-my-1 min-h-[32px] max-w-full truncate text-left hover:text-app-ink hover:underline" aria-label={`Change: ${a.destination?.label ?? ""}, arrive by ${when(a.arriveBy, app.now)}, from ${from?.label ?? "no start"}`}>
      <span className="font-medium text-app-ink">By {when(a.arriveBy, app.now)}</span> · from {from ? (from.source === "current" ? "your location" : from.label) : "—"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function ArriveForm({ app, onDone }: { app: AppModel; onDone?: () => void }) {
  const a = app.arrive;
  const origin = app.journey.origin;
  const field = "cm-press flex min-h-[52px] w-full items-center rounded-surface bg-app-chip px-3.5 text-left text-body transition-colors hover:bg-app-chip-hover";
  const today = localDate(app.now, tz);
  const tomorrow9 = zonedToUtc(addDays(today, 1), 9 * 60, tz);
  const next = app.nextClass;
  const nextBuilding = next?.buildingId ? app.buildings.get(next.buildingId) : null;
  const nextBy = next ? next.start - app.prefs.entryBufferMin * 60_000 : null;
  return (
    <section aria-label="Your arrival" className="space-y-3 rounded-surface border border-app-line bg-app-surface p-3">
      {!app.campus ? <CampusChoice app={app} /> : null}
      <div className="flex items-stretch gap-2">
        <div className="flex w-5 flex-col items-center py-[19px]" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-app-ink" />
          <span className="my-1 w-[2px] flex-1 bg-app-ink" />
          <span className="h-2.5 w-2.5 bg-app-ink" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <button type="button" onClick={() => app.openPicker("origin")} className={field} aria-label={`Start: ${origin?.label ?? "not set"}. Change start`}>
            <span className="min-w-0">
              <span className={`block truncate ${origin ? "font-medium text-app-ink" : "text-app-muted"}`}>{origin ? (origin.source === "current" ? "Current location" : origin.label) : "Choose a start"}</span>
            </span>
          </button>
          <button type="button" onClick={() => app.openPicker("arrive")} className={field} aria-label={`Destination: ${a.destination?.label ?? "not set"}. Change destination`}>
            <span className="min-w-0">
              <span className={`block truncate ${a.destination ? "font-medium text-app-ink" : "text-app-muted"}`}>{a.destination?.label ?? "Which building?"}</span>
              {a.destination && !a.destination.buildingId ? <span className="block truncate text-meta text-app-muted">Not a mapped campus building: routes go to this point</span> : null}
            </span>
          </button>
        </div>
      </div>

      <ArrivalTime app={app} />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Quick arrival times">
        {next && nextBuilding && nextBy && nextBy > app.now ? (
          <Chip
            onClick={() => {
              const e = nextBuilding.entrances[0];
              a.setDestination({ label: nextBuilding.name, lon: e?.lon ?? nextBuilding.center[0], lat: e?.lat ?? nextBuilding.center[1], source: "building", campus: app.campus, buildingId: nextBuilding.id });
              a.setArriveBy(nextBy);
            }}
          >
            Next class · {when(nextBy, app.now)}
          </Chip>
        ) : null}
        <Chip onClick={() => a.setArriveBy(suggestedTime(app.now, 60))}>In about an hour</Chip>
        <Chip onClick={() => a.setArriveBy(tomorrow9)}>Tomorrow 9:00 AM</Chip>
      </div>

      <Segmented label="How do you want to get there?" value={a.prefer} options={PREFER_OPTIONS.filter(([v]) => v !== "drive" || app.prefs.hasCar)} onChange={a.setPrefer} />
      {app.prefs.hasCar && app.campus ? <PermitField app={app} /> : null}
      <MoreOptions app={app} />
      {onDone ? (
        <SecondaryButton onClick={onDone} className="w-full">
          Done
        </SecondaryButton>
      ) : null}
    </section>
  );
}

function CampusChoice({ app }: { app: AppModel }) {
  return (
    <div className="space-y-2">
      <p className="text-small font-medium">Which campus? Buildings, parking rules and campus transit depend on it.</p>
      <div className="flex gap-2">
        {(["gt", "uga"] as CampusId[]).map((c) => (
          <SecondaryButton key={c} onClick={() => app.setCampus(c)} className="flex-1">
            {CAMPUS_NAME[c]}
          </SecondaryButton>
        ))}
      </div>
    </div>
  );
}

function ArrivalTime({ app }: { app: AppModel }) {
  const a = app.arrive;
  const dateId = useId();
  const timeId = useId();
  const v = instantToLocalInputs(a.arriveBy, tz);
  const deviceTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
  const set = (date: string, time: string) => {
    const r = localInputsToInstant(date, time, tz);
    if (r) a.setArriveBy(r.at);
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-small font-medium">Be there by</legend>
      <div className="grid grid-cols-[1.25fr_1fr] gap-2">
        <label htmlFor={dateId} className="sr-only">
          Arrival date
        </label>
        <input id={dateId} type="date" value={v.date} min={localDate(app.now, tz)} onChange={(e) => set(e.target.value, v.time)} className="h-12 rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body text-app-ink" />
        <label htmlFor={timeId} className="sr-only">
          Arrival time
        </label>
        <input id={timeId} type="time" value={v.time} onChange={(e) => set(v.date, e.target.value)} className="h-12 rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body text-app-ink" />
      </div>
      <p className="text-small text-app-muted">
        {when(a.arriveBy, app.now)}
        {deviceTz !== tz ? " · Georgia time (ET)" : ""}
      </p>
      {a.timingError ? (
        <p role="alert" className="text-small font-medium text-app-red">
          {a.timingError.replace(" or Leave now", "")}
        </p>
      ) : null}
    </fieldset>
  );
}

const PERMIT = /^[A-Z0-9-]{2,12}$/;

function PermitField({ app }: { app: AppModel }) {
  const listId = useId();
  const inputId = useId();
  const [text, setText] = useState<string | null>(null);
  const permits = app.prefs.permits;
  const codes = (app.bundle?.parking ?? []).map((p) => p.code);
  const save = (raw: string) => {
    const next = raw
      .split(/[,\s]+/)
      .map((p) => p.trim().toUpperCase())
      .filter((p) => PERMIT.test(p))
      .slice(0, 6);
    app.setPrefs((p) => ({ ...p, permits: next }));
    setText(null);
  };
  if (text === null) {
    return (
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        <span className="min-w-0 text-body">
          <span className="block font-medium">Parking permit</span>
          <span className="block truncate text-small text-app-muted">{permits.length ? permits.join(", ") : "None: visitor parking only"}</span>
        </span>
        <TextButton onClick={() => setText(permits.join(", "))}>{permits.length ? "Change" : "Add"}</TextButton>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-small font-medium">
        Permit area code{app.campus === "gt" ? " (for example W23)" : " (for example S09)"}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          autoFocus
          list={listId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save(text)}
          placeholder="Leave empty if you have none"
          className="h-12 min-w-0 flex-1 rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body uppercase"
        />
        <SecondaryButton onClick={() => save(text)}>Save</SecondaryButton>
      </div>
      <datalist id={listId}>
        {codes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p className="mt-1 text-small text-app-muted">A code that matches no place CrossMetric has rules for is treated as no permit.</p>
    </div>
  );
}

function MoreOptions({ app }: { app: AppModel }) {
  const a = app.arrive;
  const untilId = useId();
  const arrival = instantToLocalInputs(a.arriveBy, tz);
  const until = a.parkUntil ? instantToLocalInputs(a.parkUntil, tz) : null;
  const accessible = app.prefs.travel.accessible;
  return (
    <Disclosure summary={<span className="text-small">More options{a.parkUntil || accessible ? ` · ${[a.parkUntil ? `leaving ${clock(a.parkUntil)}` : null, accessible ? "step-free" : null].filter(Boolean).join(", ")}` : ""}</span>}>
      <div className="space-y-3 text-app-ink">
        {app.prefs.hasCar && app.campus ? (
          <div>
            <label htmlFor={untilId} className="mb-1 block text-small font-medium">
              Leaving campus at (checks parking for your whole stay)
            </label>
            <div className="flex gap-2">
              <input
                id={untilId}
                type="time"
                value={until?.time ?? ""}
                onChange={(e) => {
                  if (!e.target.value) return a.setParkUntil(null);
                  const r = localInputsToInstant(arrival.date, e.target.value, tz);
                  // The same day as the arrival; a time before it means the next morning.
                  if (r) a.setParkUntil(r.at > a.arriveBy ? r.at : r.at + 86_400_000);
                }}
                className="h-12 min-w-0 flex-1 rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body"
              />
              {a.parkUntil ? <SecondaryButton onClick={() => a.setParkUntil(null)}>Clear</SecondaryButton> : null}
            </div>
            {a.parkUntil ? <p className="mt-1 text-small text-app-muted">Until {when(a.parkUntil, app.now)}</p> : null}
          </div>
        ) : null}
        <Toggle
          label="Step-free route"
          detail="Uses OpenStreetMap's wheelchair profile. CrossMetric says what it can't confirm."
          checked={accessible}
          onChange={(v) => app.setPrefs((p) => ({ ...p, travel: { ...p.travel, accessible: v } }))}
        />
      </div>
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function ArriveResult({ app }: { app: AppModel }) {
  const a = app.arrive;
  const phase = a.phase;
  if (phase === "needs_destination") {
    return (
      <StateMessage icon={<MapPin className="h-5 w-5" />} title="Which building do you need to be at?" action={<SecondaryButton onClick={() => app.openPicker("arrive")}>Choose a building</SecondaryButton>}>
        Search by name or short name (Klaus, CULC, Tate), or tap a building on the map.
      </StateMessage>
    );
  }
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
                if (p) app.journey.setOrigin(p);
              }}
            >
              {app.locating ? "Finding you…" : "Use my location"}
            </SecondaryButton>
            <SecondaryButton onClick={() => app.openPicker("origin")}>Choose a start</SecondaryButton>
          </>
        }
      >
        {app.locError ?? (app.locationPermission === "denied" ? "Location is blocked for this site. Choose a start instead." : "Your location is used only when you ask, and is not stored.")}
      </StateMessage>
    );
  }
  if (phase === "needs_time" || phase === "passed") return null;
  if (phase === "loading") return <Loading app={app} />;
  if ((phase === "error" || phase === "offline") && !a.result) return <ErrorState app={app} />;
  const plan = a.plan;
  const r = a.result;
  if (!plan || !r) return null;
  const dim = phase === "updating" || (phase === "error" && !a.current);
  return (
    <div className={`space-y-4 transition-opacity duration-200 ${dim ? "pointer-events-none opacity-50" : ""}`} aria-busy={phase === "updating" || undefined}>
      {phase === "updating" ? (
        <p className="flex items-center gap-2 text-small font-medium text-app-muted" role="status">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> Updating for your changes…
        </p>
      ) : null}
      {phase === "error" || phase === "offline" ? <ErrorState app={app} compact /> : null}
      {phase === "stale" ? (
        <Notice tone="amber" icon={<RefreshCw className="h-4 w-4" />}>
          <span className="flex flex-wrap items-center gap-2">
            Planned {when(r.generatedAt, app.now)}; times may have changed.
            <button type="button" className="min-h-[32px] font-semibold underline" onClick={() => a.run()}>
              Refresh
            </button>
          </span>
        </Notice>
      ) : null}
      {r.notes.filter((n) => /unavailable|in effect/i.test(n)).map((n) => (
        <Notice key={n} tone="amber">
          {n}
        </Notice>
      ))}
      {plan.notices.map((n) => (
        <Notice key={n} tone="amber" icon={<Info className="h-4 w-4" />}>
          {n}
        </Notice>
      ))}
      {plan.parking?.firstChoiceIssue && plan.primary?.kind === "drive" ? (
        <Notice tone="gray" icon={<CircleParking className="h-4 w-4" />}>
          {plan.parking.firstChoiceIssue.name} is closest but can&rsquo;t be used ({plan.parking.firstChoiceIssue.reason.replace(/\.$/, "")}). This plan uses {plan.parking.primary?.name}.
        </Notice>
      ) : null}

      {plan.status === "ok" && plan.primary ? (
        <>
          <DecisionCard app={app} plan={plan} />
          <ConfidenceNote plan={plan} />
          <BackupCard app={app} plan={plan} />
          <Compare app={app} plan={plan} />
          {plan.parking ? <ParkingList app={app} plan={plan} /> : null}
          {plan.access.requested ? <AccessNote plan={plan} /> : null}
          <HowItWorks app={app} plan={plan} />
        </>
      ) : plan.status === "late" && plan.late ? (
        <Late app={app} plan={plan} />
      ) : (
        <StateMessage tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title="No way to arrive was found">
          <ul className="mt-1 space-y-1">
            {r.basis.unavailable.map((u) => (
              <li key={u.kind}>{u.reason.replace(/\.$/, "")}.</li>
            ))}
          </ul>
        </StateMessage>
      )}
      {plan.status !== "ok" && plan.parking ? <ParkingList app={app} plan={plan} /> : null}
    </div>
  );
}

function Loading({ app }: { app: AppModel }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="relative h-[3px] overflow-hidden rounded-full bg-app-chip" aria-hidden>
        <span className="cm-indeterminate absolute inset-y-0 left-0 w-1/2 rounded-full bg-app-primary" />
      </div>
      <p className="text-small leading-snug text-app-muted" role="status">
        <span className="font-semibold text-app-ink">Working out when to leave…</span> Checking roads, campus parking rules and timetables for {when(app.arrive.arriveBy, app.now)}.
      </p>
      <div className="h-[208px] animate-pulse rounded-surface bg-app-chip" aria-hidden />
    </div>
  );
}

function ErrorState({ app, compact }: { app: AppModel; compact?: boolean }) {
  const a = app.arrive;
  const e = a.error;
  if (a.phase === "offline" || e?.offline)
    return (
      <StateMessage tone="warn" icon={<WifiOff className="h-5 w-5" />} title="You're offline" action={<SecondaryButton onClick={() => a.run()}>Try again</SecondaryButton>}>
        {compact ? "The plan below is for your previous inputs." : "Planning an arrival needs a connection. Your saved places and settings still work."}
      </StateMessage>
    );
  return (
    <StateMessage tone="error" icon={<ServerCrash className="h-5 w-5" />} title={e?.kind === "invalid" ? "Check this arrival" : "Your arrival couldn't be planned"} action={e?.kind === "invalid" ? undefined : <SecondaryButton onClick={() => a.run()}>Try again</SecondaryButton>}>
      {e?.error ?? "Something went wrong."}
      {compact ? " The plan below is for your previous inputs." : ""}
    </StateMessage>
  );
}

function windowLine(plan: ArrivalPlan): string {
  const w = plan.primary!.window;
  if (w.fixedBy === "timetable") {
    const [lo, hi] = w.arrive;
    return `On the timetable you arrive ${clock(lo)}${hi - lo >= 60_000 ? `–${clock(hi)}` : ""}${w.spareMin >= 1 ? `, ${w.spareMin} min to spare` : ""}.`;
  }
  if (w.latestIfSmooth && w.latestIfSmooth > w.leaveBy) return `With clear roads${plan.primary!.components.some((c) => c.kind === "park_search") ? " and a quick space" : ""}, ${clock(w.latestIfSmooth)} would still work.`;
  return "Walking times don't depend on traffic.";
}

function DecisionCard({ app, plan }: { app: AppModel; plan: ArrivalPlan }) {
  const p = plan.primary!;
  const o = app.arrive.option(p.optionId);
  const w = p.window;
  const lot = plan.parking?.primary && p.kind === "drive" ? plan.parking.primary : null;
  const leaveDay = dayLabel(w.leaveBy, app.now);
  return (
    <section aria-label="Your plan" className="cm-on-dark rounded-surface bg-[#07111F] p-4 [--glyph-cut:#07111F]">
      <p className="text-small text-app-muted">
        Arrive by <span className="tnum font-medium text-app-ink">{clock(plan.deadline)}</span>
        {dayLabel(plan.deadline, app.now) !== "Today" ? ` ${dayLabel(plan.deadline, app.now)}` : ""} · {plan.destination.label}
      </p>
      <h3 className="mt-2 t-page leading-none">
        <span className="sr-only">Recommended: </span>Leave by <span className="t-num">{clock(w.leaveBy)}</span>
      </h3>
      <p className="mt-2 text-small text-app-muted">
        <span className="font-medium text-app-ink">{leaveDay === "Today" ? leaveText(w.leaveBy, app.now) : `${leaveDay}`}</span> · {windowLine(plan)}
      </p>

      <div className="mt-4 flex items-center gap-3 border-t border-app-line pt-3">
        <ModeTile kind={p.kind} tone="accent" size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold [overflow-wrap:anywhere]">{o ? optionTitle(o) : p.title}</p>
          <p className="text-small text-app-muted">{p.costUsd !== null ? (p.costUsd === 0 ? "Free" : `About ${usd(p.costUsd)}`) : p.costNote}</p>
        </div>
        <p className="t-num shrink-0 text-right text-component font-semibold">{rangeText(w.total)}</p>
      </div>

      <dl className="mt-3 space-y-2.5 border-t border-app-line pt-3" aria-label="Breakdown">
        {p.components.map((c, i) => (
          <ComponentRow key={i} c={c} />
        ))}
      </dl>

      {lot ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-app-line pt-3 text-small">
          <CircleParking className="h-4 w-4 shrink-0 text-uber" aria-hidden />
          <span className="font-medium text-app-ink">
            {lot.name} · {accessText(lot.access, lot.code)}
          </span>
          <span className="text-app-muted">{lot.price !== null && plan.parking?.stayChecked ? `${usd(lot.price)} for your stay · ` : ""}{lot.occupancy.label}</span>
        </p>
      ) : null}
      {plan.destination.entrance ? (
        <p className="mt-2 flex items-center gap-2 text-small text-app-muted">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          To the {plan.destination.entrance.label.toLowerCase()}
          {plan.destination.entrance.kind !== "centre" ? " (mapped in OpenStreetMap)" : ""}
        </p>
      ) : null}
    </section>
  );
}

function ComponentRow({ c }: { c: ArrivalComponent }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <dt className="text-body font-medium text-app-ink">{c.label}</dt>
        <dd className="text-small text-app-muted [overflow-wrap:anywhere]">
          {c.detail ? `${c.detail} · ` : ""}
          {STATUS_WORD[c.provenance.status].toLowerCase()}
        </dd>
      </div>
      <dd className="t-num shrink-0 pt-0.5 text-body font-medium">{rangeText(c.minutes)}</dd>
    </div>
  );
}

function ConfidenceNote({ plan }: { plan: ArrivalPlan }) {
  const c = plan.confidence;
  const icon = c.level === "uncertain" ? <ShieldAlert className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />;
  return (
    <div className="space-y-2">
      <Disclosure
        summary={
          <span className="flex items-center gap-2 text-small">
            <span aria-hidden className={c.level === "uncertain" ? "text-app-amber" : "text-app-muted"}>
              {icon}
            </span>
            <span>
              <span className="font-semibold text-app-ink">{c.headline}</span>
              <span className="text-app-muted"> · why</span>
            </span>
          </span>
        }
      >
        <ul className="list-disc space-y-1 pl-4">
          {c.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Disclosure>
      {c.extraMin > 0 && plan.primary ? (
        <Notice tone="amber">
          Leaving by {clock(plan.primary.window.leaveBy - c.extraMin * 60_000)} gives you a {c.extraMin}-minute margin.
        </Notice>
      ) : null}
    </div>
  );
}

function BackupCard({ app, plan }: { app: AppModel; plan: ArrivalPlan }) {
  const a = app.arrive;
  const b = plan.backup;
  const primaryLot = plan.primary?.kind === "drive" ? plan.parking?.primary : null;
  const title = b.kind === "place" && primaryLot ? `If ${primaryLot.name} is full` : "Backup plan";
  let name: string;
  let action: React.ReactNode = null;
  if (b.kind === "place") {
    name = b.name;
    action = (
      <SecondaryButton onClick={() => a.choosePlace(b.placeId)} className="min-h-[40px] px-4 text-small">
        Use {b.name}
      </SecondaryButton>
    );
  } else if (b.kind === "option") {
    const o = a.option(b.optionId);
    name = o ? optionTitle(o) : b.title;
    action = (
      <SecondaryButton onClick={() => a.setPrefer(b.mode)} className="min-h-[40px] px-4 text-small">
        Plan with this instead
      </SecondaryButton>
    );
  } else if (b.kind === "rideshare") {
    name = "Rideshare drop-off";
  } else {
    name = "No verified backup";
  }
  return (
    <section aria-label="Backup plan" className="space-y-2 rounded-surface border border-app-line p-3">
      <p className="text-small font-medium text-app-muted">{title}</p>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-body font-semibold [overflow-wrap:anywhere]">{name}</p>
        {"leaveBy" in b && b.leaveBy ? <p className="t-num shrink-0 text-body font-semibold">Leave by {clock(b.leaveBy)}</p> : null}
      </div>
      <p className="text-small text-app-muted">{b.text}</p>
      {action ? <div className="pt-1">{action}</div> : null}
    </section>
  );
}

function Compare({ app, plan }: { app: AppModel; plan: ArrivalPlan }) {
  const a = app.arrive;
  if (plan.comparison.length < 2) return null;
  return (
    <section aria-label="Other ways to arrive in time" className="space-y-1">
      <h3 className="t-component">Other ways to arrive in time</h3>
      <ul>
        {plan.comparison.map((row) => (
          <li key={row.optionId} className={listRow(row.chosen)}>
            <CompareRow app={app} row={row} onPick={() => a.setPrefer(row.kind)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompareRow({ app, row, onPick }: { app: AppModel; row: ComparisonRow; onPick: () => void }) {
  const o = app.arrive.option(row.optionId);
  return (
    <button type="button" onClick={onPick} aria-pressed={row.chosen} className="cm-press flex min-h-[64px] w-full items-center gap-3 py-2 text-left">
      <ModeTile kind={row.kind} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{o ? optionTitle(o) : row.title}</span>
        <span className="block text-small text-app-muted">{row.versus}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="t-num block text-body font-semibold">{clock(row.leaveBy)}</span>
        <span className="t-num block text-small text-app-muted">{rangeText(row.total)}</span>
      </span>
    </button>
  );
}

function ParkingList({ app, plan }: { app: AppModel; plan: ArrivalPlan }) {
  const pk = plan.parking!;
  const [open, setOpen] = useState<string | null>(null);
  const permits = pk.permits.matched.length ? `your permit ${pk.permits.matched.join(", ")}` : "no permit (visitor)";
  return (
    <section aria-label="Parking near the building" className="space-y-1">
      <h3 className="t-component">Parking near {plan.destination.label}</h3>
      <p className="text-small text-app-muted">
        Checked for {pk.stayChecked && app.arrive.parkUntil ? `your stay until ${clock(app.arrive.parkUntil)}` : `arriving ${clock(plan.deadline)}`} with {permits}. Posted signs and official rules take precedence.
      </p>
      {pk.emptyReason ? (
        <Notice tone="amber" icon={<CircleParking className="h-4 w-4" />}>
          {pk.emptyReason}
        </Notice>
      ) : null}
      <ul>
        {pk.places.map((p) => (
          <li key={p.placeId} className="border-b border-app-line last:border-b-0">
            <ParkingRow app={app} p={p} open={open === p.placeId} onToggle={() => setOpen((x) => (x === p.placeId ? null : p.placeId))} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const VERDICT_TONE: Record<ParkingAssessment["verdict"], string> = {
  recommended: "bg-app-accent text-app-on-accent",
  backup: "bg-app-strong text-app-on-strong",
  eligible: "bg-app-teal-bg text-app-teal",
  uncertain: "bg-app-gray-bg text-app-gray",
  restricted: "bg-app-red-bg text-app-red",
  closed: "bg-app-red-bg text-app-red",
  full: "bg-app-amber-bg text-app-amber",
  unavailable: "bg-app-gray-bg text-app-gray",
};

function ParkingRow({ app, p, open, onToggle }: { app: AppModel; p: ParkingAssessment; open: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className="cm-press flex min-h-[60px] w-full items-center gap-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body font-medium">{p.name}</span>
            <span className={`inline-flex h-6 items-center rounded-tag px-2 text-meta font-semibold ${VERDICT_TONE[p.verdict]}`}>{VERDICT_LABEL[p.verdict]}</span>
          </span>
          <span className="block truncate text-small text-app-muted">{usablePlace(p) ? accessText(p.access, p.code) : p.reason}</span>
        </span>
        <span className="t-num shrink-0 text-right text-small text-app-muted">{p.walkMin !== null ? `${p.walkMin} min walk` : "—"}</span>
      </button>
      {open ? (
        <div id={id} className="space-y-2 pb-3 text-small text-app-muted">
          {p.total && p.leaveBy ? (
            <p>
              Leave by <span className="t-num font-medium text-app-ink">{clock(p.leaveBy)}</span> through here · {rangeText(p.total)} door to entrance
            </p>
          ) : null}
          <p>
            <span className="font-medium text-app-ink">Rules: </span>
            {p.reason}
            {p.usableUntil && usablePlace(p) ? ` · usable until ${when(p.usableUntil, app.now)}` : ""}
            {p.nextChange ? ` · from ${clock(p.nextChange.at)}: ${p.nextChange.reason.toLowerCase()}` : ""}
          </p>
          {p.payment ? <p>Payment: {p.payment}</p> : null}
          {p.price !== null && app.arrive.parkUntil ? <p>Price for your stay: {usd(p.price)}</p> : null}
          <p>
            <span className="font-medium text-app-ink">Source: </span>
            {p.rules.url ? (
              <a href={p.rules.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-app-ink underline decoration-app-line-strong underline-offset-2">
                {provenanceLine(p.rules)}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              provenanceLine(p.rules)
            )}
          </p>
          <p>
            <span className="font-medium text-app-ink">Spaces: </span>
            {p.occupancy.label} ({p.occupancy.provenance.label.toLowerCase()})
          </p>
          {usablePlace(p) && p.verdict !== "recommended" ? (
            <SecondaryButton onClick={() => app.arrive.choosePlace(p.placeId)} className="min-h-[40px] px-4 text-small">
              Plan with {p.name}
            </SecondaryButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AccessNote({ plan }: { plan: ArrivalPlan }) {
  const x = plan.access;
  return (
    <section aria-label="Step-free access" className="space-y-2 rounded-surface bg-app-amber-bg p-3 text-app-amber">
      <p className="flex items-center gap-2 text-small font-semibold">
        <Accessibility className="h-4 w-4 shrink-0" aria-hidden />
        {x.summary}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-small">
        {[...x.mapped, ...x.gaps].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

function HowItWorks({ app, plan }: { app: AppModel; plan: ArrivalPlan }) {
  const p = plan.primary!;
  const r = app.arrive.result!;
  const highs = p.components.filter((c) => c.minutes.high > 0);
  const sum = highs.reduce((s, c) => s + c.minutes.high, 0);
  const sources = [...new Set([...p.components.map((c) => provenanceLine(c.provenance)), ...(plan.parking?.primary ? [provenanceLine(plan.parking.primary.rules)] : []), ...(plan.destination.entrance ? [provenanceLine(plan.destination.entrance.provenance)] : [])])];
  return (
    <Disclosure summary={<span className="text-small">How this plan is worked out</span>}>
      <div className="space-y-2">
        <p className="t-num text-app-ink">
          {clock(plan.deadline)} − ({highs.map((c) => `${Math.round(c.minutes.high)} ${c.label.toLowerCase()}`).join(" + ")}) = leave by {clock(p.window.leaveBy)}
          {Math.abs(plan.deadline - sum * 60_000 - p.window.leaveBy) > 60_000 ? " (times are rounded)" : ""}
        </p>
        <p>Each part is counted once. Ranges run from the quick case (clear roads, a space right away) to the planned case, which is what the leave-by time uses. Times have no live traffic and transit uses published timetables, not live vehicle positions. Space availability isn&rsquo;t published, so a space is never promised.</p>
        <p className="font-medium text-app-ink">Where the numbers come from</p>
        <ul className="list-disc space-y-1 pl-4">
          {sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
          {r.mapDataDate ? <li>Buildings, entrances and parking shapes: OpenStreetMap extract of {r.mapDataDate}</li> : null}
        </ul>
        <p className="flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" aria-hidden /> Planned {when(r.generatedAt, app.now)}. Nothing about this trip is stored.
        </p>
      </div>
    </Disclosure>
  );
}

function Late({ app, plan }: { app: AppModel; plan: ArrivalPlan }) {
  const a = app.arrive;
  const late = plan.late!;
  const o = a.option(late.optionId);
  // A later time that the earliest arrival meets, rounded up to five minutes.
  const later = Math.ceil((late.arriveAt + 60_000) / 300_000) * 300_000;
  return (
    <StateMessage tone="warn" icon={<AlertTriangle className="h-5 w-5" />} title={`Nothing gets you there by ${clock(plan.deadline)}`} action={<SecondaryButton onClick={() => a.setArriveBy(later)}>Plan for {clock(later)} instead</SecondaryButton>}>
      Leaving now{o ? ` by ${optionTitle(o).toLowerCase()}` : ""}, the earliest arrival is {clock(late.arriveAt)}
      {late.lateMin > 0 ? `, about ${duration(late.lateMin)} late` : ""}.
    </StateMessage>
  );
}

/** The one action under the plan: start the step-by-step guide for it. */
export function ArriveFooter({ app }: { app: AppModel }) {
  const a = app.arrive;
  const p = a.plan?.primary;
  const o = p ? a.option(p.optionId) : null;
  if (!p || !o || a.plan?.status !== "ok") return null;
  if (a.phase === "stale") {
    return (
      <PrimaryButton onClick={() => a.run()} icon={<RefreshCw className="h-5 w-5" aria-hidden />}>
        Refresh plan
      </PrimaryButton>
    );
  }
  if (!a.current || a.phase !== "ready") return null;
  const d = a.destination;
  return (
    <div className="space-y-1">
      <PrimaryButton
        icon={<Navigation className="h-5 w-5" aria-hidden />}
        onClick={() => {
          const from = app.journey.origin ? (app.journey.origin.source === "current" ? "Your location" : app.journey.origin.label) : undefined;
          app.startTrip({ id: o.id, title: o.title, kind: o.kind, legs: o.legs, parking: o.parking, costUsd: o.costUsd }, { campus: d?.campus ?? app.campus, buildingId: d?.buildingId ?? "", destLabel: d?.label, fromLabel: from });
        }}
      >
        Start trip · leave by {clock(p.window.leaveBy)}
      </PrimaryButton>
      <p className="text-center text-meta text-app-muted">Step-by-step guide you confirm as you go — not turn-by-turn navigation.</p>
    </div>
  );
}
