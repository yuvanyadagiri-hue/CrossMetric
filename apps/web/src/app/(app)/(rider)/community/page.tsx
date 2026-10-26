import type { Metadata } from "next";
import { CommunityScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Community",
  description: "Sidewalk and crossing barriers reported by the community, and how they are confirmed.",
};

export default function Page() {
  return <CommunityScreen />;
}
