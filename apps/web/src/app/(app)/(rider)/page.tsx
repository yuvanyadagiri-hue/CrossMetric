import type { Metadata } from "next";
import { HomeScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: { absolute: "CrossMetric — Map. Plan. Move." },
  description: "Explore the map, compare routes by time, cost, safety and accessibility, and report sidewalk barriers around Georgia Tech, UGA and Georgia.",
};

export default function Page() {
  return <HomeScreen />;
}
