import type { Metadata } from "next";
import { ParkingScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Campus parking",
  description: "Where you may park on campus, by the rules.",
};

export default function Page() {
  return <ParkingScreen />;
}
