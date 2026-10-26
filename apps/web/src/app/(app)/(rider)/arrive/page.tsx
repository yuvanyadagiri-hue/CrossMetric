import type { Metadata } from "next";
import { ArriveScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Arrive by",
  description: "When to leave, how to go, where you may park, and a backup, for a campus building at a set time.",
};

export default function Page() {
  return <ArriveScreen />;
}
