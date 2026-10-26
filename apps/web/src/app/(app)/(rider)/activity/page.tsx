import type { Metadata } from "next";
import { ActivityScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Activity",
  description: "Your trips and what is coming up, kept on this device.",
};

export default function Page() {
  return <ActivityScreen />;
}
