import type { Metadata } from "next";
import { ReportScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Report a barrier",
  description: "Report a blocked sidewalk, a missing curb ramp or a crossing problem, anonymously.",
};

export default function Page() {
  return <ReportScreen />;
}
