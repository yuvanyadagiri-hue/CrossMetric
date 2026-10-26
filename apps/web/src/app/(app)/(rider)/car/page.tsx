import type { Metadata } from "next";
import { CarScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Your car",
  description: "Where you parked, and the way back.",
};

export default function Page() {
  return <CarScreen />;
}
