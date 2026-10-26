import type { Metadata } from "next";
import { AccountScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Account",
  description: "Your places, preferences and tools. No account needed.",
};

export default function Page() {
  return <AccountScreen />;
}
