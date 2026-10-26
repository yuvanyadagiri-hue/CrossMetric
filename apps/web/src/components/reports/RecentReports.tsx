"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, MessageSquareWarning } from "lucide-react";
import { Skeleton, EmptyState } from "@/components/ui/States";
import { categoryLabel, reportStatus, timeAgo, verificationLevel, type CommunityReport } from "@/lib/reports";
import type { LonLat } from "@/lib/trip-types";

function distanceM(a: LonLat, b: LonLat): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_195;
}

/** Nearest community reports to a route (or the newest statewide when no route is given). */
export function RecentReports({ near, limit = 4, compact = false, reportHref = "/reports?new=1" }: { near?: LonLat[]; limit?: number; compact?: boolean; reportHref?: string }) {
  const [reports, setReports] = useState<CommunityReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/reports", { signal: c.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { reports: CommunityReport[] }) => setReports(b.reports))
      .catch((e: Error) => e.name !== "AbortError" && setFailed(true));
    return () => c.abort();
  }, []);

  if (failed) return <p className="text-small text-ink-muted">Community reports could not be loaded.</p>;
  if (!reports) {
    return (
      <ul className="space-y-2.5" aria-busy="true" aria-label="Loading community reports">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </li>
        ))}
      </ul>
    );
  }
  const withDistance = reports.map((r) => {
    const d = near?.length ? Math.min(...near.filter((_, i) => i % 5 === 0).map((p) => distanceM(p, [r.lon, r.lat]))) : null;
    return { r, d };
  });
  const list = (near?.length ? withDistance.filter((x) => (x.d ?? 0) <= 1609).sort((a, b) => (a.d ?? 0) - (b.d ?? 0)) : withDistance).slice(0, limit);
  if (!list.length) {
    return (
      <EmptyState
        compact
        icon={<MessageSquareWarning className="h-5 w-5" />}
        title={near?.length ? "No reports nearby" : "No community reports yet"}
        action={
          <Link href={reportHref} className="link inline-flex items-center gap-1 text-small">
            Report an issue <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        {near?.length ? "No transportation issues have been reported near this route." : "Be the first to flag a missing sidewalk, a difficult crossing or a blocked path."}
      </EmptyState>
    );
  }
  return (
    <ul className={compact ? "space-y-2" : "divide-y divide-line"}>
      {list.map(({ r, d }) => {
        const fixed = reportStatus(r) === "reported-fixed";
        return (
          <li key={r.id} className={`flex items-center gap-3 ${compact ? "" : "py-2.5"}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${fixed ? "bg-positive-bg text-positive-fg" : "bg-caution-bg text-caution-fg"}`} aria-hidden>
              <MessageSquareWarning className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-small font-medium text-navy-900">{categoryLabel(r.category)}</span>
              <span className="block truncate text-meta text-ink-muted">
                {fixed ? "Reported fixed" : verificationLevel(r) === "community-confirmed" ? `Confirmed by ${r.confirmations} people` : "Unverified"}
                {r.locationLabel ? ` · ${r.locationLabel}` : ""}
              </span>
            </span>
            <span className="tabular shrink-0 text-right text-meta text-ink-muted">
              {d !== null ? <span className="block">{(d / 1609.344).toFixed(1)} mi away</span> : null}
              {timeAgo(r.createdAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
