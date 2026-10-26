import type { Metadata } from "next";
import { HelpScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Help",
  description: "How CrossMetric works, in plain words.",
};

export default function Page() {
  return <HelpScreen />;
}
