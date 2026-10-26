import type { Metadata } from "next";
import { ArrivedScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "You've arrived",
  description: "Your trip summary.",
};

export default function Page() {
  return <ArrivedScreen />;
}
