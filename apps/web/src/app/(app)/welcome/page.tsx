import type { Metadata } from "next";
import { Welcome } from "@/components/welcome/Welcome";

export const metadata: Metadata = {
  title: "Welcome",
  description: "CrossMetric compares every way to get anywhere in Georgia: the fastest, the cheapest and the calmer streets.",
};

export default function Page() {
  return <Welcome />;
}
