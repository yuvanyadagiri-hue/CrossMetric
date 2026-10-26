import type { Metadata } from "next";
import { ClassesScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Classes",
  description: "Leave-by times for your classes at Georgia Tech or UGA.",
};

export default function Page() {
  return <ClassesScreen />;
}
