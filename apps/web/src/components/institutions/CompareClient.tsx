"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { PlaceCombobox } from "@/components/search/PlaceCombobox";
import { ModeIcon, MODE_LABEL } from "@/components/trip/modeMeta";
import { ScoreRing } from "@/components/ui/CrossScoreGauge";
import { Skeleton } from "@/components/ui/States";
import type { ApiError, ModeComparison, Place } from "@/lib/trip-types";
import { formatDuration } from "@/lib/trip-types";

/** Add or remove institutions in the comparison (kept in the URL). */
export function CompareSelector({ ids, names, max = 3 }: { ids: string[]; names: Record<string, string>; max?: number }) {
  const router = useRouter();
  const go = (next: string[]) => router.push(next.length ? `/schools/compare?ids=${next.join(",")}` : "/schools/compare");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ids.map((id) => (
        <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-white py-1 pl-3 pr-1.5 text-small font-medium text-navy-900 ring-1 ring-line">
          {names[id] ?? id}
          <button type="button" onClick={() => go(ids.filter((x) => x !== id))} aria-label={`Remove ${names[id] ?? id}`} className="grid h-5 w-5 place-items-center rounded-full text-ink-muted hover:bg-subtle hover:text-navy-900">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </span>
      ))}
      {ids.length < max ? (
        <div className="w-full max-w-[340px]">
          <PlaceCombobox
            label="Add a school or college"
            value={null}
            leadingIcon={<Plus className="h-4 w-4" aria-hidden />}
            placeholder="Add a school or college…"
            onSelect={(p) => {
              if ((p.kind === "school" || p.kind === "college") && p.id && !ids.includes(p.id)) go([...ids, p.id]);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

const MODES = ["walk", "bike", "transit", "drive"] as const;

/** Compare getting to each institution from one starting point. */
export function CompareTrips({ places }: { places: Place[] }) {
  const [from, setFrom] = useState<Place | null>(null);
  const [results, setResults] = useState<Record<string, ModeComparison | ApiError | "loading">>({});

  const run = async (f: Place) => {
    setFrom(f);
    setResults(Object.fromEntries(places.map((p) => [p.id!, "loading" as const])));
    await Promise.all(
      places.map(async (p) => {
        try {
          const res = await fetch("/api/modes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: f, to: p }) });
          const json = (await res.json()) as ModeComparison & Partial<ApiError>;
          setResults((r) => ({ ...r, [p.id!]: res.ok ? json : { error: json.error ?? "Failed", kind: json.kind ?? "unavailable" } }));
        } catch {
          setResults((r) => ({ ...r, [p.id!]: { error: "CrossMetric could not be reached.", kind: "unavailable" } }));
        }
      }),
    );
  };

  return (
    <div>
      <div className="max-w-[420px]">
        <PlaceCombobox label="Compare trips starting from" visibleLabel value={from} onSelect={run} placeholder="Home, a stop, or another place" />
      </div>
      {from ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-small">
            <caption className="sr-only">CrossScore and travel time by mode from {from.label}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-line py-2 pr-3 text-left text-meta font-semibold text-ink-muted">
                  Mode
                </th>
                {places.map((p) => (
                  <th key={p.id} scope="col" className="border-b border-line px-3 py-2 text-left font-semibold text-navy-900">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODES.map((m) => (
                <tr key={m}>
                  <th scope="row" className="border-b border-line py-2.5 pr-3 text-left font-medium text-ink-soft">
                    <span className="inline-flex items-center gap-2">
                      <ModeIcon mode={m} className="h-4 w-4 text-brand-600" />
                      {MODE_LABEL[m]}
                    </span>
                  </th>
                  {places.map((p) => {
                    const r = results[p.id!];
                    if (r === "loading" || r === undefined)
                      return (
                        <td key={p.id} className="border-b border-line px-3 py-2.5">
                          <Skeleton className="h-8 w-28" />
                        </td>
                      );
                    if ("error" in r)
                      return (
                        <td key={p.id} className="border-b border-line px-3 py-2.5 text-meta text-critical-fg">
                          {r.error}
                        </td>
                      );
                    const s = r.modes.find((x) => x.mode === m);
                    return (
                      <td key={p.id} className="border-b border-line px-3 py-2.5">
                        {s?.available && s.score !== undefined ? (
                          <span className="inline-flex items-center gap-2">
                            <ScoreRing score={s.score} size={36} />
                            <span className="tabular text-ink-soft">{formatDuration(s.durationS ?? 0)}</span>
                          </span>
                        ) : (
                          <span className="text-meta text-ink-muted">{s?.mode === "transit" && s.available ? `Stops nearby · ${s.nearbyStops?.[0]?.name ?? ""}` : (s?.summary ?? "—")}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
