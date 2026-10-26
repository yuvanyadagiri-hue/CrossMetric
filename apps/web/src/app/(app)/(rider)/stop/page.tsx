import type { Metadata } from "next";
import { StopScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Stop times",
  description: "Scheduled departures at a stop.",
};

export default function Page() {
  return <StopScreen />;
}
