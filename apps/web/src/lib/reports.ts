/** Community reports: shared types and validation (client and server). */

export const REPORT_CATEGORIES = [
  { id: "missing_sidewalk", label: "Missing sidewalk" },
  { id: "damaged_sidewalk", label: "Damaged sidewalk" },
  { id: "difficult_crossing", label: "Pedestrian crossing issue" },
  { id: "blocked_path", label: "Blocked sidewalk" },
  { id: "curb_ramp", label: "Missing or inaccessible curb ramp" },
  { id: "poor_visibility", label: "Poor visibility" },
  { id: "construction", label: "Obstruction or construction" },
  { id: "bike_lane", label: "Bike-lane concern" },
  { id: "bus_stop", label: "Bus-stop concern" },
  { id: "other", label: "Other accessibility concern" },
] as const;

/**
 * The categories the report flow offers, in the order people most often need them (the rest stay
 * valid for older reports and the workspace page).
 */
export const REPORT_FLOW_CATEGORIES: { id: ReportCategory; hint: string }[] = [
  { id: "blocked_path", hint: "Cars, bins, signs or vegetation in the way" },
  { id: "curb_ramp", hint: "No ramp, a steep or broken one, or a lip at the street" },
  { id: "difficult_crossing", hint: "No marked crossing, short signal, faded paint" },
  { id: "damaged_sidewalk", hint: "Cracks, heaving or holes that trip or stop wheels" },
  { id: "missing_sidewalk", hint: "The sidewalk ends or never existed" },
  { id: "construction", hint: "Work zones or objects with no safe way around" },
  { id: "other", hint: "Anything else that makes this place hard to get through" },
];

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

export function categoryLabel(id: ReportCategory): string {
  return REPORT_CATEGORIES.find((c) => c.id === id)?.label ?? "Other issue";
}

export interface CommunityReport {
  id: string;
  category: ReportCategory;
  description: string | null;
  lon: number;
  lat: number;
  locationLabel: string | null;
  createdAt: string;
  /** People who said "I see this too". */
  confirmations: number;
  /** People who said the issue is fixed. */
  resolvedVotes: number;
}

export type ReportStatus = "open" | "reported-fixed";
export type VerificationLevel = "unverified" | "community-confirmed";

/** Two "fixed" votes mark a report as reported fixed; two confirmations mark it community-confirmed. Neither is official verification. */
export function reportStatus(r: CommunityReport): ReportStatus {
  return r.resolvedVotes >= 2 && r.resolvedVotes >= r.confirmations ? "reported-fixed" : "open";
}

export function verificationLevel(r: CommunityReport): VerificationLevel {
  return r.confirmations >= 2 ? "community-confirmed" : "unverified";
}

export const DESCRIPTION_MAX = 280;

export interface NewReportInput {
  category: ReportCategory;
  description: string | null;
  lon: number;
  lat: number;
  locationLabel: string | null;
}

/** Validate untrusted input. Returns the cleaned report or an error message. */
export function validateReport(raw: unknown): { ok: true; value: NewReportInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Report must be a JSON object." };
  const r = raw as Record<string, unknown>;
  const category = REPORT_CATEGORIES.find((c) => c.id === r.category)?.id;
  if (!category) return { ok: false, error: "Choose a report category." };
  const lon = Number(r.lon);
  const lat = Number(r.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -85.65 || lon > -80.8 || lat < 30.33 || lat > 35.03) {
    return { ok: false, error: "The location must be in Georgia." };
  }
  let description: string | null = null;
  if (r.description !== undefined && r.description !== null) {
    if (typeof r.description !== "string") return { ok: false, error: "Description must be text." };
    const cleaned = r.description.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length > DESCRIPTION_MAX) return { ok: false, error: `Keep the description under ${DESCRIPTION_MAX} characters.` };
    if (/https?:\/\/|www\./i.test(cleaned)) return { ok: false, error: "Links are not allowed in reports." };
    if (/[\w.+-]+@[\w-]+\.[\w.]+|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(cleaned)) {
      return { ok: false, error: "Please don't include email addresses or phone numbers." };
    }
    description = cleaned || null;
  }
  let locationLabel: string | null = null;
  if (typeof r.locationLabel === "string") locationLabel = r.locationLabel.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  return { ok: true, value: { category, description, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, locationLabel } };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(Date.parse(iso));
}
