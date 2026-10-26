import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Bus, ChevronLeft, ExternalLink, GitCompareArrows, GraduationCap, Navigation, School, SearchCheck, TrainFront } from "lucide-react";
import { formatDate, formatInt, MODEL } from "@crossmetric/engine";
import { GettingThere, InstitutionAreaMap, PriorityLink, SaferDropoff, SaveInstitutionButton } from "@/components/institutions/InstitutionClient";
import { MonthlyBars } from "@/components/methodology/Charts";
import { RecentReports } from "@/components/reports/RecentReports";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PriorityPill } from "@/components/ui/primitives";
import { DataNote } from "@/components/ui/States";
import { summarizeInstitution } from "@/lib/institution-summary";
import { institutionPlace, tripHref } from "@/lib/place-url";
import { getRepository, INSTITUTION_ID } from "@/server/repository";
import { getTransit, nearestStops } from "@/server/transit";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  if (!INSTITUTION_ID.test(id)) return { title: "Not found" };
  const pkg = await getRepository().getSchoolPackage(id);
  return { title: pkg ? pkg.school.name : "Not found" };
}

function grades(lo: string | null, hi: string | null): string | null {
  const f = (g: string | null) => (g === null ? null : g === "PK" ? "Pre-K" : g === "KG" ? "K" : String(Number(g)));
  return f(lo) && f(hi) ? `Grades ${f(lo)}–${f(hi)}` : null;
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export default async function InstitutionPage({ params }: Params) {
  const { id } = await params;
  if (!INSTITUTION_ID.test(id)) notFound();
  const pkg = await getRepository().getSchoolPackage(id);
  if (!pkg) notFound();
  const s = pkg.school;
  const summary = summarizeInstitution(pkg);
  const college = summary.type === "college";
  const transit = await getTransit().catch(() => null);
  const stops = transit ? nearestStops(transit, [s.lon, s.lat], 800, 40) : [];
  const rail = stops.filter(({ i }) => transit!.stops.rail[i]);
  const bus = stops.filter(({ i }) => !transit!.stops.rail[i]);
  const busRoutes = [...new Set(bus.flatMap(({ i }) => transit!.stops.routes[i] ?? []))];
  const place = institutionPlace({ id: s.id, name: s.name, lon: s.lon, lat: s.lat, type: summary.type, city: s.city });
  const highish = summary.bandCounts.high + summary.bandCounts.elevated;
  const typeLabel = college ? (s.schoolType ?? "College") : s.level && s.level !== "Other" ? `Public ${s.level.toLowerCase()} school` : "Public school";
  const g = college ? null : grades(s.gradeLow, s.gradeHigh);
  const crashTypes = [
    { label: "Injury or fatal", value: summary.crashes.injury },
    { label: "Pedestrian-involved", value: summary.crashes.pedestrian },
    { label: "Bicyclist-involved", value: summary.crashes.bicyclist },
    { label: "Low light (dawn, dusk, dark)", value: summary.crashes.lowLight },
    { label: "Fatal", value: summary.crashes.fatal },
  ];
  const maxType = Math.max(1, ...crashTypes.map((c) => c.value));

  return (
    <div className="pb-16">
      {/* OVERVIEW */}
      <section className="border-b border-line bg-white">
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-5 sm:px-6">
          <nav aria-label="Breadcrumb" className="text-small text-ink-muted">
            <Link href="/schools" className="inline-flex items-center gap-1 hover:text-navy-900">
              <ChevronLeft className="h-4 w-4" aria-hidden /> Schools &amp; Colleges
            </Link>
          </nav>
          <div className="mt-3 flex flex-col gap-5 pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-ctl bg-navy-900 text-white" aria-hidden>
                {college ? <GraduationCap className="h-7 w-7" /> : <School className="h-7 w-7" />}
              </span>
              <div>
                <h1 className="text-page font-semibold leading-tight text-navy-900 sm:text-display">{s.name}</h1>
                <p className="mt-1 text-small text-ink-muted">
                  {[typeLabel, g, [s.city, "GA"].filter(Boolean).join(", "), s.county ? `${s.county} County` : null].filter(Boolean).join(" · ")}
                </p>
                <p className="text-small text-ink-muted">
                  {[s.district, college ? `IPEDS unit ${s.id}` : `NCES ${s.id}`, s.schoolYear].filter(Boolean).join(" · ")}
                  {s.website ? (
                    <>
                      {" · "}
                      <a href={s.website.startsWith("http") ? s.website : `https://${s.website}`} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-0.5">
                        Website <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={tripHref("/routes", null, place, "walk")} icon={<Navigation className="h-4 w-4" aria-hidden />}>
                Plan a trip here
              </ButtonLink>
              <ButtonLink href={`/analyze/${s.id}`} variant="secondary" icon={<SearchCheck className="h-4 w-4" aria-hidden />}>
                Analyze safety
              </ButtonLink>
              <ButtonLink href={`/schools/compare?ids=${s.id}`} variant="secondary" icon={<GitCompareArrows className="h-4 w-4" aria-hidden />}>
                Compare
              </ButtonLink>
              <SaveInstitutionButton id={s.id} name={s.name} type={summary.type} city={s.city} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-t-[14px] border border-b-0 border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
            {[
              [formatInt(summary.locations), "Intersections & road segments within 800 m"],
              [formatInt(highish), "High or elevated Priority for Review"],
              [formatInt(summary.crashes.all), "Crashes matched within 800 m"],
              [formatInt(summary.crashes.pedestrian), "Pedestrian-involved crashes"],
              [formatInt(summary.crashes.injury), "Crashes with injuries or deaths"],
            ].map(([v, l]) => (
              <div key={l} className="bg-white px-4 py-3.5">
                <dt className="text-meta leading-snug text-ink-muted">{l}</dt>
                <dd className="tabular mt-0.5 text-section font-semibold text-navy-900">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
        <p className="mt-2 text-meta text-ink-muted">
          GDOT crash reports {formatDate(pkg.window.start)} – {formatDate(pkg.window.end)}, matched to roads with the CrossMetric v{MODEL.version} rules. Priority for Review ranks locations against each other
          around this campus; it is not a safety rating.
        </p>

        {/* MAP + NEARBY SAFETY */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden" aria-label="Area map">
            <div className="relative h-[460px]">
              <InstitutionAreaMap pkg={pkg} />
            </div>
            <p className="border-t border-line px-4 py-2.5 text-meta text-ink-muted">Roads and intersections within 800 m, colored by Priority for Review. Select one to open its evidence.</p>
          </Card>
          <Card className="p-5">
            <CardHeader title="Nearby safety" subtitle="Highest Priority for Review within 800 m" action={<ButtonLink href={`/analyze/${s.id}`} variant="tertiary" size="sm">All {summary.locations}</ButtonLink>} />
            {summary.top.length ? (
              <ol className="mt-3 space-y-1">
                {summary.result.candidates.slice(0, 6).map((c) => (
                  <li key={c.candidate.id}>
                    <PriorityLink id={s.id} candidate={c.candidate.id}>
                      <span className="flex items-center gap-3">
                        <PriorityPill value={c.displayPriority} band={c.band} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-small font-medium text-navy-900">{c.candidate.name}</span>
                          <span className="block text-meta text-ink-muted">
                            {c.candidate.kind === "intersection" ? "Intersection" : "Road segment"} · {formatInt(c.features.crashes)} crashes
                            {c.features.pedestrianCrashes ? ` · ${c.features.pedestrianCrashes} pedestrian` : ""}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-ink-faint" aria-hidden />
                      </span>
                    </PriorityLink>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-small text-ink-muted">No public road intersections or segments were found within 800 m.</p>
            )}
          </Card>
        </div>

        {/* GETTING THERE */}
        <section className="mt-8" aria-labelledby="getting-title">
          <Card className="p-5 sm:p-6">
            <CardHeader icon={<Navigation className="h-4 w-4" />} title={<span id="getting-title">Getting there</span>} subtitle={`Compare walking, biking, transit, driving and rideshare to ${s.name}.`} />
            <div className="mt-4">
              <GettingThere destination={place} />
            </div>
          </Card>
        </section>

        {/* CRASH PATTERNS + INFRASTRUCTURE */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card className="p-5 sm:p-6" aria-label="Crash patterns">
            <CardHeader title="Crash patterns" subtitle={`${formatInt(summary.crashes.all)} crashes matched to roads within 800 m, by month`} />
            <div className="mt-4">
              <MonthlyBars data={summary.monthly} windowEnd={pkg.window.end} />
            </div>
            <ul className="mt-5 space-y-2.5">
              {crashTypes.map((c) => (
                <li key={c.label} className="grid grid-cols-[170px_1fr_44px] items-center gap-3 text-small">
                  <span className="text-ink-soft">{c.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-[#edf0f4]" aria-hidden>
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(c.value / maxType) * 100}%` }} />
                  </span>
                  <span className="tabular text-right font-semibold text-navy-900">{formatInt(c.value)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5 sm:p-6" aria-label="Infrastructure">
            <CardHeader title="Infrastructure" subtitle="Roads within 800 m (GDOT Road Inventory, traffic counts and signals)" />
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              {[
                [formatInt(summary.infrastructure.intersections), "Intersections analyzed"],
                [
                  summary.infrastructure.intersections ? pct(summary.infrastructure.signalized / summary.infrastructure.intersections) : "—",
                  "Intersections with a GDOT traffic signal record",
                ],
                [pct(summary.infrastructure.arterialShare), "Road length on arterials"],
                [pct(summary.infrastructure.multilaneShare), "Road length with 4+ lanes"],
                [summary.infrastructure.busiestAadt ? `${formatInt(summary.infrastructure.busiestAadt)}/day` : "No count", "Busiest traffic count nearby"],
                [pct(summary.infrastructure.trafficMeasuredShare), "Road length with a GDOT traffic count"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="text-meta text-ink-muted">{l}</dt>
                  <dd className="tabular text-component font-semibold text-navy-900">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-small font-semibold text-navy-900">Transit within 800 m</p>
              {stops.length ? (
                <ul className="mt-2 space-y-1.5 text-small text-ink-soft">
                  {rail.length ? (
                    <li className="flex items-center gap-2">
                      <TrainFront className="h-4 w-4 text-brand-600" aria-hidden />
                      {[...new Set(rail.map(({ i }) => transit!.stops.name[i]))].slice(0, 3).join(", ")} (MARTA rail)
                    </li>
                  ) : null}
                  {bus.length ? (
                    <li className="flex items-center gap-2">
                      <Bus className="h-4 w-4 text-brand-600" aria-hidden />
                      {bus.length} bus stops · routes {busRoutes.slice(0, 8).join(", ")}
                      {busRoutes.length > 8 ? "…" : ""}
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-1 text-small text-ink-muted">No MARTA stops within 800 m. Other Georgia transit agencies are not included yet.</p>
              )}
            </div>
            <DataNote className="mt-4">
              Sidewalk and crosswalk inventories are not published statewide. Trip CrossScores use sidewalks recorded in OpenStreetMap along each route; this area summary does not estimate them.
            </DataNote>
          </Card>
        </div>

        {/* SAFER DROP-OFF + REPORTS */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card className="p-5 sm:p-6" aria-label="Safer drop-off">
            <CardHeader title="Safer drop-off" subtitle="Compare nearby curb points for arrivals by car or rideshare" />
            <div className="mt-3">
              <SaferDropoff place={place} />
            </div>
          </Card>
          <Card className="p-5 sm:p-6" aria-label="Community reports nearby">
            <CardHeader
              title="Community reports nearby"
              subtitle="Within a mile; community information, not official data"
              action={
                <ButtonLink href={`/reports?new=1&at=${s.lon.toFixed(5)},${s.lat.toFixed(5)}`} variant="secondary" size="sm">
                  Report an issue
                </ButtonLink>
              }
            />
            <div className="mt-2">
              <RecentReports near={[[s.lon, s.lat]]} limit={5} reportHref={`/reports?new=1&at=${s.lon.toFixed(5)},${s.lat.toFixed(5)}`} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
