import type { Metadata } from "next";
import { PlanScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Choose a trip",
  description: "The fastest, the cheapest and the other ways to get there.",
};

export default function Page() {
  return <PlanScreen />;
}
