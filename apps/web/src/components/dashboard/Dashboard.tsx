"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowRight, Database, FileText, Gauge, Map as MapIcon, Navigation, Sparkles } from "lucide-react";
import { InstitutionCard } from "@/components/institutions/InstitutionCard";
import { TripMap } from "@/components/map/TripMap";
import { RecentReports } from "@/components/reports/RecentReports";
import { PlannerCard } from "@/components/trip/PlannerCard";
import { RoutePreview } from "@/components/trip/RoutePreview";
import { rolesLabel } from "@/components/trip/routeMeta";
import {
  CrossScoreSummary,
  FactorBreakdown,
  LowLightNote,
  ModeComparisonGrid,
  ModeGridSkeleton,
  RouteCardsSkeleton,
  RouteConcerns,
  RouteOptionCards,
} from "@/components/trip/TripPanels";
import { ScoreRing } from "@/components/ui/CrossScoreGauge";
import { Card, CardHeader, SectionHeading } from "@/components/ui/Card";
import { Badge, bandTone } from "@/components/ui/Status";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ModeIcon, MODE_LABEL } from "@/components/trip/modeMeta";
import { UberHandoffCard, useUberReview } from "@/components/trip/UberReview";
import { useTripPlanner } from "@/components/trip/useTripPlanner";
import { loadInstitutionRows, nearestInstitutions, type InstitutionRow } from "@/lib/institutions-client";
import { tripHref } from "@/lib/place-url";
import type { Place } from "@/lib/trip-types";
import { formatDistance, formatDuration } from "@/lib/trip-types";

export interface DashboardFacts {
  schools: number;
  colleges: number;
  crashes: number;
  window: { start: string; end: string };
  windowLabel: string;
  roadKm: number | null;
  transitFeed: string | null;
  processed: string;
}

/** Real, clearly labelled example trip shown until someone plans their own. */
const EXAMPLE: { from: Place; to: Place; mode: "walk" } = {
  from: { label: "Midtown Station", sublabel: "MARTA rail · Atlanta, GA", lon: -84.38663, lat: 33.78095, kind: "place" },
  to: { label: "Georgia Institute of Technology", sublabel: "College · Atlanta, GA", lon: -84.394832, lat: 33.77242, kind: "college", id: "139755" },
  mode: "walk",
};

/** True on desktop widths, where the planner overlaps the map's lower-left corner. */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

export function Dashboard({ facts, params }: { facts: DashboardFacts; params: { from?: string | null; to?: string | null; mode?: string | null } }) {
  const planner = useTripPlanner({ fallback: EXAMPLE, params });
  const { openUberReview, uberReviewPanel } = useUberReview(planner);
  const { tripData, selectedRoute, modesData } = planner;
  const [institutions, setInstitutions] = useState<InstitutionRow[] | null>(null);
  const wide = useWideScreen();
  useEffect(() => {
    loadInstitutionRows().then(setInstitutions).catch(() => setInstitutions([]));
  }, []);

  const near = useMemo(() => {
    if (!institutions || !planner.to) return [];
    return nearestInstitutions(institutions, planner.to.lon, planner.to.lat, 4);
  }, [institutions, planner.to]);

  const routesHref = tripHref("/routes", planner.from, planner.to, planner.mode);
  const routed = planner.mode !== "transit";
  const tripLoading = planner.trip.status === "loading" && !tripData;
  const tripError = planner.trip.status === "error" ? planner.trip.error : null;
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="pb-16">
      {/* HERO: headline + planner + live map */}
      <section className="relative bg-navy-900" aria-labelledby="hero-title">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <svg className="absolute inset-0 h-full w-full opacity-[0.07]" preserveAspectRatio="none">
            <defs>
              <pattern id="hero-grid" width="44" height="44" patternUnits="userSpaceOnUse">
                <path d="M44 0H0V44" fill="none" stroke="#fff" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hero-grid)" />
          </svg>
        </div>
        <div className="relative mx-auto grid w-full max-w-[1600px] lg:min-h-[600px] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="relative z-10 flex flex-col justify-center px-4 pb-6 pt-10 sm:px-6 lg:py-12 lg:pr-0">
            <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-meta font-semibold text-white/85 ring-1 ring-inset ring-white/15">
              Safer routes. Brighter futures.
            </p>
            <h1 id="hero-title" className="mt-5 text-display font-semibold leading-[1.04] text-white sm:text-display xl:text-display">
              Safety intelligence
              <br />
              for how <span className="text-brand-300">students move.</span>
            </h1>
            <p className="mt-4 max-w-[540px] text-body leading-relaxed text-white/75 sm:text-component">
              CrossMetric combines transportation, roadway, infrastructure, and safety data to help you understand and compare different ways to travel.
            </p>
            <div className="mt-7 lg:mr-[-170px] xl:mr-[-220px]">
              <PlannerCard planner={planner} onSubmitted={() => window.innerWidth < 1024 && scrollTo("trip-map")} />
            </div>
          </div>
          <div id="trip-map" className="relative min-h-[420px] lg:min-h-0">
            <div className="absolute inset-0">
              <TripMap
                trip={tripData ?? null}
                from={planner.from}
                to={planner.to}
                selectedRouteId={planner.selectedRouteId}
                onSelectRoute={planner.setSelectedRouteId}
                loading={planner.trip.status === "loading"}
                className="h-full w-full"
                padding={wide ? { top: 90, right: 70, bottom: 60, left: 260 } : { top: 70, right: 40, bottom: 50, left: 40 }}
              />
            </div>
            {planner.example ? (
              <p className="pointer-events-none absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-meta font-medium text-ink-soft shadow-[var(--shadow-float)]">
                <Sparkles className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                Example trip, scored live — plan your own
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6">
        {tripError ? (
          <div className="mt-6">
            <ErrorState
              title={tripError.kind === "no_route" ? `No ${MODE_LABEL[planner.mode].toLowerCase()} route could be calculated for this destination.` : "This trip could not be analyzed right now."}
              action={
                <div className="flex flex-wrap gap-2">
                  {tripError.kind === "no_route" ? (
                    <Button size="sm" variant="secondary" onClick={() => planner.run({ mode: planner.mode === "walk" ? "drive" : "walk" })}>
                      Try another mode
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => planner.run()}>
                    Try again
                  </Button>
                </div>
              }
            >
              {tripError.error}
            </ErrorState>
          </div>
        ) : null}

        {/* SUMMARY ROW */}
        <div className="relative z-10 mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1.15fr_1fr]">
          <Card className="p-5" aria-label="Your CrossScore">
            {selectedRoute && planner.to ? (
              <CrossScoreSummary route={selectedRoute} to={tripData?.to ?? planner.to} onDetails={() => scrollTo("breakdown")} />
            ) : tripLoading ? (
              <div className="flex items-center gap-5" aria-busy="true" aria-label="Analyzing route conditions">
                <Skeleton className="h-[116px] w-[136px] rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-6 w-28" />
                </div>
              </div>
            ) : (
              <EmptyState compact icon={<Gauge className="h-5 w-5" />} title={routed ? "Plan a trip to see its CrossScore" : "Transit trips aren't scored"}>
                {routed ? "CrossScore summarizes the conditions along a route from crash, road and infrastructure data." : "CrossMetric shows nearby stops but does not calculate transit schedules. Compare walking to the stop below."}
              </EmptyState>
            )}
          </Card>

          <Card className="p-5">
            <CardHeader
              icon={<Navigation className="h-4 w-4" />}
              title={selectedRoute ? rolesLabel(selectedRoute.roles) : "Recommended route"}
              subtitle={selectedRoute ? `${formatDuration(selectedRoute.durationS)} · ${formatDistance(selectedRoute.lengthM)}` : "Safest practical option"}
            />
            {selectedRoute ? (
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="flex items-baseline gap-1">
                    <span className="tabular text-page font-semibold text-navy-900">{selectedRoute.crossScore.score}</span>
                    <span className="text-small text-ink-muted">/ 100</span>
                  </p>
                  <p className="mt-1 max-w-[180px] text-meta leading-snug text-ink-muted">{selectedRoute.crossScore.positives[0] ?? selectedRoute.crossScore.band.label}</p>
                </div>
                <RoutePreview route={selectedRoute} width={132} height={100} />
              </div>
            ) : (
              <div className="mt-3 flex gap-3">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-[100px] w-[132px]" />
              </div>
            )}
          </Card>

          <Card className="p-5">
            <CardHeader icon={<MapIcon className="h-4 w-4" />} title="Transportation modes" subtitle="Compare all ways to get there" />
            {modesData ? (
              <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {modesData.modes
                  .filter((m) => m.mode !== "schoolBus" && m.mode !== "shuttle")
                  .map((m) => (
                    <li key={m.mode}>
                      <button
                        type="button"
                        onClick={() => {
                          if (m.mode === "schoolBus" || m.mode === "shuttle") return;
                          planner.setMode(m.mode);
                          planner.run({ mode: m.mode });
                        }}
                        className={`flex w-full flex-col items-center gap-1 rounded-chip border px-1 py-2 transition-colors ${m.mode === planner.mode ? "border-brand-500 bg-brand-50/60" : "border-line hover:border-line-strong"}`}
                        aria-label={`${MODE_LABEL[m.mode]}: ${m.score !== undefined ? `CrossScore ${m.score}` : m.summary}`}
                      >
                        <ModeIcon mode={m.mode} className="h-4 w-4 text-brand-600" />
                        <span className={`tabular text-body font-semibold ${m.score !== undefined ? "text-navy-900" : "text-ink-faint"}`}>{m.score ?? "—"}</span>
                        <span className="text-meta text-ink-muted">{MODE_LABEL[m.mode]}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <div className="mt-3 grid grid-cols-5 gap-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-[74px]" />
                ))}
              </div>
            )}
            <button type="button" onClick={() => scrollTo("modes")} className="link mt-3 inline-flex items-center gap-1 text-small">
              See full comparison <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Card>

          <Card className="p-5">
            <CardHeader icon={<FileText className="h-4 w-4" />} title="Recent reports" subtitle="Community reports near your route" />
            <div className="mt-2">
              <RecentReports near={selectedRoute?.geometry} limit={4} compact />
            </div>
            <Link href="/reports" className="link mt-3 inline-flex items-center gap-1 text-small">
              View all community reports <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Card>
        </div>

        {/* ROUTE COMPARISON */}
        {routed ? (
          <section className="mt-12" aria-labelledby="routes-title">
            <SectionHeading
              id="routes-title"
              title="Best ways to get there"
              subtitle={planner.to ? `Compare route options to ${planner.to.label}. Each one is scored on the same data.` : "Compare route options."}
              action={
                <ButtonLink href={routesHref} variant="secondary" size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />}>
                  Open in Routes
                </ButtonLink>
              }
            />
            {tripData ? (
              <>
                <RouteOptionCards trip={tripData} selectedId={planner.selectedRouteId} onSelect={(id) => {
                  planner.setSelectedRouteId(id);
                  scrollTo("trip-map");
                }} />
                {tripData.notes.length ? <p className="mt-3 text-meta text-ink-muted">{tripData.notes.join(" ")}</p> : null}
                {planner.mode === "rideshare" ? <UberHandoffCard className="mt-4" onReview={() => openUberReview()} /> : null}
              </>
            ) : tripLoading ? (
              <RouteCardsSkeleton />
            ) : null}
          </section>
        ) : null}

        {/* MODE COMPARISON */}
        <section id="modes" className="mt-12 scroll-mt-24" aria-labelledby="modes-title">
          <SectionHeading
            id="modes-title"
            title="Compare transportation modes"
            subtitle={planner.from && planner.to ? `Estimated CrossScores and travel times from ${planner.from.label} to ${planner.to.label}, each on that mode's default route.` : undefined}
          />
          {modesData ? (
            <ModeComparisonGrid
              comparison={modesData}
              current={planner.mode}
              onChoose={(m) => {
                planner.setMode(m);
                planner.run({ mode: m });
                scrollTo("trip-map");
              }}
              onReviewUber={() => openUberReview()}
            />
          ) : planner.modes.status === "error" ? (
            <ErrorState title="Modes could not be compared right now">{planner.modes.error.error}</ErrorState>
          ) : (
            <ModeGridSkeleton count={6} />
          )}
        </section>

        {/* SCHOOLS & COLLEGES */}
        <section className="mt-12" aria-labelledby="institutions-title">
          <SectionHeading
            id="institutions-title"
            title="Schools & colleges"
            subtitle={planner.to ? `Institutions nearest ${planner.to.label}. Thumbnails show the real roads analyzed within 800 m, colored by Priority for Review.` : "Georgia public schools and colleges CrossMetric analyzes."}
            action={
              <ButtonLink href="/schools" variant="tertiary" size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />}>
                View all schools
              </ButtonLink>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {near.length
              ? near.map((i) => <InstitutionCard key={i.id} inst={i} />)
              : Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="card overflow-hidden">
                    <Skeleton className="h-[132px] rounded-none" />
                    <div className="space-y-2 p-3.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-4 w-44" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  </div>
                ))}
          </div>
        </section>

        {/* CROSSSCORE BREAKDOWN + COMMUNITY REPORTS */}
        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1.25fr_1fr]">
          <section id="breakdown" className="scroll-mt-24" aria-labelledby="breakdown-title">
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={<Gauge className="h-4 w-4" />}
                title={<span id="breakdown-title">CrossScore breakdown</span>}
                subtitle={selectedRoute ? `How the score is calculated for the ${rolesLabel(selectedRoute.roles).toLowerCase()}` : "How the score is calculated for a route"}
                action={
                  <Link href="/methodology#crossscore" className="link inline-flex items-center gap-1 text-small">
                    Methodology <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                }
              />
              {selectedRoute ? (
                <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[1.2fr_1fr]">
                  <FactorBreakdown result={selectedRoute.crossScore} />
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-ctl bg-subtle p-3">
                      <ScoreRing score={selectedRoute.crossScore.score} size={52} />
                      <div>
                        <Badge tone={bandTone(selectedRoute.crossScore.band.id)}>{selectedRoute.crossScore.band.label}</Badge>
                        <p className="mt-1 text-meta text-ink-muted">CrossScore model v{selectedRoute.crossScore.modelVersion}</p>
                      </div>
                    </div>
                    {planner.from ? <LowLightNote when={planner.when} from={planner.from} route={selectedRoute} /> : null}
                    <RouteConcerns route={selectedRoute} />
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-3.5 w-1/3" />
                      <Skeleton className="h-1.5 w-full" />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
          <section aria-labelledby="community-title">
            <Card className="h-full p-5 sm:p-6">
              <CardHeader
                icon={<FileText className="h-4 w-4" />}
                title={<span id="community-title">Community reports</span>}
                subtitle="Issues people have flagged across Georgia. Community information, not official data."
                action={
                  <ButtonLink href="/reports?new=1" size="sm" variant="secondary">
                    Report an issue
                  </ButtonLink>
                }
              />
              <div className="mt-3">
                <RecentReports limit={6} />
              </div>
            </Card>
          </section>
        </div>

        {/* DATA TRUST */}
        <section className="mt-12 rounded-surface border border-line bg-white p-5 sm:p-6" aria-labelledby="data-title">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-chip bg-subtle text-ink-soft" aria-hidden>
                <Database className="h-4 w-4" />
              </span>
              <div>
                <h2 id="data-title" className="text-body font-semibold text-navy-900">
                  What CrossMetric is built on
                </h2>
                <p className="mt-0.5 max-w-[640px] text-small leading-relaxed text-ink-muted">
                  Historical public data, processed {facts.processed}. Routes are calculated live on the OpenStreetMap network; scores use the data below. Nothing here is a real-time feed or a prediction.
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              {[
                [facts.crashes.toLocaleString("en-US"), `GDOT crash reports · ${facts.windowLabel}`],
                [facts.schools.toLocaleString("en-US"), "Georgia public schools (NCES)"],
                [facts.colleges.toLocaleString("en-US"), "Degree-granting colleges (IPEDS)"],
                [facts.roadKm ? `${Math.round(facts.roadKm).toLocaleString("en-US")} km` : "GDOT", "Public roads in the reference set"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd>
                    <span className="tabular block text-component font-semibold tracking-tight text-navy-900">{v}</span>
                    <span className="block text-meta leading-snug text-ink-muted">{l}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
      {uberReviewPanel}
    </div>
  );
}
