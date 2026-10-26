import type { Metadata } from "next";
import { SearchScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Where to?",
  description: "Search any place in Georgia.",
};

export default function Page() {
  return <SearchScreen />;
}
