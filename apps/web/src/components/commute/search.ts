import type { Building } from "@/lib/commute-types";

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Building search: exact and prefix matches on names and short names first. */
export function searchBuildings(q: string, buildings: Building[], limit = 8): Building[] {
  const n = norm(q);
  if (!n) return [];
  const words = n.split(" ");
  const scored: { b: Building; s: number }[] = [];
  for (const b of buildings) {
    let s = 0;
    for (const name of [b.name, ...b.aliases, b.ref ?? ""]) {
      const t = norm(name);
      if (!t) continue;
      const tw = t.split(" ");
      if (t === n) s = Math.max(s, 100);
      else if (t.startsWith(n)) s = Math.max(s, 80);
      else if (words.every((w) => tw.some((x) => x.startsWith(w)))) s = Math.max(s, 60 - tw.length);
      else if (t.includes(n)) s = Math.max(s, 30);
    }
    if (s > 0) scored.push({ b, s });
  }
  return scored
    .sort((a, b) => b.s - a.s || a.b.name.length - b.b.name.length)
    .slice(0, limit)
    .map((x) => x.b);
}
