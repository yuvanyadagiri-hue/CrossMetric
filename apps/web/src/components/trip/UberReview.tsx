"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import { ArrowUpRight, CarTaxiFront, Check, Circle, Info, MapPin, Route as RouteIcon } from "lucide-react";
import { PlaceCombobox } from "@/components/search/PlaceCombobox";
import { Button } from "@/components/ui/Button";
import { ScoreRing } from "@/components/ui/CrossScoreGauge";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import type { Place } from "@/lib/trip-types";
import { formatDistance, formatDuration } from "@/lib/trip-types";
import { buildUberRideLink, placeAddress, readUberClientId, UBER_TEXT_MAX, type UberLinkIssue, type UberStop, type UberStopRole } from "@/lib/uber";
import type { TripPlanner } from "./useTripPlanner";

/**
 * "Review your Uber trip": the one place CrossMetric hands a trip to Uber.
 * Every entry point (mode comparison, rideshare results, safer pickup) opens
 * this same panel on the planner's current trip. The rider checks or edits
 * pickup and destination; Uber then shows prices and availability and the
 * rider requests the ride there.
 */

/** A stop that replaces the trip's own start or destination, e.g. a safer curb point. */
export interface UberStopSeed {
  latitude: number;
  longitude: number;
  name: string;
  address?: string;
}

export interface UberReviewRequest {
  pickup?: UberStopSeed;
  dropoff?: UberStopSeed;
}

interface StopDraft {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
}

type TripSource =
  | { status: "ready"; from: Place; to: Place }
  | { status: "example" | "none" | "loading" | "stale" };

const samePoint = (a: Place, b: Place) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;

/** The trip the rider has planned and analyzed — never the dashboard's example. */
function tripSource(planner: TripPlanner): TripSource {
  if (planner.examplePlaces) return { status: "example" };
  if (!planner.from || !planner.to) return { status: "none" };
  const analyzed = planner.tripData ?? planner.modesData;
  if (planner.trip.status === "loading" || planner.modes.status === "loading") return { status: "loading" };
  if (!analyzed) return { status: "none" };
  if (!samePoint(analyzed.from, planner.from) || !samePoint(analyzed.to, planner.to)) return { status: "stale" };
  return { status: "ready", from: analyzed.from, to: analyzed.to };
}

function draftFrom(place: Place, seed?: UberStopSeed): StopDraft {
  if (seed) return { latitude: seed.latitude, longitude: seed.longitude, name: seed.name, address: seed.address ?? "" };
  return { latitude: place.lat, longitude: place.lon, name: place.label, address: placeAddress(place) ?? "" };
}

const toStop = (d: StopDraft): UberStop => ({ latitude: d.latitude, longitude: d.longitude, name: d.name, address: d.address });

/** Focus the page's trip planner (PlannerCard marks itself with data-trip-planner). */
function focusPlanner() {
  const input = document.querySelector<HTMLInputElement>("[data-trip-planner] input[role='combobox']");
  input?.scrollIntoView({ behavior: "smooth", block: "center" });
  input?.focus({ preventScroll: true });
}

/** State and panel for one page. Render `uberReviewPanel` once; call `openUberReview` from any entry point. */
export function useUberReview(planner: TripPlanner) {
  const [request, setRequest] = useState<UberReviewRequest | null>(null);
  const openUberReview = useCallback((req: UberReviewRequest = {}) => setRequest(req), []);
  const close = useCallback(() => setRequest(null), []);
  const source = tripSource(planner);
  const key = source.status === "ready" ? `${source.from.lon},${source.from.lat}>${source.to.lon},${source.to.lat}` : source.status;
  const uberReviewPanel = (
    <Sheet
      open={request !== null}
      onClose={close}
      title="Review your Uber trip"
      description="Check where you'll be picked up and dropped off. Uber shows prices and ride options before you request."
    >
      {request ? <ReviewBody key={key} planner={planner} source={source} request={request} onClose={close} /> : null}
    </Sheet>
  );
  return { openUberReview, uberReviewPanel };
}

function ReviewBody({ planner, source, request, onClose }: { planner: TripPlanner; source: TripSource; request: UberReviewRequest; onClose: () => void }) {
  if (source.status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Analyzing your trip">
        <p className="text-small font-medium text-ink-muted">Analyzing your trip…</p>
        <Skeleton className="h-[88px] w-full" />
        <Skeleton className="h-[160px] w-full" />
        <Skeleton className="h-[160px] w-full" />
      </div>
    );
  }
  if (source.status !== "ready") {
    const goToPlanner = () => {
      onClose();
      // After the panel has closed and returned focus to its opener.
      setTimeout(focusPlanner, 30);
    };
    const copy: [string, string] = {
      none: ["Plan your trip first", "Enter a starting point and a destination in the trip planner, then choose “Find safer routes”. CrossMetric only sends Uber a trip you have planned and confirmed."],
      example: ["This is an example trip", "CrossMetric shows an example trip so you can see how scoring works. Enter your own starting point and destination in the trip planner to continue in Uber."],
      stale: ["Your trip has changed", "The pickup or destination in the planner no longer matches the analyzed trip. Choose “Find safer routes” to update it, then review your Uber trip."],
    }[source.status] as [string, string];
    return (
      <EmptyState
        icon={<CarTaxiFront className="h-5 w-5" />}
        title={copy[0]}
        action={
          <Button size="sm" onClick={goToPlanner}>
            Go to trip planner
          </Button>
        }
      >
        {copy[1]}
      </EmptyState>
    );
  }
  return <ReviewForm planner={planner} from={source.from} to={source.to} request={request} onClose={onClose} />;
}

function ReviewForm({ planner, from, to, request, onClose }: { planner: TripPlanner; from: Place; to: Place; request: UberReviewRequest; onClose: () => void }) {
  const [pickup, setPickup] = useState<StopDraft>(() => draftFrom(from, request.pickup));
  const [dropoff, setDropoff] = useState<StopDraft>(() => draftFrom(to, request.dropoff));
  const [launched, setLaunched] = useState(false);
  const issuesId = useId();
  const clientId = readUberClientId();
  const link = buildUberRideLink({ pickup: toStop(pickup), dropoff: toStop(dropoff), clientId });
  const issues = link.ok ? [] : link.issues;
  const issueFor = (field: UberLinkIssue["field"]) => issues.filter((i) => i.field === field);
  const moved = Math.abs(pickup.latitude - from.lat) + Math.abs(pickup.longitude - from.lon) > 4e-4 || Math.abs(dropoff.latitude - to.lat) + Math.abs(dropoff.longitude - to.lon) > 4e-4;

  return (
    <div className="flex min-h-full flex-col gap-5">
      <TripSummary planner={planner} pickup={pickup} dropoff={dropoff} moved={moved} />

      <StopFields role="pickup" draft={pickup} onChange={(d) => (setPickup(d), setLaunched(false))} issues={issueFor("pickup")} />
      <StopFields role="dropoff" draft={dropoff} onChange={(d) => (setDropoff(d), setLaunched(false))} issues={issueFor("dropoff")} />

      <section aria-labelledby={`${issuesId}-uber`} className="rounded-ctl bg-subtle/70 p-3.5">
        <h3 id={`${issuesId}-uber`} className="text-small font-semibold text-navy-900">
          What happens in Uber
        </h3>
        <ul className="mt-2 space-y-1.5 text-meta leading-snug text-ink-soft">
          {["Uber shows ride options and prices for this trip.", "Uber checks availability and your account.", "You confirm and request the ride in Uber."].map((t) => (
            <li key={t} className="flex gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-meta leading-snug text-ink-muted">CrossMetric doesn&apos;t book rides, see prices, or connect to your Uber account. It only passes these two locations to Uber.</p>
      </section>

      {issueFor("config").length ? (
        <div id={`${issuesId}-config`}>
          <ErrorState kind="warning" title="Uber handoff isn't set up yet">
            This CrossMetric site has no Uber client ID configured, so it can&apos;t send your trip to Uber. The site owner needs to set <code className="font-mono text-meta">NEXT_PUBLIC_UBER_CLIENT_ID</code>.
          </ErrorState>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-5 mt-auto space-y-3 border-t border-line bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
        <div id={issuesId} aria-live="polite" className="space-y-2 empty:hidden">
          {issueFor("trip").map((i) => (
            <p key={i.message} className="text-small font-medium text-critical-fg">
              {i.message}
            </p>
          ))}
          {launched ? (
            <p className="flex gap-2 rounded-chip bg-positive-bg px-3 py-2 text-meta font-medium text-positive-fg">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Uber opened with your pickup and destination. Review the price and request your ride there.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {launched ? "Done" : "Cancel"}
          </Button>
          {link.ok ? (
            <a className="btn btn-primary" href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => setLaunched(true)}>
              Continue in Uber <ArrowUpRight className="h-4 w-4" aria-hidden />
              <span className="sr-only">(opens Uber in a new tab or the Uber app)</span>
            </a>
          ) : (
            <Button disabled aria-describedby={`${issuesId} ${issuesId}-config`} trailingIcon={<ArrowUpRight className="h-4 w-4" aria-hidden />}>
              Continue in Uber
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact pickup → destination summary with the rideshare analysis CrossMetric already ran. */
function TripSummary({ planner, pickup, dropoff, moved }: { planner: TripPlanner; pickup: StopDraft; dropoff: StopDraft; moved: boolean }) {
  const route = planner.mode === "rideshare" && planner.tripData?.mode === "drive" ? planner.selectedRoute : null;
  const summary = planner.modesData?.modes.find((m) => m.mode === "rideshare" && m.available);
  const score = route?.crossScore.score ?? summary?.score;
  const band = route?.crossScore.band.label ?? summary?.band?.label;
  const durationS = route?.durationS ?? summary?.durationS;
  const lengthM = route?.lengthM ?? summary?.lengthM;
  return (
    <section aria-label="Trip summary" className="rounded-ctl border border-line bg-white p-3.5 shadow-[var(--shadow-panel)]">
      <ol className="relative space-y-3 pl-6">
        <span aria-hidden className="absolute bottom-[14px] left-[6px] top-[14px] w-px bg-line-strong" />
        <SummaryStop icon={<Circle className="h-3 w-3 fill-navy-900 text-navy-900" aria-hidden />} label="Pickup" name={pickup.name} address={pickup.address} />
        <SummaryStop icon={<MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden />} label="Destination" name={dropoff.name} address={dropoff.address} />
      </ol>
      {score !== undefined ? (
        <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
          <ScoreRing score={score} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-small font-semibold text-navy-900">
              Rideshare CrossScore {score}
              {band ? <span className="font-normal text-ink-muted"> · {band}</span> : null}
            </p>
            {durationS !== undefined && lengthM !== undefined ? (
              <p className="tabular flex items-center gap-1 text-meta text-ink-muted">
                <RouteIcon className="h-3.5 w-3.5" aria-hidden /> About {formatDuration(durationS)} · {formatDistance(lengthM)} by car{route ? `, ${route.via[0] ? `via ${route.via[0]}` : "selected route"}` : ""}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {moved && score !== undefined ? (
        <p className="mt-2 flex gap-1.5 text-meta leading-snug text-ink-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> You changed a stop, so this score describes your planned trip, not the edited one. Uber chooses the driver&apos;s route.
        </p>
      ) : (
        <p className="mt-2 text-meta leading-snug text-ink-muted">Based on available crash, road and infrastructure data — not a guarantee of safety. Uber chooses the driver&apos;s route.</p>
      )}
    </section>
  );
}

function SummaryStop({ icon, label, name, address }: { icon: ReactNode; label: string; name: string; address: string }) {
  return (
    <li className="relative">
      <span className="absolute -left-6 top-[3px] grid h-[14px] w-[14px] place-items-center bg-white">{icon}</span>
      <p className="eyebrow">{label}</p>
      <p className="truncate text-small font-semibold text-navy-900">{name.trim() || "Pinned location"}</p>
      {address.trim() ? <p className="truncate text-meta text-ink-muted">{address}</p> : null}
    </li>
  );
}

const ROLE_COPY: Record<UberStopRole, { title: string; search: string; placeholder: string }> = {
  pickup: { title: "Pickup", search: "Change pickup location", placeholder: "Search a Georgia address or place" },
  dropoff: { title: "Destination", search: "Change destination", placeholder: "Search a Georgia address, school or place" },
};

function StopFields({ role, draft, onChange, issues }: { role: UberStopRole; draft: StopDraft; onChange: (d: StopDraft) => void; issues: UberLinkIssue[] }) {
  const id = useId();
  const copy = ROLE_COPY[role];
  const current: Place = { label: draft.name.trim() || "Pinned location", lon: draft.longitude, lat: draft.latitude, kind: "place" };
  const errorId = `${id}-error`;
  return (
    <fieldset className="space-y-3" aria-describedby={issues.length ? errorId : undefined}>
      <legend className="flex items-center gap-2 text-small font-semibold text-navy-900">
        {role === "pickup" ? <Circle className="h-3 w-3 fill-navy-900 text-navy-900" aria-hidden /> : <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden />}
        {copy.title}
      </legend>
      <PlaceCombobox
        label={copy.search}
        visibleLabel
        value={current}
        placeholder={copy.placeholder}
        onSelect={(p) => onChange({ latitude: p.lat, longitude: p.lon, name: p.label, address: placeAddress(p) ?? "" })}
      />
      <div className="grid gap-3">
        <div>
          <label htmlFor={`${id}-name`} className="field-label mb-1.5">
            Name shown in Uber
          </label>
          <input id={`${id}-name`} className="input" value={draft.name} maxLength={UBER_TEXT_MAX} autoComplete="off" onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder={role === "pickup" ? "e.g. Main entrance" : "e.g. Front office"} />
        </div>
        <div>
          <label htmlFor={`${id}-address`} className="field-label mb-1.5">
            Address shown in Uber <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input id={`${id}-address`} className="input" value={draft.address} maxLength={UBER_TEXT_MAX} autoComplete="off" onChange={(e) => onChange({ ...draft, address: e.target.value })} placeholder="Street, city" />
        </div>
      </div>
      <p className="tabular text-meta leading-snug text-ink-muted">
        Uber places the pin at latitude {draft.latitude.toFixed(5)}, longitude {draft.longitude.toFixed(5)}. The name and address are labels only; change the location above to move the pin.
      </p>
      {issues.length ? (
        <p id={errorId} role="alert" className="text-small font-medium text-critical-fg">
          {issues.map((i) => i.message).join(" ")}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Rideshare results call-to-action that opens the review panel. */
export function UberHandoffCard({ onReview, className = "" }: { onReview: () => void; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 rounded-ctl border border-line bg-white p-3.5 sm:flex-row sm:items-center ${className}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-navy-900 text-white" aria-hidden>
        <CarTaxiFront className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold text-navy-900">Ride with Uber</p>
        <p className="text-meta leading-snug text-ink-muted">Confirm your pickup and destination, then see prices and request the ride in Uber.</p>
      </div>
      <Button size="sm" onClick={onReview} className="shrink-0">
        Review Uber trip
      </Button>
    </div>
  );
}
