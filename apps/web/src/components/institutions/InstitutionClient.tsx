"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, Bookmark, BookmarkCheck, MapPinned, Navigation } from "lucide-react";
import { runAnalysis } from "@crossmetric/engine";
import type { SchoolPackage } from "@crossmetric/engine";
import { AnalysisMap } from "@/components/map/AnalysisMap";
import { PlaceCombobox } from "@/components/search/PlaceCombobox";
import { ModeComparisonGrid, ModeGridSkeleton } from "@/components/trip/TripPanels";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ScoreRing } from "@/components/ui/CrossScoreGauge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { DEFAULT_ANALYSIS } from "@/lib/institution-summary";
import { tripHref } from "@/lib/place-url";
import { useSaved } from "@/lib/saved";
import type { ApiError, CurbResult, ModeComparison, Place } from "@/lib/trip-types";
import { formatDistance } from "@/lib/trip-types";

/** Interactive map of the analyzed roads around an institution; selecting a location opens its evidence in Analyze. */
export function InstitutionAreaMap({ pkg }: { pkg: SchoolPackage }) {
  const router = useRouter();
  const result = useMemo(() => runAnalysis(pkg, DEFAULT_ANALYSIS), [pkg]);
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <AnalysisMap
      pkg={pkg}
      result={result}
      selectedId={null}
      comparedIds={[]}
      hoveredId={hovered}
      showCrashes={false}
      onSelect={(id) => router.push(`/analyze/${pkg.school.id}?candidate=${id}`)}
      onHover={setHovered}
    />
  );
}

export function SaveInstitutionButton({ id, name, type, city }: { id: string; name: string; type: "k12" | "college"; city: string | null }) {
  const { isSaved, toggle } = useSaved();
  const saved = isSaved("institution", id);
  return (
    <Button
      variant="secondary"
      icon={saved ? <BookmarkCheck className="h-4 w-4 text-brand-600" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
      aria-pressed={saved}
      onClick={() => toggle({ kind: "institution", id, name, type, city })}
    >
      {saved ? "Saved" : "Save"}
    </Button>
  );
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || !json) throw { error: json?.error ?? "Something went wrong.", kind: json?.kind ?? "unavailable" } satisfies ApiError;
  return json;
}

/** Getting there: compare every mode from a chosen starting point, then open the full trip planner. */
export function GettingThere({ destination }: { destination: Place }) {
  const [from, setFrom] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "done"; data: ModeComparison } | { status: "error"; error: ApiError }>({ status: "idle" });

  const compare = async (f: Place) => {
    setFrom(f);
    setState({ status: "loading" });
    try {
      setState({ status: "done", data: await post<ModeComparison>("/api/modes", { from: f, to: destination }) });
    } catch (e) {
      setState({ status: "error", error: e as ApiError });
    }
  };

  const locate = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        void compare({ label: "My location", lon: p.coords.longitude, lat: p.coords.latitude, kind: "current" });
      },
      () => {
        setLocating(false);
        setState({ status: "error", error: { error: "CrossMetric could not access your location. Enter a starting point instead.", kind: "invalid" } });
      },
      { timeout: 10_000 },
    );
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <PlaceCombobox label="Coming from" visibleLabel value={from} onSelect={compare} onUseLocation={locate} locating={locating} placeholder="Home, a stop, or another place" />
        </div>
        {from ? (
          <ButtonLink href={tripHref("/routes", from, destination, "walk")} variant="secondary" trailingIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
            Open full trip
          </ButtonLink>
        ) : null}
      </div>
      <div className="mt-4">
        {state.status === "idle" ? (
          <EmptyState compact icon={<Navigation className="h-5 w-5" />} title="Where are you coming from?">
            Walk, bike, transit, drive and rideshare are compared for your trip, each with a CrossScore where CrossMetric can calculate one.
          </EmptyState>
        ) : state.status === "loading" ? (
          <ModeGridSkeleton count={6} />
        ) : state.status === "error" ? (
          <ErrorState title="Trip could not be compared">{state.error.error}</ErrorState>
        ) : (
          <ModeComparisonGrid comparison={state.data} />
        )}
      </div>
    </div>
  );
}

/** Safer drop-off: compare curb points around the campus location. */
export function SaferDropoff({ place }: { place: Place }) {
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "done"; data: CurbResult } | { status: "error"; error: ApiError }>({ status: "idle" });
  const run = async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "done", data: await post<CurbResult>("/api/curb", { place, purpose: "dropoff" }) });
    } catch (e) {
      setState({ status: "error", error: e as ApiError });
    }
  };
  return (
    <div>
      <p className="text-small leading-relaxed text-ink-muted">
        Drop-offs usually go to the institution&rsquo;s mapped point. CrossMetric compares curb points within a short walk on lanes, traffic, posted speed and crashes within 50 m. Entrances and official
        car-line zones are not in public data, so follow the school&rsquo;s own drop-off rules.
      </p>
      {state.status === "idle" ? (
        <Button className="mt-3" variant="secondary" size="sm" icon={<MapPinned className="h-4 w-4" aria-hidden />} onClick={run}>
          Compare drop-off points
        </Button>
      ) : state.status === "loading" ? (
        <div className="mt-3 space-y-2" aria-busy="true" aria-label="Comparing drop-off points">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : state.status === "error" ? (
        <div className="mt-3">
          <ErrorState title="Drop-off points could not be compared">{state.error.error}</ErrorState>
        </div>
      ) : state.data.options.length === 0 ? (
        <EmptyState compact title="No drivable curb within a short walk" />
      ) : (
        <ul className="mt-3 space-y-2">
          {state.data.options.map((o) => (
            <li key={o.id} className={`flex items-center gap-3 rounded-ctl border p-3 ${o.id === state.data.recommendedId ? "border-positive bg-positive-bg/40" : "border-line"}`}>
              <ScoreRing score={o.score.score} size={44} />
              <div className="min-w-0 flex-1">
                <p className="text-small font-semibold text-navy-900">
                  {o.current ? "Closest curb" : o.id === state.data.recommendedId ? "Recommended" : "Alternative"} <span className="font-normal text-ink-muted">· {o.street}</span>
                </p>
                <p className="text-meta text-ink-muted">
                  {o.walkM < 15 ? "At the mapped point" : `${formatDistance(o.walkM)} walk`}
                  {o.reasons.length ? ` · ${o.reasons.join(" · ")}` : ""}
                </p>
              </div>
              <a
                className="link text-meta"
                href={`https://www.openstreetmap.org/?mlat=${o.lat.toFixed(5)}&mlon=${o.lon.toFixed(5)}#map=19/${o.lat.toFixed(5)}/${o.lon.toFixed(5)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PriorityLink({ id, candidate, children }: { id: string; candidate: string; children: React.ReactNode }) {
  return (
    <Link href={`/analyze/${id}?candidate=${candidate}`} className="block rounded-chip px-2 py-2 transition-colors hover:bg-subtle">
      {children}
    </Link>
  );
}
