import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ResearchWorkspace, SignIn } from "@/components/research/ResearchWorkspace";
import { readRegistry } from "@/server/research/run";
import { getResearchStore, INTERNAL_COOKIE, internalEnabled, sessionValue } from "@/server/research/store";

export const metadata: Metadata = { title: "Research workspace", robots: { index: false, follow: false } };

async function Workspace() {
  const jar = await cookies();
  if (jar.get(INTERNAL_COOKIE)?.value !== sessionValue()) return <SignIn />;
  const store = getResearchStore();
  const [registry, run, reviews, feedback] = await Promise.all([readRegistry(), store.latestRun(), store.reviews(), store.listFeedback("1970-01-01")]);
  const evidence = Object.fromEntries(feedback.map((f) => [f.id, { text: f.text, postedAt: f.postedAt, campus: f.campus }]));
  return <ResearchWorkspace registry={registry} run={run} reviews={reviews} evidence={evidence} />;
}

/** Internal: evidence-to-backlog review. Disabled (404) unless CROSSMETRIC_INTERNAL_TOKEN is set. */
export default async function ResearchPage() {
  await connection();
  if (!internalEnabled()) notFound();
  return (
    <main id="main" className="mx-auto max-w-[960px] px-4 py-8">
      <h1 className="text-section font-semibold">Research workspace</h1>
      <p className="mt-1 text-small text-ink-soft">Internal. Drafts are proposals for people to review; they never change the app, its rules or anything students see.</p>
      <Suspense fallback={<p className="mt-6 text-small text-ink-soft">Loading…</p>}>
        <Workspace />
      </Suspense>
    </main>
  );
}
