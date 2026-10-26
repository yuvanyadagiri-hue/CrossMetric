import type { Metadata } from "next";
import { ReceiptScreen } from "@/components/commute/screens";

export const metadata: Metadata = {
  title: "Trip",
  description: "A past trip, kept on this device.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptScreen id={id} />;
}
