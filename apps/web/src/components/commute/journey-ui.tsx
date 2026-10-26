"use client";

import { useId, type ReactNode } from "react";
import { Accessibility, ArrowUpDown, Bike, Bus, Car, CircleDollarSign, CircleParking, Clock3, Footprints, MapPin, ShieldCheck, SquareParking, Timer, TrainFront, X } from "lucide-react";
import { instantToLocalInputs, LEAVE_NOW, localDate, localInputsToInstant, ROLE_LABEL, suggestedTime, type JourneyMode, type RoleId, type TripTiming } from "@crossmetric/engine/commute";
import type { PlanLeg } from "@/lib/commute-types";
import type { JourneyOption, JourneyPlace } from "@/lib/journey-types";
import { Glyph, type GlyphName } from "@/components/brand/Glyph";
import { clock, distance, duration, lineName, metersLabel, tz, usd, when } from "./format";
import { RouteBadge } from "./panels/common";
import { Chip, IconButton, RoleBadge, Segmented } from "./ui";

export const MODE_ICON: Record<JourneyMode, (cls: string) => ReactNode> = {
  walk: (c) => <Footprints className={c} aria-hidden />,
  bike: (c) => <Bike className={c} aria-hidden />,
  transit: (c) => <TrainFront className={c} aria-hidden />,
  drive: (c) => <Car className={c} aria-hidden />,
  park_ride: (c) => <SquareParking className={c} aria-hidden />,
};

export const MODE_CHIP_LABEL: Record<JourneyMode, string> = { walk: "Walk", transit: "Transit", drive: "Drive", park_ride: "Park & ride", bike: "Bike" };

/** Start and destination fields with a swap button (the start dot, the line, the pin). */
export function JourneyFields({ origin, destination, onOrigin, onDestination, onSwap, originNote }: { origin: JourneyPlace | null; destination: JourneyPlace | null; onOrigin: () => void; onDestination: () => void; onSwap: () => void; originNote?: string | null }) {
  const field = "cm-press flex min-h-[52px] w-full items-center rounded-surface bg-app-chip px-3.5 text-left text-body transition-colors hover:bg-app-chip-hover";
  return (
    <div className="flex items-stretch gap-2">
      <div className="flex w-5 flex-col items-center py-[19px]" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-app-ink" />
        <span className="my-1 w-[2px] flex-1 bg-app-ink" />
        <span className="h-2.5 w-2.5 bg-app-ink" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <button type="button" onClick={onOrigin} className={field} aria-label={`Start: ${origin?.label ?? "not set"}. Change start`}>
          <span className="min-w-0">
            <span className={`block truncate ${origin ? "font-medium text-app-ink" : "text-app-muted"}`}>{origin?.label ?? "Choose a start"}</span>
            {originNote ? <span className="block truncate text-meta text-app-muted">{originNote}</span> : null}
          </span>
        </button>
        <button type="button" onClick={onDestination} className={field} aria-label={`Destination: ${destination?.label ?? "not set"}. Change destination`}>
          <span className={`block truncate ${destination ? "font-medium text-app-ink" : "text-app-muted"}`}>{destination?.label ?? "Choose a destination"}</span>
        </button>
      </div>
      <IconButton label="Swap start and destination" onClick={onSwap} className="self-center" disabled={!origin && !destination}>
        <ArrowUpDown className="h-5 w-5" aria-hidden />
      </IconButton>
    </div>
  );
}

/**
 * Leave now / Depart at / Arrive by, with a Georgia-time date and time. A time
 * that has passed is reported here, never moved to another day.
 */
export function TimingControl({ timing, onChange, now, error }: { timing: TripTiming; onChange: (t: TripTiming) => void; now: number; error: string | null }) {
  const dateId = useId();
  const timeId = useId();
  const at = timing.mode === "depart" ? timing.at : timing.mode === "arrive" ? timing.by : null;
  const inputs = at !== null ? instantToLocalInputs(at, tz) : null;
  const deviceTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
  const set = (mode: TripTiming["mode"], instant: number) => onChange(mode === "now" ? LEAVE_NOW : mode === "depart" ? { mode, at: instant } : { mode, by: instant });
  const status = inputs ? localInputsToInstant(inputs.date, inputs.time, tz)?.status : null;
  return (
    <div className="space-y-2">
      <Segmented
        label="When"
        hideLabel
        value={timing.mode}
        options={[
          ["now", "Leave now"],
          ["depart", "Depart at"],
          ["arrive", "Arrive by"],
        ]}
        onChange={(m) => set(m, at ?? suggestedTime(now, m === "arrive" ? 60 : 15))}
      />
      {inputs ? (
        <div className="grid grid-cols-[1.25fr_1fr] gap-2">
          <label htmlFor={dateId} className="sr-only">
            {timing.mode === "depart" ? "Departure date" : "Arrival date"}
          </label>
          <input
            id={dateId}
            type="date"
            value={inputs.date}
            min={localDate(now, tz)}
            onChange={(e) => {
              const r = localInputsToInstant(e.target.value, inputs.time, tz);
              if (r) set(timing.mode, r.at);
            }}
            className="h-12 rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body text-app-ink"
          />
          <label htmlFor={timeId} className="sr-only">
            {timing.mode === "depart" ? "Departure time" : "Arrival time"}
          </label>
          <input
            id={timeId}
            type="time"
            value={inputs.time}
            onChange={(e) => {
              const r = localInputsToInstant(inputs.date, e.target.value, tz);
              if (r) set(timing.mode, r.at);
            }}
            className="h-12 rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body text-app-ink"
          />
        </div>
      ) : null}
      {at !== null ? (
        <p className="text-small text-app-muted">
          {when(at, now)}
          {deviceTz !== tz ? " · Georgia time (ET)" : ""}
          {status === "skipped" ? " · clocks skip ahead tonight, so this is the first time that exists" : status === "ambiguous" ? " · clocks fall back tonight; using the first 1 AM hour" : ""}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small font-medium text-app-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Kinds of travel that may be offered (hard constraints). */
export function ModeChips({ modes, onToggle, hasCar }: { modes: Record<JourneyMode, boolean>; onToggle: (m: JourneyMode) => void; hasCar: boolean }) {
  const order: JourneyMode[] = ["walk", "transit", "drive", "park_ride", "bike"];
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Ways to travel">
      {order.map((m) => {
        const needsCar = (m === "drive" || m === "park_ride") && !hasCar;
        return (
          <Chip key={m} active={modes[m] && !needsCar} disabled={needsCar} onClick={() => onToggle(m)} icon={MODE_ICON[m]("h-4 w-4")} title={needsCar ? "You said you don't have a car (Profile)" : undefined} className="!min-h-[40px] !px-3 text-small">
            {MODE_CHIP_LABEL[m]}
          </Chip>
        );
      })}
    </div>
  );
}

/** The four ways to rank a trip. Each maps onto the ranking engine's own settings (nothing is re-scored here). */
export type RoutePriority = "fastest" | "safest" | "accessible" | "cheapest";

export const ROUTE_PRIORITIES: { id: RoutePriority; label: string; short: string; Icon: typeof Timer; note: string }[] = [
  { id: "fastest", label: "Fastest", short: "Fastest", Icon: Timer, note: "Quickest door to door, including waits and a driving buffer." },
  { id: "safest", label: "Safest", short: "Safest", Icon: ShieldCheck, note: "Fewer crash-risk indicators on the streets the route uses (CrossScore, from GDOT crash records). An estimate, not a guarantee." },
  { id: "accessible", label: "Most accessible", short: "Accessible", Icon: Accessibility, note: "Only routes whose step-free access is verified, least walking first. Many stops and streets can't be verified yet." },
  { id: "cheapest", label: "Lowest cost", short: "Lowest cost", Icon: CircleDollarSign, note: "Lowest known cost. Options whose cost is unknown are not counted as free." },
];

/** Which of the four priorities the effective preferences express, or null for the balanced default. */
export function priorityOf(p: { priority: string; accessible: boolean }): RoutePriority | null {
  if (p.accessible) return "accessible";
  if (p.priority === "fastest") return "fastest";
  if (p.priority === "safety") return "safest";
  if (p.priority === "cheapest") return "cheapest";
  return null;
}

/** The engine settings for a priority (null: back to the balanced default). */
export function prioritySettings(r: RoutePriority | null): { priority: "balanced" | "fastest" | "safety" | "cheapest" | "least_walking"; accessible: boolean } {
  switch (r) {
    case "fastest":
      return { priority: "fastest", accessible: false };
    case "safest":
      return { priority: "safety", accessible: false };
    case "accessible":
      return { priority: "least_walking", accessible: true };
    case "cheapest":
      return { priority: "cheapest", accessible: false };
    default:
      return { priority: "balanced", accessible: false };
  }
}

/**
 * What matters most for this trip: four chips over the options. Tapping the chosen one again goes
 * back to Balanced. The line under them says what the choice actually does.
 */
export function PriorityPicker({ value, onChange }: { value: RoutePriority | null; onChange: (r: RoutePriority | null) => void }) {
  const labelId = useId();
  const active = ROUTE_PRIORITIES.find((p) => p.id === value) ?? null;
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="sr-only">
        Rank routes by
      </p>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-labelledby={labelId}>
        {ROUTE_PRIORITIES.map(({ id, label, short, Icon }) => {
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={label}
              onClick={() => onChange(on ? null : id)}
              className={`cm-press flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-chip px-1 text-meta font-medium ${on ? "bg-[var(--app-selected-bg)] text-app-ink shadow-[inset_0_0_0_1.5px_var(--app-select)]" : "bg-app-chip text-app-muted hover:bg-app-chip-hover hover:text-app-ink"}`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${on ? "text-app-accent" : ""}`} aria-hidden />
              <span className="max-w-full truncate" aria-hidden>
                {short}
              </span>
            </button>
          );
        })}
      </div>
      <p className={active ? "text-small text-app-muted" : "sr-only"} aria-live="polite">
        {active ? active.note : "Balanced: quick options first, with the cheaper, calmer or less-walking ones labelled."}
      </p>
    </div>
  );
}

/** Removable chips for preferences that a typed request set for this search only. */
export function OverrideChips({ items, onClear }: { items: string[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-small">
      <span className="text-app-muted">For this search:</span>
      {items.map((u) => (
        <span key={u} className="rounded-full bg-app-chip px-2 py-1 font-medium">
          {u}
        </span>
      ))}
      <button type="button" onClick={onClear} className="inline-flex min-h-[32px] items-center gap-1 rounded-full px-2 font-medium text-app-route hover:underline">
        <X className="h-3.5 w-3.5" aria-hidden /> Clear
      </button>
    </div>
  );
}

function legIcon(l: PlanLeg, cls: string) {
  if (l.kind === "drive") return <Car className={cls} aria-hidden />;
  if (l.kind === "park") return <CircleParking className={cls} aria-hidden />;
  if (l.kind === "wait") return <Clock3 className={cls} aria-hidden />;
  if (l.kind === "ride") return l.route && /rail|marta/i.test(l.route.agency) && /^(red|gold|blue|green|atlsc)$/i.test(l.route.short) ? <TrainFront className={cls} aria-hidden /> : <Bus className={cls} aria-hidden />;
  if (l.note === "Bike") return <Bike className={cls} aria-hidden />;
  return <Footprints className={cls} aria-hidden />;
}

/** Fastest and Cheapest lead (what people compare first); the rest follow. */
export const ROLE_ORDER: RoleId[] = ["fastest", "cheapest", "leaveLatest", "best", "shortest", "lessWalking", "fewestTransfers", "saferStreets"];

export interface BarSegment {
  kind: "walk" | "bike" | "drive" | "ride" | "wait" | "buffer";
  minutes: number;
  label: string;
  /** Ride segments: the line's own colours. */
  color?: string;
  text?: string;
  short?: string;
}

/**
 * The parts of a journey as proportional segments, in order. Waits stay (they are real
 * time); parking steps and sub-minute walks between rides are folded away so the bar
 * shows what a person does, not every record. When the option's total includes time no
 * leg accounts for (the stated planning buffer, with no live traffic), it is drawn as
 * its own hatched segment after the drive, so the bar adds up to the time on the card.
 */
export function journeySegments(legs: PlanLeg[], total?: { durationMin: number; bufferMin: number }): BarSegment[] {
  const out: BarSegment[] = [];
  const sum = legs.reduce((s, l) => s + (l.kind === "park" ? 0 : Math.max(0, l.minutes)), 0);
  const extra = total ? Math.round(total.durationMin - sum) : 0;
  for (const l of legs) {
    if (l.kind === "park") continue;
    const minutes = Math.max(0, l.minutes);
    if (l.kind === "wait") {
      if (minutes >= 1) out.push({ kind: "wait", minutes, label: `Wait ${duration(minutes)}` });
      continue;
    }
    if (l.kind === "walk" && minutes < 1 && legs.length > 1) continue;
    if (l.kind === "ride" && l.route) {
      const name = lineName(l.route.short, l.route.agency);
      const hasColor = l.route.color && l.route.color !== "#000000";
      // The bar is narrow: "Gold" rather than "Gold line"; the spoken label keeps the full name.
      out.push({ kind: "ride", minutes, label: `${name} ${duration(minutes)}`, color: hasColor ? l.route.color : undefined, text: hasColor ? l.route.text || "#ffffff" : undefined, short: name.replace(/ line$/, "") });
      continue;
    }
    const kind = l.kind === "drive" ? "drive" : l.note === "Bike" ? "bike" : l.kind === "ride" ? "ride" : "walk";
    const word = kind === "drive" ? "Drive" : kind === "bike" ? "Bike" : kind === "ride" ? "Ride" : "Walk";
    out.push({ kind, minutes, label: `${word} ${duration(minutes)}` });
  }
  if (extra >= 1) {
    const seg: BarSegment = { kind: "buffer", minutes: extra, label: total && total.bufferMin > 0 ? `Planning buffer ${duration(extra)}` : `Other time ${duration(extra)}` };
    let lastDrive = -1;
    out.forEach((s, i) => s.kind === "drive" && (lastDrive = i));
    if (lastDrive >= 0) out.splice(lastDrive + 1, 0, seg);
    else out.push(seg);
  }
  return out;
}

const SEG_STYLE: Record<Exclude<BarSegment["kind"], "ride" | "wait" | "buffer">, string> = {
  walk: "bg-app-chip text-app-ink",
  bike: "bg-[var(--app-mode-bike)] text-white",
  drive: "bg-[var(--app-mode-drive)] text-white",
};

/** Proportional bar of a journey's parts: who drives, walks, rides, and for how long. */
export function JourneyBar({ legs, total, className = "" }: { legs: PlanLeg[]; total?: { durationMin: number; bufferMin: number }; className?: string }) {
  const segs = journeySegments(legs, total);
  if (!segs.length) return null;
  return (
    <span role="img" aria-label={segs.map((s) => s.label).join(", ")} className={`flex h-7 w-full items-stretch gap-[3px] ${className}`}>
      {segs.map((s, i) => {
        const base = { flexGrow: Math.max(s.minutes, 1), flexBasis: 0 };
        if (s.kind === "wait") return <span key={i} aria-hidden className="cm-seg-wait self-center" style={{ ...base, minWidth: 10 }} />;
        if (s.kind === "buffer")
          return (
            <span key={i} aria-hidden title={s.label} className="cm-seg cm-seg-buffer flex min-w-0 items-center justify-center overflow-hidden rounded-chip text-meta font-semibold leading-none text-app-muted" style={{ ...base, minWidth: 22 }}>
              <span className="cm-seg-label tnum truncate">+{Math.round(s.minutes)}</span>
            </span>
          );
        const ride = s.kind === "ride";
        const Icon = s.kind === "drive" ? Car : s.kind === "bike" ? Bike : ride ? Bus : Footprints;
        return (
          <span
            key={i}
            aria-hidden
            className={`cm-seg flex min-w-0 items-center justify-center gap-1 overflow-hidden rounded-chip px-1.5 text-meta font-semibold leading-none ${ride ? (s.color ? "" : "bg-app-strong text-app-on-strong") : SEG_STYLE[s.kind as keyof typeof SEG_STYLE]}`}
            style={{ ...base, minWidth: ride ? 40 : 26, ...(ride && s.color ? { background: s.color, color: s.text } : {}) }}
          >
            {ride ? <span className="truncate">{s.short}</span> : <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {!ride ? <span className="cm-seg-label tnum truncate">{Math.round(s.minutes)}</span> : null}
          </span>
        );
      })}
    </span>
  );
}

/** "Red line", "Streetcar", "Bus 110": what a rider would call the vehicle. */
export function rideName(route: NonNullable<PlanLeg["route"]>): string {
  const name = lineName(route.short, route.agency);
  return name !== route.short ? name : `Bus ${route.short}`;
}

/**
 * A readable title for an option. Transit titles from the planner are route numbers
 * ("2", "RED → 110"); riders say "Bus 2" and "Red line → Bus 110".
 */
export function optionTitle(o: Pick<JourneyOption, "kind" | "title" | "legs">): string {
  if (o.kind !== "transit" && o.kind !== "park_ride") return o.title;
  const rides = o.legs.flatMap((l) => (l.kind === "ride" && l.route ? [rideName(l.route)] : []));
  if (!rides.length) return o.title;
  const via = rides.join(" → ");
  if (o.kind === "park_ride") {
    const drive = o.legs.find((l) => l.kind === "drive");
    return drive ? `Park at ${drive.to} · ${via}` : `Park & ride · ${via}`;
  }
  return via;
}

/** "in 6 min", "in 1 hr 5 min", or null when the departure is now or has passed. */
export function leavesIn(leaveAt: number, now: number): string | null {
  const m = Math.floor((leaveAt - now) / 60_000);
  if (m < 1) return null;
  return `in ${duration(m)}`;
}

/** Facts that apply to this option only, in words (no empty columns): cost, walking, transfers, distance. */
export function optionFacts(o: JourneyOption): string[] {
  const facts = [o.costUsd !== null ? (o.costUsd === 0 ? "Free" : usd(o.costUsd)) : "Cost unknown"];
  if (o.walkMin) facts.push(`${o.walkMin} min walking`);
  if (o.kind === "transit" || o.kind === "park_ride") facts.push(o.transfers === 0 ? "No transfers" : `${o.transfers} ${o.transfers === 1 ? "transfer" : "transfers"}`);
  if (o.distanceM) facts.push(distance(o.distanceM));
  return facts;
}

const MODE_GLYPH: Record<JourneyMode, GlyphName> = { walk: "walk", bike: "bike", transit: "transit", drive: "drive", park_ride: "park_ride" };

/**
 * The way of travelling at the start of an option row: its pictogram, bare (no tile behind it).
 * The cut-outs take `--glyph-cut`, which the row sets to its own background; `tone="accent"` is for
 * dark surfaces, where the green reads at 7.8:1.
 */
export function ModeTile({ kind, tone = "ink", size = 40 }: { kind: JourneyMode; tone?: "ink" | "accent"; size?: number }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${tone === "accent" ? "text-app-accent" : "text-app-ink"}`} style={{ width: size, height: size }}>
      <Glyph name={MODE_GLYPH[kind]} style={{ width: size * 0.8, height: size * 0.8 }} />
    </span>
  );
}

/**
 * One option in the comparison, a row in "Choose a trip": the way of travelling, its name and times,
 * and the duration (the figure you compare by) and cost on the right. Only the selected row is a
 * surface (a strong border and a faint tint); the others are flat rows. An expanded row (by
 * default, the selected one) also shows the journey bar, the facts that differ, why it ranks where it
 * does, and its CrossScore.
 */
export function RouteCard({ o, selected, expanded = selected, onSelect, arriveMode, now, showAccess, disabled, generatedAt }: { o: JourneyOption; selected: boolean; expanded?: boolean; onSelect: () => void; arriveMode: boolean; now: number; showAccess: boolean; disabled?: boolean; generatedAt?: number }) {
  const roles = ROLE_ORDER.filter((r) => o.roles.includes(r));
  // What counts down: the first timetabled ride's scheduled departure (frequency-based rides have
  // no fixed time), or, for arrive-by and later departures, when to leave. Leave-now walks and drives don't.
  const ride = o.legs.find((l) => l.kind === "ride" && l.depart && !l.headway);
  const timed = generatedAt !== undefined && o.leaveAt - generatedAt > 90_000;
  const byRide = !arriveMode && !!ride;
  const target = byRide ? ride!.depart! : timed ? o.leaveAt : null;
  const inText = target !== null ? leavesIn(target, now) : null;
  const passed = target !== null && now > target + 30_000;
  const title = optionTitle(o);
  const cost = o.costUsd !== null ? (o.costUsd === 0 ? "Free" : usd(o.costUsd)) : null;
  const shownRoles = roles.slice(0, expanded ? roles.length : 2);
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`cm-press flex w-full flex-col gap-3 rounded-surface border-2 px-3 py-3 text-left transition-colors ${
        selected ? "border-app-select bg-[var(--app-selected-bg)] [--glyph-cut:var(--app-selected-bg)]" : "border-transparent [--glyph-cut:var(--app-surface)] hover:bg-app-chip hover:[--glyph-cut:var(--app-chip)]"
      }`}
    >
      <span className="flex w-full items-start gap-3">
        <span className="pt-px">
          <ModeTile kind={o.kind} size={40} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold leading-snug [overflow-wrap:anywhere]">{title}</span>
          <span className="t-num mt-0.5 block text-small text-app-muted">
            {arriveMode ? `Leave ${clock(o.leaveAt)}` : when(o.leaveAt, now)} – {clock(o.arriveAt)}
            {inText ? (
              <span className="font-medium text-app-teal" title={byRide ? `Scheduled departure ${clock(target)} from ${ride!.from}` : `Leave at ${clock(target)}`}>
                {" "}
                · {byRide ? `Departs ${inText}` : `Leave ${inText}`}
              </span>
            ) : passed ? <span className="font-medium text-app-amber"> · {byRide ? "Scheduled departure passed" : "Leave time passed"}</span> : null}
          </span>
          {shownRoles.length ? (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {shownRoles.map((r) => (
                <RoleBadge key={r} strong={r === "fastest" || r === "cheapest"}>
                  {ROLE_LABEL[r]}
                </RoleBadge>
              ))}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 whitespace-nowrap text-right">
          <span className="t-num block text-section font-semibold leading-tight">{duration(o.durationMin)}</span>
          <span className={`t-num mt-0.5 block text-small ${cost ? "font-medium text-app-ink" : "text-app-muted"}`}>{cost ?? "Cost unknown"}</span>
        </span>
      </span>
      {expanded ? (
        <span className="cm-reveal flex flex-col gap-2 pl-[52px]">
          <JourneyBar legs={o.legs} total={o} />
          {subtitle(o) ? <span className="text-small font-medium text-app-ink [overflow-wrap:anywhere]">{subtitle(o)}</span> : null}
          <span className="t-num flex flex-wrap gap-x-2 gap-y-0.5 text-small text-app-ink">
            {optionFacts(o).slice(1).map((f, i) => (
              <span key={f}>
                {i > 0 ? (
                  <span aria-hidden className="mr-2 text-app-line-strong">
                    ·
                  </span>
                ) : null}
                {f}
              </span>
            ))}
          </span>
          <span className="text-small text-app-muted">{o.explanation}</span>
          {o.safety ? (
            <span className="inline-flex items-center gap-1.5 text-small font-medium text-app-ink">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
              CrossScore {o.safety.score}/100 ({o.safety.mode === "drive" ? "driving" : o.safety.mode === "bike" ? "biking" : "walking"}) · {o.safety.band}
              <span className="font-normal text-app-muted">· estimate</span>
            </span>
          ) : null}
          {o.access !== "not_applicable" || (showAccess && o.accessNote) ? (
            <span className={`inline-flex items-start gap-1.5 text-small ${o.access === "verified" ? "text-app-teal" : "text-app-muted"}`}>
              <Accessibility className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {o.accessNote ?? (o.access === "verified" ? "Step-free access verified" : "Step-free access not verified")}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

const SUMMARY_ORDER: JourneyMode[] = ["walk", "bike", "transit", "park_ride", "drive"];

/**
 * One chip per way of travelling that has an option, with its quickest time. Tapping one
 * selects that mode's best-ranked option (the list is already in best-match order).
 */
export function ModeSummary({ options, selectedId, onPick }: { options: JourneyOption[]; selectedId: string | null; onPick: (o: JourneyOption) => void }) {
  const labelId = useId();
  const kinds = SUMMARY_ORDER.filter((k) => options.some((o) => o.kind === k));
  if (kinds.length < 2) return null;
  const selectedKind = options.find((o) => o.id === selectedId)?.kind ?? null;
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-small font-medium text-app-muted">
        Quickest by way of travel
      </p>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-labelledby={labelId}>
        {kinds.map((k) => {
          const ofKind = options.filter((o) => o.kind === k);
          const quickest = Math.min(...ofKind.map((o) => o.durationMin));
          const on = selectedKind === k;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              aria-label={`${MODE_CHIP_LABEL[k]}: quickest ${duration(quickest)}`}
              onClick={() => onPick(ofKind[0]!)}
              className={`cm-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-chip border px-3 text-small font-semibold ${on ? "border-app-select bg-[var(--app-selected-bg)] text-app-ink" : "border-app-line bg-app-surface text-app-ink hover:bg-app-chip"}`}
            >
              {MODE_ICON[k]("h-4 w-4")}
              <span className="tnum">{duration(quickest)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Placeholder shaped like an option row while options are computed. */
export function RouteCardSkeleton({ delay = 0 }: { delay?: number }) {
  const st = { animationDelay: `${delay}ms` };
  return (
    <div aria-hidden className="flex items-center gap-3 px-3 py-3">
      <span className="cm-shimmer h-12 w-12 shrink-0 rounded-ctl" style={st} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="cm-shimmer h-4 w-2/5 rounded-tag" style={st} />
        <span className="cm-shimmer h-3.5 w-3/5 rounded-tag" style={st} />
      </span>
      <span className="flex flex-col items-end gap-2">
        <span className="cm-shimmer h-5 w-14 rounded-tag" style={st} />
        <span className="cm-shimmer h-3.5 w-10 rounded-tag" style={st} />
      </span>
    </div>
  );
}

/** What the badges don't already say: where to board, or which parking place or route variant. */
function subtitle(o: JourneyOption): string | null {
  if (o.kind === "transit" || o.kind === "park_ride") {
    const ride = o.legs.find((l) => l.kind === "ride");
    const drive = o.legs.find((l) => l.kind === "drive");
    if (drive) return `Drive to ${drive.to}, then ride`;
    return ride ? `Board at ${ride.from}` : null;
  }
  return /^(Walk|Drive|Bike)$/.test(o.title) ? null : o.title;
}

function legHeadline(l: PlanLeg, next: PlanLeg | undefined, prev: PlanLeg | undefined): string {
  switch (l.kind) {
    case "walk":
      if (l.note === "Bike") return `Bike to ${l.to}`;
      if (prev?.kind === "ride" && next?.kind === "ride") return `Transfer: walk to ${l.to}`;
      if (prev?.kind === "ride" && next?.kind === "wait") return `Transfer: walk to ${l.to}`;
      return `Walk to ${l.to}`;
    case "drive":
      return `Drive to ${l.to}`;
    case "park":
      return `Park at ${l.to}`;
    case "wait":
      return prev?.kind === "ride" ? `Transfer at ${l.from}` : `Wait at ${l.from}`;
    case "ride":
      return `Ride to ${l.to}`;
  }
}

function legLine(l: PlanLeg): string {
  if (l.kind === "ride") return l.route?.color && l.route.color !== "#000000" ? l.route.color : "var(--app-mode-transit)";
  if (l.kind === "drive") return "var(--app-mode-drive)";
  if (l.note === "Bike") return "var(--app-mode-bike)";
  return "var(--app-mode-walk)";
}

/** Step-by-step itinerary: times on the left, a line in each mode's colour, details on the right. */
export function ItineraryTimeline({ option, start, end, activeLeg }: { option: { legs: PlanLeg[] }; start: string; end: string; activeLeg?: number }) {
  const legs = option.legs;
  const first = legs[0];
  const last = legs[legs.length - 1];
  return (
    <ol className="relative" aria-label="Journey steps">
      <li className="flex gap-3">
        <span className="tnum w-[60px] shrink-0 pt-0.5 text-right text-small font-medium">{first?.depart ? clock(first.depart) : ""}</span>
        <span className="relative flex w-4 shrink-0 justify-center">
          <span className="mt-1 h-3 w-3 rounded-full border-[3px] border-app-primary bg-app-surface" aria-hidden />
        </span>
        <span className="min-w-0 pb-3 text-body font-semibold">{start}</span>
      </li>
      {legs.map((l, i) => {
        const dashed = l.kind === "walk" || l.kind === "wait";
        return (
          <li key={i} className={`flex gap-3 ${activeLeg === i ? "rounded-ctl bg-app-chip" : ""}`} aria-current={activeLeg === i ? "step" : undefined}>
            <span className="tnum w-[60px] shrink-0 pt-2 text-right text-meta text-app-muted">{l.kind === "ride" && l.depart ? clock(l.depart) : ""}</span>
            <span className="relative flex w-4 shrink-0 justify-center" aria-hidden>
              <span className="absolute inset-y-0 w-[4px] rounded-full" style={dashed ? { backgroundImage: `linear-gradient(${legLine(l)} 50%, transparent 0)`, backgroundSize: "4px 8px" } : { background: legLine(l) }} />
            </span>
            <span className="min-w-0 flex-1 py-2">
              <span className="flex items-start gap-2">
                <span className="mt-0.5 text-app-ink">{legIcon(l, "h-4 w-4")}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-body font-medium leading-snug">
                    {l.kind === "ride" && l.route ? <RouteBadge route={{ ...l.route, short: lineName(l.route.short, l.route.agency) }} /> : null}
                    <span className="[overflow-wrap:anywhere]">{legHeadline(l, legs[i + 1], legs[i - 1])}</span>
                  </span>
                  <span className="block text-small leading-snug text-app-muted">{legDetail(l)}</span>
                  {l.kind === "walk" && l.steps?.length ? (
                    <details className="mt-1 text-small">
                      <summary className="min-h-[32px] cursor-pointer font-medium text-app-route">Walking directions ({l.steps.length})</summary>
                      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-app-muted">
                        {l.steps.map((s, k) => (
                          <li key={k}>
                            {s.instruction}
                            {s.meters > 20 ? ` · ${metersLabel(s.meters)}` : ""}
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </span>
              </span>
            </span>
          </li>
        );
      })}
      <li className="flex gap-3">
        <span className="tnum w-[60px] shrink-0 pt-0.5 text-right text-small font-medium">{last?.arrive ? clock(last.arrive) : ""}</span>
        <span className="relative flex w-4 shrink-0 justify-center">
          <MapPin className="h-4 w-4 text-app-ink" aria-hidden />
        </span>
        <span className="min-w-0 text-body font-semibold [overflow-wrap:anywhere]">{end}</span>
      </li>
    </ol>
  );
}

function legDetail(l: PlanLeg): string {
  const parts: string[] = [duration(l.minutes)];
  if (l.meters && l.kind !== "ride") parts.push(metersLabel(l.meters));
  if (l.kind === "ride") {
    parts.unshift(`From ${l.from}`);
    if (l.headsign) parts.push(`toward ${l.headsign}`);
    if (l.stops) parts.push(`${l.stops} ${l.stops === 1 ? "stop" : "stops"}`);
    parts.push(l.headway ? `about every ${Math.round(l.headway / 60)} min (not timed)` : `scheduled ${clock(l.depart)}, arrive ${clock(l.arrive)}`);
  }
  if (l.kind === "wait" && l.arrive) parts.push(`until ${clock(l.arrive)}`);
  if ((l.kind === "drive" || l.kind === "walk") && l.note && l.note !== "Bike") parts.push(l.note);
  return parts.join(" · ");
}
