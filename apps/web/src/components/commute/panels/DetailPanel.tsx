"use client";

import { useState } from "react";
import { Accessibility, CircleParking, Info, Navigation, Share2, ShieldCheck, Wallet } from "lucide-react";
import { ROLE_LABEL } from "@crossmetric/engine/commute";
import { clock, distance, duration, usd, when } from "../format";
import { ItineraryTimeline, JourneyBar, ModeTile, optionTitle, ROLE_ORDER } from "../journey-ui";
import type { AppModel } from "../model";
import { ShareTrip } from "../ShareTrip";
import { EligibilityBadge, IconButton, Notice, PanelHeader, PrimaryButton, RoleBadge, SectionLabel } from "../ui";
import { CrossScoreCard } from "./SafetyPanel";


/** One option in full: a planned trip (estimates), with the steps, costs, access and evidence behind it. */
export function DetailPanel({ app }: { app: AppModel }) {
  const j = app.journey;
  const o = j.selected;
  const r = j.result;
  const [sharing, setSharing] = useState(false);
  if (!o || !r) return <p className="py-4 text-body text-app-muted">Choose a route first.</p>;
  const title = optionTitle(o);
  return (
    <div className="space-y-4 pt-1">
      <PanelHeader
        title="Route plan"
        sub={<span className="tnum">{when(o.leaveAt, app.now)} – {clock(o.arriveAt)}</span>}
        onBack={app.back}
        action={
          j.actionable ? (
            <IconButton label="Share this trip" onClick={() => setSharing((v) => !v)} aria-expanded={sharing} className={sharing ? "bg-app-chip" : ""}>
              <Share2 className="h-5 w-5" aria-hidden />
            </IconButton>
          ) : undefined
        }
      />
      {sharing ? <ShareTrip app={app} option={o} onClose={() => setSharing(false)} /> : null}
      {!j.actionable ? <Notice tone="amber">These details are for your previous inputs or are out of date. Go back to update them.</Notice> : null}
      <div className="cm-on-dark rounded-surface bg-[#07111F] p-4 [--glyph-cut:#07111F]">
        <div className="flex items-baseline justify-between gap-3">
          <p className="t-num t-page leading-none">{duration(o.durationMin)}</p>
          <p className="t-num text-small font-medium text-app-muted">{o.costUsd !== null ? (o.costUsd === 0 ? "Free" : usd(o.costUsd)) : "Cost unknown"}</p>
        </div>
        <div className="mt-3 flex items-start gap-3 border-t border-app-line pt-3">
          <ModeTile kind={o.kind} tone="accent" size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold [overflow-wrap:anywhere]">{title}</p>
            <p className="text-small text-app-muted [overflow-wrap:anywhere]">To {r.destination.label}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {ROLE_ORDER.filter((r) => o.roles.includes(r)).map((role) => (
          <RoleBadge key={role} strong={role === "fastest" || role === "cheapest"}>
            {ROLE_LABEL[role]}
          </RoleBadge>
        ))}
        <span className="text-small text-app-muted">Planned trip · estimates</span>
      </div>
      <JourneyBar legs={o.legs} total={o} />
      <p className="text-small text-app-muted">{o.explanation}</p>

      <dl className="grid grid-cols-3 divide-x divide-app-line border-y border-app-line py-3">
        <div className="pr-3">
          <dt className="text-small text-app-muted">Distance</dt>
          <dd className="t-num text-body font-semibold">{distance(o.distanceM)}</dd>
        </div>
        <div className="px-3">
          <dt className="text-small text-app-muted">Walking</dt>
          <dd className="t-num text-body font-semibold">{o.walkMin ? `${o.walkMin} min` : "None"}</dd>
        </div>
        <div className="pl-3">
          <dt className="text-small text-app-muted">{o.rides ? "Transfers" : "Buffer"}</dt>
          <dd className="t-num text-body font-semibold">{o.rides ? o.transfers : `${o.bufferMin} min`}</dd>
        </div>
      </dl>

      <section className="space-y-2" aria-label="Overview">
        <SectionLabel>Overview</SectionLabel>
        <ItineraryTimeline option={o} start={r.origin.label} end={r.destination.label} />
      </section>

      <CrossScoreCard safety={o.safety} kind={o.kind} />

      <ul className="space-y-2 text-small">
        <li className="flex gap-2">
          <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-app-muted" aria-hidden />
          <span>{o.costNote}</span>
        </li>
        {o.parking ? (
          <li className="flex flex-wrap items-center gap-2">
            <CircleParking className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
            <EligibilityBadge status={o.parking.status}>{o.parking.reason}</EligibilityBadge>
            {o.parking.usableUntil ? <span className="text-app-muted">until {clock(o.parking.usableUntil)}</span> : null}
            <button type="button" className="min-h-[36px] font-medium text-app-route hover:underline" onClick={() => app.go({ kind: "parking", placeId: o.parking!.placeId }, "half")}>
              Parking details
            </button>
          </li>
        ) : null}
        {o.parkingNote ? (
          <li className="flex gap-2 text-app-muted">
            <CircleParking className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{o.parkingNote}</span>
          </li>
        ) : null}
        {o.accessNote && (j.prefs.accessible || o.access !== "not_applicable") ? (
          <li className="flex gap-2 text-app-muted">
            <Accessibility className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{o.accessNote}</span>
          </li>
        ) : null}
        <li>
          <button type="button" onClick={() => app.go({ kind: "safety" }, "full")} className="inline-flex min-h-[40px] items-center gap-2 font-semibold text-app-ink underline">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden /> Safety toolkit
          </button>
        </li>
        {o.notes.map((n) => (
          <li key={n} className="flex gap-2 text-app-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetailFooter({ app }: { app: AppModel }) {
  const j = app.journey;
  const o = j.selected;
  if (!o || !j.actionable) return null;
  return (
    <div className="space-y-1">
      <PrimaryButton
                icon={<Navigation className="h-5 w-5" aria-hidden />}
        onClick={() => {
          const d = j.destination;
          const from = j.origin ? (j.origin.source === "current" ? "Your location" : j.origin.label) : undefined;
          const camp = o.parking ? (d?.campus ?? app.campus) : (d?.campus ?? null);
          app.startTrip({ id: o.id, title: o.title, kind: o.kind, legs: o.legs, parking: o.parking, costUsd: o.costUsd }, { campus: camp, buildingId: d?.buildingId ?? "", destLabel: d?.label, fromLabel: from });
        }}
      >
        Start trip
      </PrimaryButton>
      <p className="text-center text-meta text-app-muted">Step-by-step guide you confirm as you go — not turn-by-turn navigation.</p>
    </div>
  );
}
