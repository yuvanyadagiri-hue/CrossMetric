import type { Metadata } from "next";
import { SettingsScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Preferences",
  description: "How CrossMetric plans your trips.",
};

export default function Page() {
  return <SettingsScreen />;
}
