import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { getRepository, INSTITUTION_ID } from "@/server/repository";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  if (!INSTITUTION_ID.test(id)) return { title: "School not found" };
  const pkg = await getRepository().getSchoolPackage(id);
  return { title: pkg ? `${pkg.school.name} — Analyze` : "School not found" };
}

/** Priority for Review workspace for one school or college (the v1 analysis, unchanged). */
export default async function AnalyzeSchoolPage({ params }: Params) {
  const { id } = await params;
  if (!INSTITUTION_ID.test(id)) notFound();
  const repo = getRepository();
  const [pkg, meta] = await Promise.all([repo.getSchoolPackage(id), repo.getMeta()]);
  if (!pkg) notFound();
  return (
    <Suspense>
      <Workspace pkg={pkg} labels={meta.labels} processedAt={pkg.generatedAt} />
    </Suspense>
  );
}
