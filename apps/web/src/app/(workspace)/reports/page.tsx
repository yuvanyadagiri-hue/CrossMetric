import type { Metadata } from "next";
import { ReportsWorkspace } from "@/components/reports/ReportsWorkspace";
import { isGeorgiaPoint, type LonLat } from "@/lib/trip-types";

export const metadata: Metadata = { title: "Community reports" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const at = typeof sp.at === "string" ? sp.at.split(",").map(Number) : [];
  const point: LonLat | null = at.length === 2 && isGeorgiaPoint(at[0]!, at[1]!) ? [at[0]!, at[1]!] : null;
  return <ReportsWorkspace initialNew={sp.new === "1"} initialAt={point} />;
}
