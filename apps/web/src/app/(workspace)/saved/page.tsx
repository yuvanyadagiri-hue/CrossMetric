import type { Metadata } from "next";
import { SavedList } from "@/components/SavedList";

export const metadata: Metadata = { title: "Saved" };

export default function SavedPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-8 sm:px-6">
      <p className="eyebrow">Saved</p>
      <h1 className="mt-2 text-page font-semibold text-navy-900">Saved places and trips</h1>
      <p className="mt-2 max-w-[640px] text-small text-ink-muted">CrossMetric has no accounts. What you save is kept in this browser only and never sent to a server.</p>
      <div className="mt-6">
        <SavedList />
      </div>
    </div>
  );
}
