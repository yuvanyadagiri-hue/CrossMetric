import type { Metadata } from "next";
import { LocationPrimer } from "@/components/welcome/LocationPrimer";

export const metadata: Metadata = {
  title: "Your location",
  description: "Start routes from where you are. Optional, and never stored.",
};

export default function Page() {
  return <LocationPrimer />;
}
