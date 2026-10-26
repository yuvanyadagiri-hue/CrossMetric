import "server-only";

import { toSummary, type SchoolSummary } from "@/lib/published";
import { searchSchools, type SearchHit } from "@/lib/search";
import { getRepository } from "./repository";

/** Every institution CrossMetric analyzes: Georgia public K-12 schools and degree-granting colleges. */
export async function getInstitutions(): Promise<SchoolSummary[]> {
  const repo = getRepository();
  const [schools, colleges] = await Promise.all([repo.getSchoolIndex(), repo.getCollegeIndex()]);
  return [...schools.schools.map((r) => toSummary(r, "k12")), ...(colleges?.schools ?? []).map((r) => toSummary(r, "college", colleges?.aliases?.[r[0]]))];
}

export async function searchInstitutions(query: string, limit: number, type?: "k12" | "college"): Promise<SearchHit[]> {
  const all = await getInstitutions();
  return searchSchools(type ? all.filter((s) => s.type === type) : all, query, limit);
}

export async function getInstitution(id: string): Promise<SchoolSummary | null> {
  return (await getInstitutions()).find((s) => s.id === id) ?? null;
}
