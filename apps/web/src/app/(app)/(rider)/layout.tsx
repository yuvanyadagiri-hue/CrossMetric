import { redirect } from "next/navigation";
import { connection } from "next/server";
import { RiderShell } from "@/components/commute/RiderShell";
import { commuterHomeEnabled } from "@/lib/flags";

/**
 * The CrossMetric app. Every screen is its own page, and they all live inside this one shell, so the
 * map, the trip being planned and the person's places carry over as they move between pages.
 */
export default async function RiderLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Read the flag per request, so switching it needs no rebuild.
  await connection();
  // Flag off: the previous dashboard (with the workspace chrome) instead of the app.
  if (!commuterHomeEnabled()) redirect("/explore");
  return <RiderShell>{children}</RiderShell>;
}
