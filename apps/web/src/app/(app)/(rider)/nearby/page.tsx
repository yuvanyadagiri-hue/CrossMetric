import type { Metadata } from "next";
import { NearbyScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Transit near you",
  description: "Stations and stops by walking time.",
};

export default function Page() {
  return <NearbyScreen />;
}
