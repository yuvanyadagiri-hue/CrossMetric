import type { Metadata } from "next";
import { ServicesScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Services",
  description: "Every way CrossMetric can help you get around Georgia.",
};

export default function Page() {
  return <ServicesScreen />;
}
