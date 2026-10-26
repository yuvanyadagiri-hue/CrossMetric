import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import type { CommunityReport, NewReportInput } from "@/lib/reports";

/**
 * Community report storage.
 *  - With DATABASE_URL: the `community_reports` table (supabase/migrations).
 *  - Otherwise: a JSON file in data/community (or COMMUNITY_DATA_DIR).
 * No personal data is stored: no accounts, names, emails or IP addresses.
 */
export interface ReportStore {
  list(): Promise<CommunityReport[]>;
  create(input: NewReportInput): Promise<CommunityReport>;
  vote(id: string, kind: "confirm" | "fixed"): Promise<CommunityReport | null>;
}

const MAX_REPORTS_RETURNED = 500;

class FileReportStore implements ReportStore {
  private file = path.join(process.env.COMMUNITY_DATA_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "community"), "reports.json");
  private queue: Promise<unknown> = Promise.resolve();

  private async read(): Promise<CommunityReport[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf-8")) as CommunityReport[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async write(reports: CommunityReport[]) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(reports), "utf-8");
    await rename(tmp, this.file);
  }

  /** Serialize read-modify-write cycles within this process. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list() {
    const all = await this.read();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_REPORTS_RETURNED);
  }

  create(input: NewReportInput) {
    return this.exclusive(async () => {
      const all = await this.read();
      const report: CommunityReport = { id: randomUUID(), ...input, createdAt: new Date().toISOString(), confirmations: 0, resolvedVotes: 0 };
      all.push(report);
      await this.write(all);
      return report;
    });
  }

  vote(id: string, kind: "confirm" | "fixed") {
    return this.exclusive(async () => {
      const all = await this.read();
      const r = all.find((x) => x.id === id);
      if (!r) return null;
      if (kind === "confirm") r.confirmations++;
      else r.resolvedVotes++;
      await this.write(all);
      return r;
    });
  }
}

interface ReportRow {
  id: string;
  category: CommunityReport["category"];
  description: string | null;
  lon: number;
  lat: number;
  location_label: string | null;
  created_at: Date;
  confirmations: number;
  resolved_votes: number;
}

function fromRow(r: ReportRow): CommunityReport {
  return {
    id: r.id,
    category: r.category,
    description: r.description,
    lon: r.lon,
    lat: r.lat,
    locationLabel: r.location_label,
    createdAt: r.created_at.toISOString(),
    confirmations: r.confirmations,
    resolvedVotes: r.resolved_votes,
  };
}

class PostgresReportStore implements ReportStore {
  constructor(private sql: postgres.Sql) {}

  async list() {
    const rows = await this.sql<ReportRow[]>`
      select id, category, description, st_x(geom::geometry) as lon, st_y(geom::geometry) as lat,
             location_label, created_at, confirmations, resolved_votes
      from community_reports order by created_at desc limit ${MAX_REPORTS_RETURNED}`;
    return rows.map(fromRow);
  }

  async create(input: NewReportInput) {
    const [row] = await this.sql<ReportRow[]>`
      insert into community_reports (category, description, geom, location_label)
      values (${input.category}, ${input.description}, st_setsrid(st_makepoint(${input.lon}, ${input.lat}), 4326)::geography, ${input.locationLabel})
      returning id, category, description, st_x(geom::geometry) as lon, st_y(geom::geometry) as lat,
                location_label, created_at, confirmations, resolved_votes`;
    return fromRow(row!);
  }

  async vote(id: string, kind: "confirm" | "fixed") {
    const rows =
      kind === "confirm"
        ? await this.sql<ReportRow[]>`update community_reports set confirmations = confirmations + 1 where id = ${id}
            returning id, category, description, st_x(geom::geometry) as lon, st_y(geom::geometry) as lat, location_label, created_at, confirmations, resolved_votes`
        : await this.sql<ReportRow[]>`update community_reports set resolved_votes = resolved_votes + 1 where id = ${id}
            returning id, category, description, st_x(geom::geometry) as lon, st_y(geom::geometry) as lat, location_label, created_at, confirmations, resolved_votes`;
    return rows[0] ? fromRow(rows[0]) : null;
  }
}

let store: ReportStore | null = null;

export function getReportStore(): ReportStore {
  if (!store) {
    const url = process.env.DATABASE_URL;
    store = url ? new PostgresReportStore(postgres(url, { max: 3, idle_timeout: 20, prepare: false })) : new FileReportStore();
  }
  return store;
}

// ---------------------------------------------------------------------------
// Rate limiting: in memory, keyed by a salted hash of the client address that
// is never written anywhere and changes on every server restart.
// ---------------------------------------------------------------------------

const SALT = randomBytes(16);
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

export function rateLimited(clientAddress: string, bucket: "create" | "vote"): boolean {
  const limit = bucket === "create" ? 6 : 30;
  const key = `${bucket}:${createHash("sha256").update(SALT).update(clientAddress).digest("hex").slice(0, 24)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return false;
}

export function clientAddress(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

export const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
