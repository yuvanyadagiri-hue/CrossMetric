import type { Metadata } from "next";
import { DetailScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Trip details",
  description: "One option in full: steps, cost and street conditions.",
};

export default function Page() {
  return <DetailScreen />;
}
