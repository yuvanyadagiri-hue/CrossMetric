"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Bus, Car, ChevronDown, CircleParking, ExternalLink, Footprints, TrainFront } from "lucide-react";
import type { PlanLeg, PlanOption, SourceRef } from "@/lib/commute-types";
import { clock, minutes, usd } from "../format";

export function RouteBadge({ route }: { route: NonNullable<PlanLeg["route"]> }) {
  const bg = route.color && route.color !== "#000000" ? route.color : "#07111F";
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-tag px-1.5 text-small font-semibold leading-none" style={{ background: bg, color: route.text || "#fff" }} title={`${route.agency} ${route.long || route.short}`}>
      {route.short}
    </span>
  );
}

export function LegIcon({ leg, className = "h-4 w-4" }: { leg: PlanLeg; className?: string }) {
  if (leg.kind === "drive") return <Car className={className} aria-hidden />;
  if (leg.kind === "park") return <CircleParking className={className} aria-hidden />;
  if (leg.kind === "ride") return leg.route && /rail|marta/i.test(leg.route.agency) && /gold|red|blue|green/i.test(leg.route.short) ? <TrainFront className={className} aria-hidden /> : <Bus className={className} aria-hidden />;
  return <Footprints className={className} aria-hidden />;
}

/** Compact sequence of modes: icons for walk/drive, badges for transit routes. */
export function ModeStrip({ option }: { option: { legs: PlanLeg[] } }) {
  const items = option.legs.filter((l) => l.kind !== "wait" && l.kind !== "park" && !(l.kind === "walk" && l.minutes < 2 && option.legs.length > 1));
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1 text-app-muted">
      {items.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden className="text-meta">›</span> : null}
          {l.kind === "ride" && l.route ? <RouteBadge route={l.route} /> : <LegIcon leg={l} className="h-4 w-4 text-app-ink" />}
        </span>
      ))}
    </span>
  );
}

export function optionLabel(o: PlanOption): string {
  if (o.kind === "walk") return "Walk";
  if (o.kind === "drive") return `Drive · ${o.title}`;
  if (o.kind === "park_ride") return `Park & Ride · ${o.title.split(" + ")[0]}`;
  const ride = o.legs.find((l) => l.kind === "ride");
  return ride?.route ? `${ride.route.agency === "MARTA" ? "MARTA" : "Bus"} ${o.title}` : "Transit";
}

/** "$15 + gas", "$5", "$0", "Cost unknown". */
export function costText(o: PlanOption): string {
  if (o.costUsd !== null) return usd(o.costUsd);
  const parking = o.parking?.price ?? null;
  if (parking !== null) return `${usd(parking)} + gas`;
  // No park-until time yet: the price depends on how long you stay.
  if (o.parking?.status === "requires_action") return o.restriction?.split(" · ")[0] ?? "Pay to park";
  if (o.parking?.status === "allowed") return "Free parking now";
  return "Cost unknown";
}

export const ROLE_LABEL: Record<NonNullable<PlanOption["role"]>, string> = {
  recommended: "Recommended",
  cheapest: "Cheapest",
  lessRain: "Less walking",
  backup: "Backup",
};

export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="rounded-ctl border border-app-line">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-body font-medium">
        {summary}
        <ChevronDown className={`h-4 w-4 shrink-0 text-app-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div id={id} className="border-t border-app-line px-3 py-2.5 text-small leading-relaxed text-app-muted">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SourceLinks({ sources, ids }: { sources: Record<string, SourceRef>; ids: string[] }) {
  const list = ids.map((id) => sources[id]).filter((s): s is SourceRef => !!s);
  if (!list.length) return null;
  return (
    <ul className="space-y-1.5">
      {list.map((s) => (
        <li key={s.id}>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-app-ink underline decoration-app-line-strong underline-offset-2">
            <span>{s.title}</span>
            <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />
          </a>
          <span className="block text-small">
            {s.kind === "official" ? "Official" : s.kind === "news" ? "News report" : "OpenStreetMap"} · checked {s.retrieved} · re-check by {s.reviewBy}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A row in a divided list, as the route list does it: type on the sheet with a hairline under it, and
 * only the selected row is a surface (a tinted block with a dark border). Put it on the `li`.
 */
export const listRow = (selected: boolean) => (selected ? "-mx-2 my-1 rounded-surface border-2 border-app-select bg-[var(--app-selected-bg)] px-2" : "border-b border-app-line last:border-b-0");

/** Ordered list of legs with times (the accessible equivalent of the map route). */
export function LegTimeline({ option, activeLeg }: { option: { legs: PlanLeg[] }; activeLeg?: number }) {
  return (
    <ol aria-label="Trip steps">
      {option.legs.map((l, i) => (
        <li key={i} className={`flex gap-3 py-2.5 ${activeLeg === i ? "-mx-2 rounded-ctl bg-[var(--app-selected-bg)] px-2" : "border-b border-app-line last:border-b-0"}`} aria-current={activeLeg === i ? "step" : undefined}>
          <span className="mt-0.5 shrink-0 text-app-ink">
            <LegIcon leg={l} className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-body font-medium leading-snug [overflow-wrap:anywhere]">{legTitle(l)}</span>
              {l.depart ? <span className="t-num shrink-0 text-small text-app-muted">{clock(l.depart)}</span> : null}
            </span>
            <span className="block text-small leading-snug text-app-muted">{legDetail(l)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function legTitle(l: PlanLeg): ReactNode {
  switch (l.kind) {
    case "walk":
      return `Walk to ${l.to}`;
    case "drive":
      return `Drive to ${l.to}`;
    case "park":
      return `Park at ${l.to}`;
    case "wait":
      return `Wait at ${l.from}`;
    case "ride":
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {l.route ? <RouteBadge route={l.route} /> : null}
          <span>to {l.to}</span>
        </span>
      );
  }
}

export function legDetail(l: PlanLeg): string {
  const parts: string[] = [minutes(l.minutes)];
  if (l.kind === "ride") {
    if (l.stops) parts.push(`${l.stops} ${l.stops === 1 ? "stop" : "stops"}`);
    if (l.headsign) parts.push(`toward ${l.headsign}`);
    parts.push(l.headway ? `about every ${Math.round(l.headway / 60)} min` : `scheduled ${clock(l.depart)}`);
  }
  if (l.kind === "drive" || l.kind === "walk") if (l.note) parts.push(l.note);
  return parts.join(" · ");
}
