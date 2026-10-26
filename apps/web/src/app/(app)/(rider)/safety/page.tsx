import type { Metadata } from "next";
import { SafetyScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Safety",
  description: "Safety toolkit and CrossScore for your trip.",
};

export default function Page() {
  return <SafetyScreen />;
}
