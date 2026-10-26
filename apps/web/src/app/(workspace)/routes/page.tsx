import type { Metadata } from "next";
import { RoutesWorkspace } from "@/components/trip/RoutesWorkspace";

export const metadata: Metadata = { title: "Routes" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

export default async function RoutesPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <RoutesWorkspace params={{ from: one(sp.from), to: one(sp.to), mode: one(sp.mode) }} />;
}
