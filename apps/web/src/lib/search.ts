import type { SchoolSummary } from "./published";

/**
 * School search ranking.
 *
 * Deterministic and explainable: each school gets a score from how the query
 * matches its name, then city and district. Common abbreviations people type
 * ("elem", "hs", "ms", "acad") are expanded first.
 */

const ABBREVIATIONS: Record<string, string> = {
  elem: "elementary",
  el: "elementary",
  es: "elementary",
  hs: "high",
  ms: "middle",
  mid: "middle",
  acad: "academy",
  sch: "school",
  st: "saint",
  mt: "mount",
  ctr: "center",
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t);
}

export interface SearchHit {
  school: SchoolSummary;
  score: number;
  matched: "name" | "city" | "district";
}

function tokenPrefixCoverage(query: string[], target: string[]): number {
  if (query.length === 0) return 0;
  let hits = 0;
  for (const q of query) {
    if (target.some((t) => t.startsWith(q))) hits += 1;
  }
  return hits / query.length;
}

export function scoreSchool(query: string, school: SchoolSummary): SearchHit | null {
  // An institution can be found by its official name or any alias ("Georgia Tech"); the best match wins.
  let best = scoreName(query, school, school.name);
  for (const alias of school.aliases ?? []) {
    const hit = scoreName(query, school, alias);
    if (hit && (!best || hit.score > best.score)) best = hit;
  }
  return best;
}

function scoreName(query: string, school: SchoolSummary, displayName: string): SearchHit | null {
  const q = normalize(query);
  if (!q) return null;
  const qTokens = tokens(query);
  const name = normalize(displayName);
  const nameTokens = tokens(displayName);
  const cityTokens = tokens(school.city ?? "");
  const districtTokens = tokens(school.district ?? "");

  let score = 0;
  let matched: SearchHit["matched"] = "name";
  if (name === q) score = 1000;
  else if (name.startsWith(q)) score = 800;
  else {
    const nameCov = tokenPrefixCoverage(qTokens, nameTokens);
    if (nameCov === 1) score = 600;
    else {
      // allow mixing name words with a city or district ("northview johns creek")
      const all = [...nameTokens, ...cityTokens, ...districtTokens];
      const anyCov = tokenPrefixCoverage(qTokens, all);
      if (anyCov === 1) {
        score = 400 + Math.round(nameCov * 100);
        if (nameCov === 0) matched = tokenPrefixCoverage(qTokens, cityTokens) === 1 ? "city" : "district";
      }
    }
  }
  if (score === 0) return null;
  // shorter names that match are more specific
  score -= Math.min(50, Math.max(0, nameTokens.length - qTokens.length) * 5);
  return { school, score, matched };
}

export function searchSchools(schools: SchoolSummary[], query: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const s of schools) {
    const hit = scoreSchool(query, s);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score || a.school.name.localeCompare(b.school.name) || a.school.id.localeCompare(b.school.id));
  return hits.slice(0, Math.max(1, Math.min(limit, 25)));
}
