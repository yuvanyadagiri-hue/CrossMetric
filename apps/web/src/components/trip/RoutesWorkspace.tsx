"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, Link2 } from "lucide-react";
import { TripMap } from "@/components/map/TripMap";
import { Tabs } from "@/components/ui/primitives";
import { ErrorState, EmptyState, Skeleton } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { tripHref } from "@/lib/place-url";
import { useSaved } from "@/lib/saved";
import { MODE_LABEL } from "./modeMeta";
import { PlannerCard } from "./PlannerCard";
import { rolesLabel } from "./routeMeta";
import { SaferCurbPanel } from "./SaferCurbPanel";
import { CrossScoreSummary, FactorBreakdown, LowLightNote, ModeComparisonGrid, ModeGridSkeleton, RouteConcerns, RouteOptionList } from "./TripPanels";
import { UberHandoffCard, useUberReview } from "./UberReview";
import { useTripPlanner } from "./useTripPlanner";

type Tab = "routes" | "why" | "modes" | "curb";

export function RoutesWorkspace({ params }: { params: { from?: string | null; to?: string | null; mode?: string | null } }) {
  const planner = useTripPlanner({ params });
  const { openUberReview, uberReviewPanel } = useUberReview(planner);
  const [tab, setTab] = useState<Tab>("routes");
  const { tripData, selectedRoute, modesData } = planner;
  const { isSaved, toggle } = useSaved();
  const [copied, setCopied] = useState(false);
  const curbData = planner.curb.status === "done" ? planner.curb.data : null;

  const tripId = planner.from && planner.to ? `${planner.from.lon.toFixed(4)},${planner.from.lat.toFixed(4)}>${planner.to.lon.toFixed(4)},${planner.to.lat.toFixed(4)}:${planner.mode}` : null;
  const shareable = planner.from && planner.to && planner.from.kind !== "current";

  const tabs: { id: Tab; label: string }[] = [
    { id: "routes", label: "Routes" },
    { id: "why", label: "Why this score" },
    { id: "modes", label: "Modes" },
    ...(planner.mode === "rideshare" ? [{ id: "curb" as const, label: "Safer pickup" }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "routes";

  return (
    <div className="grid flex-1 grid-cols-1 lg:h-[calc(100dvh-64px)] lg:flex-none lg:grid-cols-[440px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-white" aria-label="Trip planner and results">
        <div className="border-b border-line p-4">
          <h1 className="mb-3 text-component font-semibold text-navy-900">Plan a safer trip</h1>
          <PlannerCard planner={planner} compact />
        </div>
        <div className="px-4 pt-1">
          <Tabs label="Trip results" tabs={tabs} active={activeTab} onChange={setTab} size="sm" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin" role="tabpanel">
          {!planner.from || !planner.to ? (
            <EmptyState title="Where are you going?">Choose a starting point and a school, college or address. CrossMetric will compare the safest, balanced and fastest routes.</EmptyState>
          ) : activeTab === "modes" ? (
            modesData ? (
              <div className="[&_ul]:!grid-cols-2">
                <ModeComparisonGrid
                  comparison={modesData}
                  current={planner.mode}
                  onChoose={(m) => (planner.setMode(m), planner.run({ mode: m }), setTab("routes"))}
                  onReviewUber={() => openUberReview()}
                />
              </div>
            ) : planner.modes.status === "error" ? (
              <ErrorState title="Modes could not be compared">{planner.modes.error.error}</ErrorState>
            ) : planner.modes.status === "idle" ? (
              <EmptyState compact title="Find routes first">Choose “Find safer routes” to compare every mode for this trip.</EmptyState>
            ) : (
              <div className="[&_ul]:!grid-cols-2">
                <ModeGridSkeleton count={4} />
              </div>
            )
          ) : activeTab === "curb" ? (
            <SaferCurbPanel planner={planner} onReviewUber={openUberReview} />
          ) : planner.mode === "transit" ? (
            <EmptyState title="Transit rides aren't scored">
              CrossMetric shows MARTA stops near your start and destination (see Modes) but does not calculate transit schedules. Walking to the stop can be scored: plan a walking trip to it.
            </EmptyState>
          ) : planner.trip.status === "error" && !tripData ? (
            <ErrorState
              title={planner.trip.error.kind === "no_route" ? `No ${MODE_LABEL[planner.mode].toLowerCase()} route could be calculated for this destination.` : "This trip could not be analyzed right now."}
              action={
                <div className="flex gap-2">
                  {planner.trip.error.kind === "no_route" ? (
                    <Button size="sm" variant="secondary" onClick={() => (planner.setMode(planner.mode === "walk" ? "drive" : "walk"), planner.run({ mode: planner.mode === "walk" ? "drive" : "walk" }))}>
                      Try another mode
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => planner.run()}>
                    Try again
                  </Button>
                </div>
              }
            >
              {planner.trip.error.error}
            </ErrorState>
          ) : !tripData ? (
            planner.trip.status === "loading" ? (
              <div className="space-y-3" aria-busy="true" aria-label="Analyzing route conditions">
                <p className="text-small font-medium text-ink-muted">Analyzing route conditions…</p>
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-[76px] w-full" />
                ))}
              </div>
            ) : (
              <EmptyState compact title="Ready when you are">Choose “Find safer routes”.</EmptyState>
            )
          ) : activeTab === "routes" ? (
            <div className="space-y-5 animate-[var(--animate-fade-in)]">
              {selectedRoute ? <CrossScoreSummary route={selectedRoute} to={tripData.to} onDetails={() => setTab("why")} /> : null}
              <RouteOptionList trip={tripData} selectedId={planner.selectedRouteId} onSelect={planner.setSelectedRouteId} />
              {planner.mode === "rideshare" ? <UberHandoffCard onReview={() => openUberReview()} /> : null}
              {selectedRoute && planner.from ? <LowLightNote when={planner.when} from={planner.from} route={selectedRoute} /> : null}
              {selectedRoute ? <RouteConcerns route={selectedRoute} /> : null}
              {tripData.notes.length ? <p className="text-meta text-ink-muted">{tripData.notes.join(" ")}</p> : null}
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {tripId && shareable ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={isSaved("trip", tripId) ? <BookmarkCheck className="h-4 w-4 text-brand-600" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
                    onClick={() => toggle({ kind: "trip", id: tripId, label: `${planner.from!.label} → ${planner.to!.label} (${MODE_LABEL[planner.mode]})`, href: tripHref("/routes", planner.from, planner.to, planner.mode) })}
                  >
                    {isSaved("trip", tripId) ? "Saved" : "Save trip"}
                  </Button>
                ) : null}
                {shareable ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Link2 className="h-4 w-4" aria-hidden />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(window.location.href);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? "Link copied" : "Copy link"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : selectedRoute ? (
            <div className="space-y-4 animate-[var(--animate-fade-in)]">
              <p className="text-small text-ink-muted">
                {rolesLabel(selectedRoute.roles)} · CrossScore {selectedRoute.crossScore.score}
              </p>
              <FactorBreakdown result={selectedRoute.crossScore} dense />
            </div>
          ) : null}
        </div>
      </aside>
      <section className="relative h-[70vh] min-h-[420px] lg:h-auto" aria-label="Route map">
        <TripMap
          trip={tripData ?? null}
          from={planner.from}
          to={planner.to}
          selectedRouteId={planner.selectedRouteId}
          onSelectRoute={(id) => (planner.setSelectedRouteId(id), setTab("routes"))}
          loading={planner.trip.status === "loading"}
          curb={activeTab === "curb" ? curbData : null}
          className="h-full w-full"
          layers={{ transit: planner.mode === "transit" }}
          padding={{ top: 70, right: 70, bottom: 60, left: 260 }}
        />
      </section>
      {uberReviewPanel}
    </div>
  );
}
