import type { Metadata } from "next";
import { NightScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Night travel",
  description: "Official escorts and safe rides on campus.",
};

export default function Page() {
  return <NightScreen />;
}
