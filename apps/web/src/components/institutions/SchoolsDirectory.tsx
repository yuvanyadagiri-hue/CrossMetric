"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, GitCompareArrows, Search, X } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { loadInstitutionRows, type InstitutionRow } from "@/lib/institutions-client";
import { normalize, scoreSchool } from "@/lib/search";
import { InstitutionCard } from "./InstitutionCard";

type TypeFilter = "all" | "k12" | "college";
type Sort = "relevance" | "name" | "crashes" | "locations";
const PAGE = 24;
const MAX_COMPARE = 3;

export function SchoolsDirectory() {
  const router = useRouter();
  const [rows, setRows] = useState<InstitutionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [level, setLevel] = useState("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const [shown, setShown] = useState(PAGE);
  const [compare, setCompare] = useState<string[]>([]);
  const [view, setView] = useState<"cards" | "table">("cards");

  useEffect(() => {
    loadInstitutionRows().then(setRows).catch(() => setFailed(true));
  }, []);

  const levels = useMemo(() => [...new Set((rows ?? []).filter((r) => r.type === "k12" && r.level && r.level !== "Other").map((r) => r.level!))].sort(), [rows]);

  const results = useMemo(() => {
    if (!rows) return [];
    let list = rows.filter((r) => (type === "all" || r.type === type) && (level === "all" || r.type !== "k12" || r.level === level));
    const q = normalize(query);
    if (q) {
      const scored = list
        .map((r) => ({ r, hit: scoreSchool(query, { id: r.id, name: r.name, city: r.city, district: null, level: r.level, lon: r.lon, lat: r.lat, candidates800: r.candidates800, crashes1200: r.crashes1200, aliases: r.aliases ?? undefined }) }))
        .filter((x) => x.hit);
      scored.sort((a, b) => b.hit!.score - a.hit!.score);
      list = scored.map((x) => x.r);
    }
    if (sort === "name" || (sort === "relevance" && !q)) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "crashes") list = [...list].sort((a, b) => b.crashes1200 - a.crashes1200);
    if (sort === "locations") list = [...list].sort((a, b) => b.candidates800 - a.candidates800);
    return list;
  }, [rows, query, type, level, sort]);

  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < MAX_COMPARE ? [...c, id] : c));
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);

  return (
    <div>
      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-chip border border-line-strong px-3 focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/15">
          <Search className="h-4 w-4 text-ink-muted" aria-hidden />
          <span className="sr-only">Search schools and colleges</span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Search by name, city or level…"
            className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-ink-faint"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-ink-muted hover:text-navy-900">
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </label>
        <Segmented
          label="Institution type"
          value={type}
          onChange={(v) => {
            setType(v);
            setShown(PAGE);
          }}
          size="sm"
          options={[
            { id: "all", label: "All" },
            { id: "k12", label: "K–12" },
            { id: "college", label: "Colleges" },
          ]}
        />
        <label className="flex items-center gap-2 text-small text-ink-soft">
          <span className="sr-only">School level</span>
          <select className="select !w-auto !py-2" value={level} onChange={(e) => setLevel(e.target.value)} disabled={type === "college"}>
            <option value="all">All levels</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-small text-ink-soft">
          <ArrowDownUp className="h-4 w-4 text-ink-muted" aria-hidden />
          <span className="sr-only">Sort by</span>
          <select className="select !w-auto !py-2" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="relevance">Best match</option>
            <option value="name">Name A–Z</option>
            <option value="crashes">Most crashes nearby</option>
            <option value="locations">Most locations analyzed</option>
          </select>
        </label>
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          size="sm"
          options={[
            { id: "cards", label: "Cards" },
            { id: "table", label: "Table" },
          ]}
        />
      </div>

      <p className="mt-4 text-small text-ink-muted" aria-live="polite">
        {rows ? `${results.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} institutions` : "Loading institutions…"}
        {" · "}Select up to {MAX_COMPARE} to compare.
      </p>

      {failed ? (
        <div className="mt-4">
          <ErrorState title="Institutions could not be loaded">Refresh the page to try again.</ErrorState>
        </div>
      ) : !rows ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
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
      ) : results.length === 0 ? (
        <EmptyState title="No institutions match">Try a different name or city, or clear the filters.</EmptyState>
      ) : view === "cards" ? (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.slice(0, shown).map((r) => (
            <li key={r.id} className="relative">
              <InstitutionCard inst={r} />
              <label className="absolute left-2 top-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-meta font-medium text-ink-soft shadow-[var(--shadow-panel)]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-brand-600"
                  checked={compare.includes(r.id)}
                  disabled={!compare.includes(r.id) && compare.length >= MAX_COMPARE}
                  onChange={() => toggleCompare(r.id)}
                />
                Compare<span className="sr-only"> {r.name}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card mt-4 overflow-hidden">
          <div className="max-h-[70vh] overflow-auto scrollbar-thin">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-small">
              <caption className="sr-only">Georgia schools and colleges analyzed by CrossMetric</caption>
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-meta font-semibold text-ink-muted">
                  <th scope="col" className="w-10 border-b border-line px-3 py-2.5">
                    <span className="sr-only">Compare</span>
                  </th>
                  <th scope="col" className="border-b border-line px-3 py-2.5">
                    <button type="button" onClick={() => setSort("name")} className="hover:text-navy-900">
                      Institution
                    </button>
                  </th>
                  <th scope="col" className="border-b border-line px-3 py-2.5">Type</th>
                  <th scope="col" className="border-b border-line px-3 py-2.5">City</th>
                  <th scope="col" className="border-b border-line px-3 py-2.5 text-right">
                    <button type="button" onClick={() => setSort("locations")} className="hover:text-navy-900">
                      Locations (800 m)
                    </button>
                  </th>
                  <th scope="col" className="border-b border-line px-3 py-2.5 text-right">
                    <button type="button" onClick={() => setSort("crashes")} className="hover:text-navy-900">
                      Crashes (1,200 m)
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, shown).map((r) => (
                  <tr key={r.id} className="hover:bg-subtle/70">
                    <td className="border-b border-line px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Compare ${r.name}`}
                        className="h-3.5 w-3.5 accent-brand-600"
                        checked={compare.includes(r.id)}
                        disabled={!compare.includes(r.id) && compare.length >= MAX_COMPARE}
                        onChange={() => toggleCompare(r.id)}
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <Link href={`/schools/${r.id}`} className="font-medium text-navy-900 hover:text-brand-700 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="border-b border-line px-3 py-2 text-ink-soft">{r.type === "college" ? "College" : (r.level ?? "School")}</td>
                    <td className="border-b border-line px-3 py-2 text-ink-soft">{r.city ?? "—"}</td>
                    <td className="tabular border-b border-line px-3 py-2 text-right">{r.candidates800.toLocaleString("en-US")}</td>
                    <td className="tabular border-b border-line px-3 py-2 text-right">{r.crashes1200.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows && shown < results.length ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={() => setShown((s) => s + PAGE * 2)}>
            Show more ({(results.length - shown).toLocaleString("en-US")} remaining)
          </Button>
        </div>
      ) : null}

      {compare.length ? (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4" role="region" aria-label="Comparison selection">
          <div className="flex w-full max-w-[720px] items-center gap-3 rounded-ctl bg-navy-900 p-2.5 pl-4 text-white shadow-[var(--shadow-pop)] animate-[var(--animate-rise)]">
            <GitCompareArrows className="h-4 w-4 shrink-0 text-brand-300" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-small">
              {compare.map((id) => byId.get(id)?.name ?? id).join(" · ")}
            </p>
            <button type="button" onClick={() => setCompare([])} className="text-small text-white/70 hover:text-white">
              Clear
            </button>
            <Button size="sm" disabled={compare.length < 2} onClick={() => router.push(`/schools/compare?ids=${compare.join(",")}`)}>
              Compare {compare.length}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
