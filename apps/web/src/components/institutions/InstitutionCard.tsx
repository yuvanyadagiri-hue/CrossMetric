"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bookmark, BookmarkCheck, GraduationCap, School } from "lucide-react";
import type { PriorityBandId } from "@crossmetric/engine";
import { BAND_COLORS } from "@/components/map/mapTheme";
import type { ThumbData } from "@/lib/institution-summary";
import { useSaved } from "@/lib/saved";

const thumbCache = new Map<string, Promise<ThumbData | null>>();

function loadThumb(id: string): Promise<ThumbData | null> {
  let p = thumbCache.get(id);
  if (!p) {
    p = fetch(`/api/schools/${id}/thumb`)
      .then((r) => (r.ok ? (r.json() as Promise<ThumbData>) : null))
      .catch(() => null);
    thumbCache.set(id, p);
  }
  return p;
}

const ORDER: Record<PriorityBandId, number> = { lower: 0, moderate: 1, elevated: 2, high: 3 };

/**
 * Institution thumbnail drawn from real data: every road and intersection
 * analyzed within 800 m, colored by its Priority for Review band. Loads when
 * scrolled into view.
 */
export function InstitutionThumb({ id, label, className = "" }: { id: string; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ThumbData | null | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        loadThumb(id).then((d) => !cancelled && setData(d));
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [id]);

  const W = 240;
  const H = 150;
  let body: React.ReactNode = null;
  if (data) {
    const [lon0, lat0] = data.center;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const metersPerDeg = 111_195;
    const scale = (Math.min(W, H) / 2 - 6) / data.radiusM; // px per meter
    const xy = ([lon, lat]: [number, number]) => [W / 2 + (lon - lon0) * k * metersPerDeg * scale, H / 2 - (lat - lat0) * metersPerDeg * scale] as const;
    const lines = [...data.lines].sort((a, b) => ORDER[a.b] - ORDER[b.b]);
    body = (
      <>
        <circle cx={W / 2} cy={H / 2} r={data.radiusM * scale} fill="#eef5ff" stroke="#b9d6fd" strokeDasharray="3 3" />
        {lines.map((l, i) => (
          <polyline
            key={i}
            points={l.c.map((p) => xy(p).map((v) => v.toFixed(1)).join(",")).join(" ")}
            fill="none"
            stroke={l.b === "lower" ? "#a9b6c6" : BAND_COLORS[l.b]}
            strokeWidth={l.b === "lower" ? 1.4 : 2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {data.points
          .filter((p) => p.b !== "lower")
          .map((p, i) => {
            const [x, y] = xy(p.c);
            return <circle key={i} cx={x} cy={y} r={2.6} fill={BAND_COLORS[p.b]} stroke="#fff" strokeWidth="1" />;
          })}
        <circle cx={W / 2} cy={H / 2} r={5} fill="#15191E" stroke="#fff" strokeWidth="2" />
      </>
    );
  }
  return (
    <div ref={ref} className={`relative overflow-hidden bg-[#f3f6fa] ${className}`}>
      {data === undefined ? <div className="skeleton absolute inset-0 rounded-none" /> : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Roads analyzed within 800 m of ${label}, colored by Priority for Review`}>
        {body}
      </svg>
    </div>
  );
}

export interface InstitutionCardData {
  id: string;
  name: string;
  type: "k12" | "college";
  city: string | null;
  level: string | null;
  candidates800: number;
  crashes1200: number;
  distanceM?: number;
}

export function InstitutionCard({ inst }: { inst: InstitutionCardData }) {
  const { isSaved, toggle } = useSaved();
  const saved = isSaved("institution", inst.id);
  const Icon = inst.type === "college" ? GraduationCap : School;
  return (
    <article className="card card-interactive group flex flex-col overflow-hidden">
      <div className="relative">
        <InstitutionThumb id={inst.id} label={inst.name} className="h-[132px] w-full" />
        <button
          type="button"
          onClick={() => toggle({ kind: "institution", id: inst.id, name: inst.name, type: inst.type, city: inst.city })}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${inst.name} from saved` : `Save ${inst.name}`}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-ink-soft shadow-[var(--shadow-panel)] transition-colors hover:text-brand-600"
        >
          {saved ? <BookmarkCheck className="h-4 w-4 text-brand-600" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <p className="flex items-center gap-1.5 text-meta font-semibold text-ink-muted">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {inst.type === "college" ? "College" : inst.level && inst.level !== "Other" ? `${inst.level} school` : "School"}
          {inst.distanceM !== undefined ? <span className="font-medium normal-case tracking-normal">· {(inst.distanceM / 1609.344).toFixed(1)} mi away</span> : null}
        </p>
        <h3 className="mt-1 line-clamp-2 text-small font-semibold leading-snug text-navy-900">{inst.name}</h3>
        <p className="text-meta text-ink-muted">{inst.city ? `${inst.city}, GA` : "Georgia"}</p>
        <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line pt-2.5">
          <div>
            <dt className="text-meta text-ink-muted">Locations analyzed</dt>
            <dd className="tabular text-small font-semibold text-navy-900">{inst.candidates800.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt className="text-meta text-ink-muted">Crashes within 1,200 m</dt>
            <dd className="tabular text-small font-semibold text-navy-900">{inst.crashes1200.toLocaleString("en-US")}</dd>
          </div>
        </dl>
        <Link href={`/schools/${inst.id}`} className="link mt-3 inline-flex items-center gap-1 text-small">
          View details <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          <span className="sr-only">for {inst.name}</span>
        </Link>
      </div>
    </article>
  );
}
