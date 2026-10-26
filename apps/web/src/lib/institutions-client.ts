"use client";

/** Client-side cache of the institution index (/api/institutions), shared by maps and lists. */

export interface InstitutionRow {
  id: string;
  type: "k12" | "college";
  name: string;
  city: string | null;
  level: string | null;
  lon: number;
  lat: number;
  candidates800: number;
  crashes1200: number;
  aliases: string[] | null;
}

let pending: Promise<InstitutionRow[]> | null = null;

export function loadInstitutionRows(): Promise<InstitutionRow[]> {
  pending ??= fetch("/api/institutions")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((b: { rows: [string, "k12" | "college", string, string | null, string | null, number, number, number, number, string[] | null][] }) =>
      b.rows.map(([id, type, name, city, level, lon, lat, candidates800, crashes1200, aliases]) => ({ id, type, name, city, level, lon, lat, candidates800, crashes1200, aliases })),
    );
  pending.catch(() => (pending = null));
  return pending;
}

/** Nearest institutions to a point (straight-line), excluding one id. */
export function nearestInstitutions(rows: InstitutionRow[], lon: number, lat: number, n: number, exclude?: string): (InstitutionRow & { distanceM: number })[] {
  const k = Math.cos((lat * Math.PI) / 180);
  return rows
    .filter((r) => r.id !== exclude)
    .map((r) => ({ ...r, distanceM: Math.hypot((r.lon - lon) * k, r.lat - lat) * 111_195 }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, n);
}
