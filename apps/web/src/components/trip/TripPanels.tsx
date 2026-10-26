"use client";

import { AlertTriangle, ArrowRight, Check, CircleSlash, Clock, Info, Moon, Route as RouteIcon, TriangleAlert, X } from "lucide-react";
import type { CrossScoreFactor, CrossScoreResult } from "@crossmetric/engine";
import { CrossScoreGauge, ScoreRing } from "@/components/ui/CrossScoreGauge";
import { Badge, bandTone, BAND_HEX } from "@/components/ui/Status";
import { Skeleton } from "@/components/ui/States";
import { clockLabel, localInputsToInstant } from "@crossmetric/engine/commute";
import { lightAt } from "@/lib/sun";
import type { ModeComparison, ModeSummary, Place, PlannedRoute, PlannerMode, TripResult } from "@/lib/trip-types";
import { formatDistance, formatDuration } from "@/lib/trip-types";
import { ModeIcon, MODE_LABEL } from "./modeMeta";
import { ROLE_META, rolesLabel } from "./routeMeta";
import { RoutePreview } from "./RoutePreview";
import type { When } from "./useTripPlanner";

const CONFIDENCE_LABEL = { high: "High data coverage", moderate: "Partial data coverage", limited: "Limited data coverage" } as const;

export function confidenceText(r: CrossScoreResult): string {
  const missing = r.factors.filter((f) => f.score === null).map((f) => f.label.toLowerCase());
  return missing.length ? `${CONFIDENCE_LABEL[r.confidence.level]} — not scored: ${missing.join(", ")}.` : `${CONFIDENCE_LABEL[r.confidence.level]} — every factor had data.`;
}

/** Signature CrossScore summary for the selected route. */
export function CrossScoreSummary({ route, to, onDetails }: { route: PlannedRoute; to: Place; onDetails?: () => void }) {
  const r = route.crossScore;
  return (
    <div className="@container">
    <div className="flex flex-col items-start gap-4 @[400px]:flex-row @[400px]:items-center @[400px]:gap-5">
      <CrossScoreGauge score={r.score} size={128} />
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Your CrossScore</p>
        <p className="mt-1 text-body font-semibold leading-snug text-navy-900">
          {rolesLabel(route.roles)} to {to.label}
        </p>
        <p className="tabular mt-0.5 text-small text-ink-muted">
          {formatDuration(route.durationS)} · {formatDistance(route.lengthM)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge tone={bandTone(r.band.id)}>{r.band.label}</Badge>
          {onDetails ? (
            <button type="button" onClick={onDetails} className="link inline-flex items-center gap-1 text-small">
              View route details <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-meta leading-snug text-ink-muted">Based on available crash, road and infrastructure data — not a guarantee of safety.</p>
      </div>
    </div>
    </div>
  );
}

function Reason({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-small leading-snug text-ink-soft">
      <span className={`mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full ${ok ? "bg-positive-bg text-positive-fg" : "bg-critical-bg text-critical-fg"}`} aria-hidden>
        {ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span>
        <span className="sr-only">{ok ? "Positive: " : "Concern: "}</span>
        {children}
      </span>
    </li>
  );
}

/** Safest / balanced / fastest cards with previews, explanations and the CTA. */
export function RouteOptionCards({ trip, selectedId, onSelect }: { trip: TripResult; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className={`grid gap-4 ${trip.routes.length >= 3 ? "lg:grid-cols-3" : trip.routes.length === 2 ? "md:grid-cols-2" : ""}`}>
      {trip.routes.map((route) => {
        const role = ROLE_META[route.roles[0]!];
        const selected = route.id === selectedId;
        const reasons = [...route.crossScore.positives.slice(0, 3).map((t) => ({ ok: true, t })), ...route.crossScore.concerns.slice(0, 3).map((t) => ({ ok: false, t }))].slice(0, 4);
        return (
          <article
            key={route.id}
            className={`card card-interactive flex flex-col p-4 ${selected ? "border-brand-500 ring-2 ring-brand-500/20" : ""}`}
            aria-label={`${rolesLabel(route.roles)}: CrossScore ${route.crossScore.score}`}
          >
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-chip bg-brand-50 text-brand-600" aria-hidden>
                    <role.Icon className="h-4 w-4" />
                  </span>
                  <h3 className="text-body font-semibold text-navy-900">{rolesLabel(route.roles)}</h3>
                </div>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="tabular text-page font-semibold leading-none" style={{ color: BAND_HEX[route.crossScore.band.id] }}>
                    {route.crossScore.score}
                  </span>
                  <span className="text-small font-medium text-ink-muted">/ 100</span>
                </p>
                <p className="tabular mt-1 text-small text-ink-muted">
                  {formatDuration(route.durationS)} · {formatDistance(route.lengthM)}
                </p>
              </div>
              <RoutePreview route={route} width={124} height={92} />
            </div>
            <p className="mt-2 text-meta text-ink-muted">{route.via.length ? `Via ${route.via.join(", ")}` : role.blurb}</p>
            <ul className="mt-3 flex-1 space-y-1.5">
              {reasons.map((r) => (
                <Reason key={r.t} ok={r.ok}>
                  {r.t}
                </Reason>
              ))}
              {reasons.length === 0 ? <li className="text-small text-ink-muted">No single factor stands out on this route.</li> : null}
            </ul>
            <button
              type="button"
              onClick={() => onSelect(route.id)}
              aria-pressed={selected}
              className={`btn btn-sm mt-4 w-full ${selected ? "btn-primary" : "btn-secondary"}`}
            >
              {selected ? "Shown on map" : "View this route"}
            </button>
          </article>
        );
      })}
    </div>
  );
}

/** Compact route list for the Routes side panel. */
export function RouteOptionList({ trip, selectedId, onSelect }: { trip: TripResult; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="space-y-2" aria-label="Route options">
      {trip.routes.map((route) => {
        const selected = route.id === selectedId;
        const Icon = ROLE_META[route.roles[0]!].Icon;
        return (
          <li key={route.id}>
            <button
              type="button"
              onClick={() => onSelect(route.id)}
              aria-pressed={selected}
              className={`flex w-full items-center gap-3 rounded-ctl border p-3 text-left transition-[border-color,background-color,box-shadow] ${
                selected ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/15" : "border-line bg-white hover:border-line-strong hover:shadow-[var(--shadow-panel)]"
              }`}
            >
              <ScoreRing score={route.crossScore.score} size={50} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-small font-semibold text-navy-900">
                  <Icon className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                  {rolesLabel(route.roles)}
                </span>
                <span className="tabular block text-meta text-ink-muted">
                  {formatDuration(route.durationS)} · {formatDistance(route.lengthM)}
                  {route.via.length ? ` · via ${route.via[0]}` : ""}
                </span>
                <span className="mt-0.5 block text-meta font-medium" style={{ color: BAND_HEX[route.crossScore.band.id] }}>
                  {route.crossScore.band.label}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Why the score is what it is: every factor, its contribution and its evidence. */
export function FactorBreakdown({ result, dense = false }: { result: CrossScoreResult; dense?: boolean }) {
  const factors = [...result.factors].sort((a, b) => b.weight - a.weight);
  return (
    <div>
      <ul className={dense ? "space-y-3" : "space-y-3.5"}>
        {factors.map((f) => (
          <FactorRow key={f.id} f={f} />
        ))}
      </ul>
      <p className="mt-4 flex gap-2 text-meta leading-relaxed text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {confidenceText(result)} Weights reflect the travel mode; factors without data are left out and the rest reweighted, never counted as zero.
      </p>
    </div>
  );
}

function FactorRow({ f }: { f: CrossScoreFactor }) {
  const color = f.score === null ? "#c3ccd7" : f.score >= 75 ? "#12a46f" : f.score >= 50 ? "#f0a020" : "#e5484d";
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-small font-medium text-navy-900">{f.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-meta text-ink-muted">{f.value}</span>
          <span className="tabular w-8 text-right text-small font-semibold text-navy-900">{f.score ?? "—"}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#edf0f4]" role="img" aria-label={f.score === null ? `${f.label}: not scored, data unavailable` : `${f.label}: ${f.score} out of 100`}>
        {f.score === null ? (
          <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#e6eaf0,#e6eaf0_4px,#f4f6f9_4px,#f4f6f9_8px)]" />
        ) : (
          <div className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${Math.max(3, f.score)}%`, background: color }} />
        )}
      </div>
      <p className="mt-1 text-meta leading-snug text-ink-muted">
        {f.detail} <span className="text-ink-faint">Source: {f.source}.</span>
      </p>
    </li>
  );
}

/** Positives, concerns and crash clusters for one route. */
export function RouteConcerns({ route }: { route: PlannedRoute }) {
  const { positives, concerns } = route.crossScore;
  return (
    <div className="space-y-4">
      {concerns.length ? (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-small font-semibold text-navy-900">
            <AlertTriangle className="h-4 w-4 text-critical-fg" aria-hidden /> Major concerns
          </h3>
          <ul className="space-y-1.5">
            {concerns.map((c) => (
              <Reason key={c} ok={false}>
                {c}
              </Reason>
            ))}
          </ul>
        </section>
      ) : null}
      {positives.length ? (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-small font-semibold text-navy-900">
            <Check className="h-4 w-4 text-positive-fg" aria-hidden /> In its favor
          </h3>
          <ul className="space-y-1.5">
            {positives.map((c) => (
              <Reason key={c} ok>
                {c}
              </Reason>
            ))}
          </ul>
        </section>
      ) : null}
      {route.hotspots.length ? (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-small font-semibold text-navy-900">
            <TriangleAlert className="h-4 w-4 text-critical-fg" aria-hidden /> Crash clusters on this route
          </h3>
          <ul className="divide-y divide-line rounded-chip border border-line">
            {route.hotspots.map((h) => (
              <li key={`${h.lon},${h.lat}`} className="flex items-start justify-between gap-3 px-3 py-2 text-meta">
                <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{h.label}</span>
                <span className="tabular shrink-0 text-ink-muted">
                  {h.crashes} crashes{h.pedestrian ? ` · ${h.pedestrian} ped.` : ""}
                  {h.bicyclist ? ` · ${h.bicyclist} bike` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-meta text-ink-muted">Reported crashes within 30 m of the route, grouped in 120 m stretches.</p>
        </section>
      ) : null}
    </div>
  );
}

/** When the trip happens in the dark, show the low-light crashes found along the route. */
export function LowLightNote({ when, from, route }: { when: When; from: Place; route: PlannedRoute }) {
  // "Leave at" is Georgia time (America/New_York), not the device's time zone.
  const date = when.kind === "at" ? new Date(localInputsToInstant(when.local.slice(0, 10), when.local.slice(11, 16))?.at ?? Number.NaN) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const light = lightAt(date, from.lat, from.lon);
  if (light === "daylight") return null;
  const time = clockLabel(date.getTime());
  return (
    <p className="flex gap-2 rounded-chip bg-navy-900 px-3 py-2.5 text-meta leading-relaxed text-white/90">
      <Moon className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden />
      <span>
        {when.kind === "at" ? `Leaving at ${time}` : "Right now"} it is {light === "dark" ? "dark" : "dawn or dusk"} at your starting point. {route.lowLightCrashes} of the crashes found along this route happened in low light
        (dawn, dusk or dark). CrossScore does not change by time of day.
      </span>
    </p>
  );
}

export function ModeComparisonGrid({
  comparison,
  onChoose,
  current,
  onReviewUber,
}: {
  comparison: ModeComparison;
  onChoose?: (m: PlannerMode) => void;
  current?: PlannerMode;
  /** Opens the "Review your Uber trip" panel from the Rideshare card. */
  onReviewUber?: () => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {comparison.modes.map((m) => (
        <ModeCard key={m.mode} m={m} onChoose={onChoose} active={m.mode === current} onReviewUber={m.mode === "rideshare" ? onReviewUber : undefined} />
      ))}
    </ul>
  );
}

function ModeCard({ m, onChoose, active, onReviewUber }: { m: ModeSummary; onChoose?: (m: PlannerMode) => void; active: boolean; onReviewUber?: () => void }) {
  const choosable = m.mode !== "schoolBus" && m.mode !== "shuttle" && onChoose;
  return (
    <li className={`card flex flex-col items-center p-3.5 text-center ${active ? "border-brand-500 ring-2 ring-brand-500/15" : ""}`}>
      <span className="flex items-center gap-1.5 text-small font-semibold text-navy-900">
        <ModeIcon mode={m.mode} className="h-4 w-4 text-brand-600" />
        {MODE_LABEL[m.mode]}
      </span>
      <div className="mt-2.5">{m.available && m.score !== undefined ? <ScoreRing score={m.score} size={68} /> : <span className="grid h-[68px] w-[68px] place-items-center rounded-full bg-subtle text-ink-muted"><CircleSlash className="h-6 w-6" aria-hidden /></span>}</div>
      {m.available && m.durationS !== undefined ? (
        <p className="tabular mt-2 text-small font-semibold text-navy-900">
          {formatDuration(m.durationS)}
          <span className="block text-meta font-normal text-ink-muted">{formatDistance(m.lengthM ?? 0)}</span>
        </p>
      ) : null}
      <p className="mt-1.5 flex-1 text-meta leading-snug text-ink-muted">{m.summary}</p>
      {m.nearbyStops?.length ? (
        <p className="mt-1.5 text-meta leading-snug text-ink-soft">
          {m.nearbyStops[0]!.name}
          <span className="block text-ink-muted">
            {formatDistance(m.nearbyStops[0]!.walkM)} walk · {m.nearbyStops[0]!.rail ? "Rail" : `Route ${m.nearbyStops[0]!.routes.slice(0, 3).join(", ")}`}
          </span>
        </p>
      ) : null}
      {m.unavailableReason && !m.nearbyStops?.length ? <p className="mt-1 text-meta leading-snug text-ink-faint">{m.unavailableReason}</p> : null}
      {choosable && m.available ? (
        <button type="button" onClick={() => onChoose!(m.mode as PlannerMode)} className="link mt-2 inline-flex items-center gap-1 text-meta">
          {active ? "Selected" : "View routes"} {active ? null : <ArrowRight className="h-3 w-3" aria-hidden />}
        </button>
      ) : null}
      {onReviewUber && m.available ? (
        <button type="button" onClick={onReviewUber} className="btn btn-secondary btn-sm mt-2 w-full">
          Ride with Uber <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

export function ModeGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7" aria-busy="true" aria-label="Comparing transportation modes">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="card flex flex-col items-center gap-2.5 p-3.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-[68px] w-[68px] rounded-full" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3 w-20" />
        </li>
      ))}
    </ul>
  );
}

export function RouteCardsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label="Analyzing route conditions">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="h-[92px] w-[124px]" />
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TripTiming({ route }: { route: PlannedRoute }) {
  return (
    <span className="tabular inline-flex items-center gap-3 text-small text-ink-muted">
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3.5 w-3.5" aria-hidden /> {formatDuration(route.durationS)}
      </span>
      <span className="inline-flex items-center gap-1">
        <RouteIcon className="h-3.5 w-3.5" aria-hidden /> {formatDistance(route.lengthM)}
      </span>
    </span>
  );
}
