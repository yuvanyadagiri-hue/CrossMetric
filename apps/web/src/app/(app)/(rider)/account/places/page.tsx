import type { Metadata } from "next";
import { PlacesScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Saved places",
  description: "Home, work, school and other places, one tap away.",
};

export default function Page() {
  return <PlacesScreen />;
}
