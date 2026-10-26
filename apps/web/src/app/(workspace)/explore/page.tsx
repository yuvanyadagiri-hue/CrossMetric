import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { dashboardFacts } from "@/server/dashboard";

export const metadata: Metadata = { title: "Explore" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

/** The CrossScore dashboard (previously the home page). */
export default async function ExplorePage({ searchParams }: { searchParams: Search }) {
  const [facts, sp] = await Promise.all([dashboardFacts(), searchParams]);
  return <Dashboard params={{ from: one(sp.from), to: one(sp.to), mode: one(sp.mode) }} facts={facts} />;
}
