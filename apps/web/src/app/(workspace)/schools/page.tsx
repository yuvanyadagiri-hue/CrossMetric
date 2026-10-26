import type { Metadata } from "next";
import { SchoolsDirectory } from "@/components/institutions/SchoolsDirectory";
import { getRepository } from "@/server/repository";

export const metadata: Metadata = { title: "Schools & Colleges" };

export default async function SchoolsPage() {
  const repo = getRepository();
  const [schools, colleges] = await Promise.all([repo.getSchoolIndex(), repo.getCollegeIndex()]);
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-8 sm:px-6">
      <p className="eyebrow">Schools &amp; Colleges</p>
      <h1 className="mt-2 text-page font-semibold text-navy-900 sm:text-display">How students get to school, everywhere in Georgia</h1>
      <p className="mt-2 max-w-[760px] text-body leading-relaxed text-ink-muted">
        {schools.schools.length.toLocaleString("en-US")} public K–12 schools (NCES 2024–25) and {(colleges?.schools.length ?? 0).toLocaleString("en-US")} degree-granting colleges and universities
        (IPEDS 2024–25). Each profile shows the roads, crash patterns and infrastructure around the campus, and plans trips to it. This compares transportation conditions, not academic quality.
      </p>
      <div className="mt-6">
        <SchoolsDirectory />
      </div>
    </div>
  );
}
