import type { Metadata } from "next";
import { LiveScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "On your way",
  description: "Step-by-step guidance for your trip.",
};

export default function Page() {
  return <LiveScreen />;
}
