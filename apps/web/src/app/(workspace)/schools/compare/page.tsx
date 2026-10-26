import type { Metadata } from "next";
import Link from "next/link";
import { formatInt } from "@crossmetric/engine";
import { CompareSelector, CompareTrips } from "@/components/institutions/CompareClient";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { summarizeInstitution, type InstitutionSummary } from "@/lib/institution-summary";
import { institutionPlace } from "@/lib/place-url";
import { getRepository, INSTITUTION_ID } from "@/server/repository";
import { getTransit, nearestStops } from "@/server/transit";

export const metadata: Metadata = { title: "Compare schools & colleges" };

type Search = Promise<Record<string, string | string[] | undefined>>;

type Row = { label: string; hint?: string; value: (s: InstitutionSummary & { stops: number }) => number | null; format?: (v: number) => string };

const pct = (v: number) => `${Math.round(v * 100)}%`;

const ROWS: { group: string; rows: Row[] }[] = [
  {
    group: "Area analyzed (800 m)",
    rows: [
      { label: "Intersections & road segments", value: (s) => s.locations },
      { label: "High or elevated Priority for Review", value: (s) => s.bandCounts.high + s.bandCounts.elevated },
      { label: "High Priority for Review", value: (s) => s.bandCounts.high },
    ],
  },
  {
    group: "Crash history (data window)",
    rows: [
      { label: "Crashes matched to these roads", value: (s) => s.crashes.all },
      { label: "Injury or fatal", value: (s) => s.crashes.injury },
      { label: "Pedestrian-involved", value: (s) => s.crashes.pedestrian },
      { label: "Bicyclist-involved", value: (s) => s.crashes.bicyclist },
      { label: "Low light", value: (s) => s.crashes.lowLight },
    ],
  },
  {
    group: "Roads & infrastructure",
    rows: [
      { label: "Road length on arterials", value: (s) => s.infrastructure.arterialShare, format: pct },
      { label: "Road length with 4+ lanes", value: (s) => s.infrastructure.multilaneShare, format: pct },
      { label: "Intersections with a signal record", value: (s) => (s.infrastructure.intersections ? s.infrastructure.signalized / s.infrastructure.intersections : null), format: pct },
      { label: "Busiest traffic count (vehicles/day)", value: (s) => s.infrastructure.busiestAadt },
      { label: "MARTA stops within 800 m", value: (s) => s.stops },
    ],
  },
];

export default async function ComparePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const ids = (typeof sp.ids === "string" ? sp.ids.split(",") : []).filter((id, i, a) => INSTITUTION_ID.test(id) && a.indexOf(id) === i).slice(0, 3);
  const repo = getRepository();
  const pkgs = (await Promise.all(ids.map((id) => repo.getSchoolPackage(id)))).filter((p): p is NonNullable<typeof p> => !!p);
  const transit = await getTransit().catch(() => null);
  const items = pkgs.map((p) => ({ ...summarizeInstitution(p), stops: transit ? nearestStops(transit, [p.school.lon, p.school.lat], 800, 500).length : 0, pkg: p }));
  const names = Object.fromEntries(items.map((i) => [i.id, i.name]));

  return (
    <div className="mx-auto w-full max-w-[1300px] px-4 pb-16 pt-8 sm:px-6">
      <p className="eyebrow">Compare</p>
      <h1 className="mt-2 text-page font-semibold text-navy-900">Compare schools &amp; colleges</h1>
      <p className="mt-2 max-w-[760px] text-small leading-relaxed text-ink-muted">
        A side-by-side look at transportation conditions around each campus — crash history, road design and transit — plus how getting there compares from one starting point. This is a transportation
        comparison, not an academic ranking.
      </p>
      <div className="mt-5">
        <CompareSelector ids={items.map((i) => i.id)} names={names} />
      </div>

      {items.length < 2 ? (
        <Card className="mt-6">
          <EmptyState title={items.length ? "Add one more to compare" : "Choose two or three institutions"}>
            Search above, or select institutions from the{" "}
            <Link href="/schools" className="link">
              Schools &amp; Colleges directory
            </Link>
            .
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-small">
              <caption className="sr-only">Transportation conditions around each institution</caption>
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th scope="col" className="w-[34%] border-b border-line px-4 py-3 text-left text-meta font-semibold text-ink-muted">
                    Indicator
                  </th>
                  {items.map((i) => (
                    <th key={i.id} scope="col" className="border-b border-line px-4 py-3 text-left">
                      <Link href={`/schools/${i.id}`} className="text-small font-semibold text-navy-900 hover:underline">
                        {i.name}
                      </Link>
                      <span className="block text-meta font-normal text-ink-muted">
                        {i.type === "college" ? "College" : (i.pkg.school.level ?? "School")} · {i.pkg.school.city}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {ROWS.map((g) => (
                <tbody key={g.group}>
                  <tr>
                    <th colSpan={items.length + 1} scope="colgroup" className="bg-subtle px-4 py-2 text-left text-meta font-semibold text-navy-900">
                      {g.group}
                    </th>
                  </tr>
                  {g.rows.map((r) => {
                    const vals = items.map((i) => r.value(i));
                    const valid = vals.filter((v): v is number => v !== null);
                    const max = valid.length > 1 ? Math.max(...valid) : null;
                    return (
                      <tr key={r.label} className="hover:bg-subtle/60">
                        <th scope="row" className="border-b border-line px-4 py-2.5 text-left font-medium text-ink-soft">
                          {r.label}
                        </th>
                        {vals.map((v, k) => (
                          <td key={items[k]!.id} className={`tabular border-b border-line px-4 py-2.5 ${v !== null && v === max && valid.filter((x) => x === max).length === 1 ? "font-semibold text-navy-900" : "text-ink"}`}>
                            {v === null ? "—" : r.format ? r.format(v) : formatInt(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              ))}
              <tbody>
                <tr>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-ink-soft">
                    Highest-priority location
                  </th>
                  {items.map((i) => (
                    <td key={i.id} className="px-4 py-2.5">
                      {i.top[0] ? (
                        <Link href={`/analyze/${i.id}?candidate=${i.top[0].id}`} className="link">
                          {i.top[0].name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-2.5 text-meta text-ink-muted">
              Bold marks the largest value in a row. Counts depend on how many roads surround each campus; open each Analyze workspace for the per-location evidence.
            </p>
          </Card>

          <Card className="mt-6 p-5 sm:p-6">
            <CardHeader title="Getting there from one place" subtitle="Each mode's default route to every institution, with its CrossScore" />
            <div className="mt-4">
              <CompareTrips places={items.map((i) => institutionPlace({ id: i.id, name: i.name, lon: i.pkg.school.lon, lat: i.pkg.school.lat, type: i.type, city: i.pkg.school.city }))} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
