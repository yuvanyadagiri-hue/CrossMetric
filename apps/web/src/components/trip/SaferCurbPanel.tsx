"use client";

import { useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Footprints, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ScoreRing } from "@/components/ui/CrossScoreGauge";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import type { CurbOption, Place } from "@/lib/trip-types";
import { formatDistance } from "@/lib/trip-types";
import type { UberReviewRequest } from "./UberReview";
import type { TripPlanner } from "./useTripPlanner";

function lyftLink(pickup: { lat: number; lon: number }, dropoff: Place): string {
  const p = new URLSearchParams({
    id: "lyft",
    "pickup[latitude]": pickup.lat.toFixed(6),
    "pickup[longitude]": pickup.lon.toFixed(6),
    "destination[latitude]": dropoff.lat.toFixed(6),
    "destination[longitude]": dropoff.lon.toFixed(6),
  });
  return `https://lyft.com/ride?${p.toString()}`;
}

/**
 * Safer pickup and drop-off: compares curb points within a short walk on the
 * conditions right at the curb, then hands the ride itself to the provider.
 */
export function SaferCurbPanel({ planner, onReviewUber }: { planner: TripPlanner; onReviewUber?: (req: UberReviewRequest) => void }) {
  const [purpose, setPurpose] = useState<"pickup" | "dropoff">("pickup");
  const [chosen, setChosen] = useState<Record<"pickup" | "dropoff", CurbOption | null>>({ pickup: null, dropoff: null });
  const { from, to, curb } = planner;
  if (!from || !to) return null;
  const place = purpose === "pickup" ? from : to;
  const data = curb.status === "done" && curb.data.purpose === purpose ? curb.data : null;
  const loading = curb.status === "loading";
  const pickupPoint = chosen.pickup ? { lat: chosen.pickup.lat, lon: chosen.pickup.lon, name: chosen.pickup.street } : { lat: from.lat, lon: from.lon, name: from.label };
  const dropPlace: Place = chosen.dropoff ? { ...to, lat: chosen.dropoff.lat, lon: chosen.dropoff.lon } : to;
  // A chosen curb point replaces that end of the trip in the Uber review; otherwise the trip's own places are used.
  const curbSeed = (o: CurbOption | null, near: Place, what: string) =>
    o ? { latitude: o.lat, longitude: o.lon, name: o.street === "Unnamed street" ? `${what} near ${near.label}` : o.street, address: `${what} near ${near.label}` } : undefined;
  const uberRequest: UberReviewRequest = { pickup: curbSeed(chosen.pickup, from, "Curb pickup"), dropoff: curbSeed(chosen.dropoff, to, "Curb drop-off") };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Curb point to compare"
          size="sm"
          value={purpose}
          onChange={(v) => setPurpose(v)}
          options={[
            { id: "pickup", label: "Safer pickup" },
            { id: "dropoff", label: "Safer drop-off" },
          ]}
        />
        <Button variant="secondary" size="sm" icon={<MapPinned className="h-4 w-4" aria-hidden />} loading={loading} onClick={() => planner.loadCurb(purpose, place)}>
          Compare {purpose === "pickup" ? "pickup" : "drop-off"} points
        </Button>
      </div>
      <p className="text-meta leading-relaxed text-ink-muted">
        Curb points within a {purpose === "pickup" ? "short walk of your start" : "short walk of your destination"} are compared on lanes, traffic, posted speed and crashes within 50 m. Entrances and
        official pickup zones are not in public data yet, so check signs on site.
      </p>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Comparing curb points">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : curb.status === "error" ? (
        <ErrorState title="Curb points could not be compared">{curb.error.error}</ErrorState>
      ) : data ? (
        data.options.length === 0 ? (
          <EmptyState compact title="No curb points within a short walk">The routing network has no drivable street within 250 m of this place.</EmptyState>
        ) : (
          <>
            {data.recommendedId === null ? (
              <p className="flex items-center gap-2 rounded-chip bg-positive-bg px-3 py-2 text-small font-medium text-positive-fg">
                <Check className="h-4 w-4" aria-hidden /> The closest curb already has among the best conditions within a short walk.
              </p>
            ) : null}
            <ul className="space-y-2">
              {data.options.map((o) => {
                const best = o.id === data.recommendedId;
                const isChosen = chosen[purpose]?.id === o.id || (!chosen[purpose] && o.current);
                return (
                  <li key={o.id} className={`flex items-center gap-3 rounded-ctl border p-3 ${best ? "border-positive bg-positive-bg/40" : "border-line bg-white"}`}>
                    <ScoreRing score={o.score.score} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-small font-semibold text-navy-900">
                        {o.current ? "Closest curb" : best ? "Recommended" : "Alternative"}
                        <span className="font-normal text-ink-muted">· {o.street}</span>
                      </p>
                      <p className="flex items-center gap-1 text-meta text-ink-muted">
                        <Footprints className="h-3.5 w-3.5" aria-hidden /> {o.walkM < 15 ? "At your location" : `${formatDistance(o.walkM)} walk`}
                        {" · "}
                        {o.score.factors
                          .filter((f) => f.score !== null)
                          .slice(0, 2)
                          .map((f) => f.value)
                          .join(" · ")}
                      </p>
                      {o.reasons.length ? <p className="mt-0.5 text-meta text-positive-fg">{o.reasons.join(" · ")}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setChosen((c) => ({ ...c, [purpose]: o }))}
                      aria-pressed={isChosen}
                      className={`btn btn-sm ${isChosen ? "btn-primary" : "btn-secondary"}`}
                    >
                      {isChosen ? "Using" : "Use"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : null}

      <div className="rounded-ctl border border-line bg-subtle/60 p-3">
        <p className="text-meta font-semibold text-navy-900">Book the ride with a provider</p>
        <p className="mt-0.5 text-meta text-ink-muted">
          Opens the provider with {chosen.pickup ? `pickup on ${chosen.pickup.street}` : "your start as the pickup"}. CrossMetric does not show prices or driver availability.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {onReviewUber ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onReviewUber(uberRequest)}>
              Review Uber trip <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <a className="btn btn-secondary btn-sm" href={lyftLink(pickupPoint, dropPlace)} target="_blank" rel="noopener noreferrer">
            Open in Lyft <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}
