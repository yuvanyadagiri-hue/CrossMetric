"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Moon, Phone, Share2, Siren } from "lucide-react";
import type { SafetySummary } from "@/lib/journey-types";
import type { AppModel } from "../model";
import { ShareTrip } from "../ShareTrip";
import { PanelHeader, SectionLabel } from "../ui";

const MODE_WORD: Record<SafetySummary["mode"], string> = { walk: "walking", bike: "biking", drive: "driving" };

/**
 * Score ring: the number carries the meaning; the arc only shows it at a glance, in the band's
 * colour (teal for lower-risk conditions, amber for mixed, red for higher-risk; bands from the
 * CrossScore model: 75 and up, 50 and up, below 50). Never lime, which means "good to go".
 */
function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const tone = score >= 75 ? "var(--app-teal)" : score >= 50 ? "var(--app-amber)" : "var(--app-red)";
  const r = 30;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, score)) / 100;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 72 72" width={size} height={size} aria-hidden className="-rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--app-chip)" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * filled} ${c}`} />
      </svg>
      <span className="tnum absolute text-component font-semibold">{score}</span>
    </span>
  );
}

/**
 * CrossScore as a "safety intelligence" card (brand reference): the route's
 * street conditions for the way it is travelled, with its confidence and main
 * concern. It describes conditions; it does not predict crashes, and it is not
 * live. Transit rides are not scored.
 */
export function CrossScoreCard({ safety, kind }: { safety: SafetySummary | null; kind: string }) {
  return (
    <section aria-label="CrossScore" className="border-t border-app-line pt-5">
      <h3 className="t-component">CrossScore</h3>
      <p className="text-small text-app-muted">Street conditions along this route, out of 100 (higher is calmer)</p>
      {safety ? (
        <>
          <div className="mt-3 flex items-center gap-4">
            <ScoreRing score={safety.score} />
            <div className="min-w-0">
              <p className="text-small text-app-muted">Street conditions · {MODE_WORD[safety.mode]}</p>
              <p className="t-component">{safety.band}</p>
              <p className="text-small text-app-muted">{safety.confidence.charAt(0).toUpperCase() + safety.confidence.slice(1)} confidence · out of 100</p>
            </div>
          </div>
          {safety.concern ? (
            <p className="mt-3 text-small">
              <span className="font-semibold">Main concern: </span>
              {safety.concern.charAt(0).toLowerCase() + safety.concern.slice(1)}
            </p>
          ) : null}
          <dl className="mt-3 space-y-2 text-small">
            <div>
              <dt className="font-medium text-app-ink">Recorded data</dt>
              <dd className="text-app-muted">GDOT crash reports within 30 m of the route (a rolling three-year window), the GDOT road inventory and traffic counts.</dd>
            </div>
            <div>
              <dt className="font-medium text-app-ink">Mapped or estimated</dt>
              <dd className="text-app-muted">Speed limits, sidewalks and bike lanes from OpenStreetMap (can be incomplete), and the comparison with similar Georgia streets that turns these into one score.</dd>
            </div>
          </dl>
          <p className="mt-2 text-small text-app-muted">
            An estimate from past records, not a prediction or a safety guarantee, and not live.{" "}
            <Link href="/methodology" className="font-medium text-app-route underline">
              How it works
            </Link>
          </p>
        </>
      ) : (
        <p className="mt-3 text-small text-app-muted">{kind === "transit" || kind === "park_ride" ? "Transit rides are not scored for safety. Walking parts are short and not scored separately." : "No CrossScore is available for this route."}</p>
      )}
    </section>
  );
}

/**
 * The safety toolkit (the Uber app's shield): call for help, campus contacts,
 * share the trip, night travel and the route's CrossScore. CrossMetric does
 * not monitor trips, track location in the background or dispatch help — it says so.
 */
export function SafetyPanel({ app }: { app: AppModel }) {
  const [sharing, setSharing] = useState(false);
  const o = app.journey.selected;
  const help = app.bundle?.help ?? [];
  return (
    <div className="space-y-5 pt-1">
      <PanelHeader title="Safety toolkit" sub="Help and tools for your trip" onBack={app.back} />

      <a href="tel:911" className="cm-press flex min-h-[64px] items-center gap-3 rounded-surface bg-app-red-bg px-4 py-3 text-app-red">
        <Siren className="h-6 w-6 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block t-component">Call 911</span>
          <span className="block text-small">For emergencies. CrossMetric can&rsquo;t contact anyone for you.</span>
        </span>
        <Phone className="h-5 w-5 shrink-0" aria-hidden />
      </a>

      {help.length ? (
        <section className="space-y-2" aria-label="Campus help">
          <SectionLabel>Campus help</SectionLabel>
          <ul className="divide-y divide-app-line">
            {help.map((h) => (
              <li key={h.phone}>
                <a href={`tel:${h.phone}`} className="cm-press flex min-h-[60px] items-center gap-3" aria-label={`Call ${h.label}: ${h.display}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center" aria-hidden>
                    <Phone className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium">{h.label}</span>
                    <span className="tnum block text-small text-app-muted">{h.display}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2" aria-label="Tools">
        <SectionLabel>Tools</SectionLabel>
        <ul className="divide-y divide-app-line">
          {o && app.journey.actionable ? (
            <li>
              <ToolRow icon={<Share2 className="h-[18px] w-[18px]" />} title="Share trip details" sub="Send the destination and time; your live location is never shared" onClick={() => setSharing((v) => !v)} />
            </li>
          ) : null}
          {app.campus ? (
            <li>
              <ToolRow icon={<Moon className="h-[18px] w-[18px]" />} title="Night travel" sub="Official escorts and safe rides on campus" onClick={() => app.go({ kind: "night" }, "half")} />
            </li>
          ) : null}
        </ul>
        {sharing && o ? <ShareTrip app={app} option={o} onClose={() => setSharing(false)} /> : null}
      </section>

      {o ? <CrossScoreCard safety={o.safety} kind={o.kind} /> : null}

      <p className="text-small text-app-muted">CrossMetric doesn&rsquo;t monitor trips, track your location in the background, or dispatch help. Scores describe street conditions and are not live.</p>
    </div>
  );
}

function ToolRow({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="cm-press flex min-h-[64px] w-full items-center gap-3 text-left">
      <span className="grid h-10 w-10 shrink-0 place-items-center" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        <span className="block text-small text-app-muted">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
    </button>
  );
}
