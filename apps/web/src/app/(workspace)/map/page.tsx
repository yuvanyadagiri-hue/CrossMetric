import type { Metadata } from "next";
import { StatewideMap } from "@/components/map/StatewideMap";
import { isGeorgiaPoint, type LonLat } from "@/lib/trip-types";

export const metadata: Metadata = { title: "Map" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function MapPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const f = typeof sp.focus === "string" ? sp.focus.split(",").map(Number) : [];
  const focus: LonLat | null = f.length === 2 && isGeorgiaPoint(f[0]!, f[1]!) ? [f[0]!, f[1]!] : null;
  return (
    <section className="relative h-[calc(100dvh-64px)] min-h-[520px]" aria-label="Statewide map">
      <h1 className="sr-only">Statewide map</h1>
      <StatewideMap focus={focus} />
    </section>
  );
}
