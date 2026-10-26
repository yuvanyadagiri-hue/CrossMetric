import type { Metadata } from "next";
import { CarReturnScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Back to your car",
  description: "The way back to where you parked.",
};

export default function Page() {
  return <CarReturnScreen />;
}
