import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import type { BacklogDraft, EvidenceRecord, RunReport } from "@crossmetric/engine/research";

/**
 * Storage for the internal research pipeline.
 *  - With DATABASE_URL: research_feedback / research_runs / research_reviews tables.
 *  - Otherwise: data/community/research.json (or COMMUNITY_DATA_DIR).
 * Feedback is minimized before it is stored and expires after 30 days. The
 * submitter gets a deletion code; only its hash is stored.
 */

export const RETENTION_DAYS = 30;

export interface StoredRun {
  report: RunReport;
  drafts: BacklogDraft[];
}

export type ReviewDecision = "accept" | "merge" | "reject" | "needs_evidence";

export interface Review {
  clusterId: string;
  decision: ReviewDecision;
  note: string;
  at: string;
}

export interface ResearchStore {
  addFeedback(r: Omit<EvidenceRecord, "id" | "sourceRef">): Promise<{ id: string; deletionCode: string }>;
  deleteFeedback(deletionCode: string): Promise<string | null>;
  listFeedback(sinceIso: string): Promise<EvidenceRecord[]>;
  saveRun(run: StoredRun): Promise<void>;
  latestRun(): Promise<StoredRun | null>;
  setReview(r: Review): Promise<void>;
  reviews(): Promise<Review[]>;
}

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

interface FileShape {
  feedback: (EvidenceRecord & { deletionHash: string; expiresAt: string })[];
  runs: StoredRun[];
  reviews: Review[];
}

class FileResearchStore implements ResearchStore {
  private file = path.join(process.env.COMMUNITY_DATA_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "community"), "research.json");
  private queue: Promise<unknown> = Promise.resolve();

  private async read(): Promise<FileShape> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf-8")) as FileShape;
      const now = new Date().toISOString();
      return { ...data, feedback: data.feedback.filter((f) => f.expiresAt > now) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { feedback: [], runs: [], reviews: [] };
      throw err;
    }
  }

  private async write(data: FileShape) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf-8");
    await rename(tmp, this.file);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  addFeedback(r: Omit<EvidenceRecord, "id" | "sourceRef">) {
    return this.exclusive(async () => {
      const data = await this.read();
      const id = randomUUID();
      const deletionCode = randomBytes(9).toString("base64url");
      const expiresAt = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();
      data.feedback.push({ ...r, id, sourceRef: `feedback:${id}`, deletionHash: hashCode(deletionCode), expiresAt });
      await this.write(data);
      return { id, deletionCode };
    });
  }

  deleteFeedback(deletionCode: string) {
    return this.exclusive(async () => {
      const data = await this.read();
      const h = hashCode(deletionCode);
      const hit = data.feedback.find((f) => f.deletionHash.length === h.length && timingSafeEqual(Buffer.from(f.deletionHash), Buffer.from(h)));
      if (!hit) return null;
      data.feedback = data.feedback.filter((f) => f.id !== hit.id);
      // Deletion propagates: drafts lose the evidence; drafts with none left are removed.
      data.runs = data.runs.map((run) => ({ ...run, drafts: run.drafts.map((d) => ({ ...d, evidence_ids: d.evidence_ids.filter((e) => e !== hit.id) })).filter((d) => d.evidence_ids.length > 0) }));
      await this.write(data);
      return hit.id;
    });
  }

  async listFeedback(sinceIso: string) {
    return (await this.read()).feedback
      .filter((f) => f.postedAt >= sinceIso)
      .map((f) => ({ id: f.id, sourceId: f.sourceId, campus: f.campus, text: f.text, postedAt: f.postedAt, fetchedAt: f.fetchedAt, sourceRef: f.sourceRef }));
  }

  saveRun(run: StoredRun) {
    return this.exclusive(async () => {
      const data = await this.read();
      data.runs = [run, ...data.runs].slice(0, 5);
      await this.write(data);
    });
  }

  async latestRun() {
    return (await this.read()).runs[0] ?? null;
  }

  setReview(r: Review) {
    return this.exclusive(async () => {
      const data = await this.read();
      data.reviews = [r, ...data.reviews.filter((x) => x.clusterId !== r.clusterId)];
      await this.write(data);
    });
  }

  async reviews() {
    return (await this.read()).reviews;
  }
}

class PostgresResearchStore implements ResearchStore {
  constructor(private sql: postgres.Sql) {}

  async addFeedback(r: Omit<EvidenceRecord, "id" | "sourceRef">) {
    const deletionCode = randomBytes(9).toString("base64url");
    const [row] = await this.sql<{ id: string }[]>`
      insert into research_feedback (campus, text, posted_at, deletion_hash, expires_at)
      values (${r.campus}, ${r.text}, ${r.postedAt}, ${hashCode(deletionCode)}, now() + make_interval(days => ${RETENTION_DAYS}))
      returning id`;
    return { id: row!.id, deletionCode };
  }

  async deleteFeedback(deletionCode: string) {
    const rows = await this.sql<{ id: string }[]>`delete from research_feedback where deletion_hash = ${hashCode(deletionCode)} returning id`;
    const id = rows[0]?.id ?? null;
    if (id) {
      const runs = await this.sql<{ id: string; drafts: BacklogDraft[] }[]>`select id, drafts from research_runs`;
      for (const run of runs) {
        const drafts = run.drafts.map((d) => ({ ...d, evidence_ids: d.evidence_ids.filter((e) => e !== id) })).filter((d) => d.evidence_ids.length > 0);
        await this.sql`update research_runs set drafts = ${this.sql.json(drafts as never)} where id = ${run.id}`;
      }
    }
    return id;
  }

  async listFeedback(sinceIso: string) {
    await this.sql`delete from research_feedback where expires_at < now()`;
    const rows = await this.sql<{ id: string; campus: EvidenceRecord["campus"]; text: string; posted_at: Date; created_at: Date }[]>`
      select id, campus, text, posted_at, created_at from research_feedback where posted_at >= ${sinceIso}`;
    return rows.map((r) => ({ id: r.id, sourceId: "first-party-feedback", campus: r.campus, text: r.text, postedAt: r.posted_at.toISOString(), fetchedAt: r.created_at.toISOString(), sourceRef: `feedback:${r.id}` }));
  }

  async saveRun(run: StoredRun) {
    await this.sql`insert into research_runs (report, drafts) values (${this.sql.json(run.report as never)}, ${this.sql.json(run.drafts as never)})`;
    await this.sql`delete from research_runs where id not in (select id from research_runs order by created_at desc limit 5)`;
  }

  async latestRun() {
    const [row] = await this.sql<{ report: RunReport; drafts: BacklogDraft[] }[]>`select report, drafts from research_runs order by created_at desc limit 1`;
    return row ? { report: row.report, drafts: row.drafts } : null;
  }

  async setReview(r: Review) {
    await this.sql`
      insert into research_reviews (cluster_id, decision, note, reviewed_at) values (${r.clusterId}, ${r.decision}, ${r.note}, ${r.at})
      on conflict (cluster_id) do update set decision = excluded.decision, note = excluded.note, reviewed_at = excluded.reviewed_at`;
  }

  async reviews() {
    const rows = await this.sql<{ cluster_id: string; decision: ReviewDecision; note: string; reviewed_at: Date }[]>`select cluster_id, decision, note, reviewed_at from research_reviews`;
    return rows.map((r) => ({ clusterId: r.cluster_id, decision: r.decision, note: r.note, at: r.reviewed_at.toISOString() }));
  }
}

let store: ResearchStore | null = null;

export function getResearchStore(): ResearchStore {
  if (!store) {
    const url = process.env.DATABASE_URL;
    store = url ? new PostgresResearchStore(postgres(url, { max: 2, idle_timeout: 20, prepare: false })) : new FileResearchStore();
  }
  return store;
}

// ---------------------------------------------------------------------------
// Internal access: disabled unless CROSSMETRIC_INTERNAL_TOKEN is set.
// ---------------------------------------------------------------------------

export const INTERNAL_COOKIE = "cm_internal";

export function internalEnabled(): boolean {
  return !!process.env.CROSSMETRIC_INTERNAL_TOKEN && process.env.CROSSMETRIC_INTERNAL_TOKEN.length >= 16;
}

/** Cookie value: an HMAC-like digest of the token, so the token itself is never stored in the browser. */
export function sessionValue(): string {
  return createHash("sha256").update(`cm-internal|${process.env.CROSSMETRIC_INTERNAL_TOKEN ?? ""}`).digest("hex");
}

export function tokenMatches(candidate: string): boolean {
  const t = process.env.CROSSMETRIC_INTERNAL_TOKEN ?? "";
  const a = Buffer.from(createHash("sha256").update(candidate).digest("hex"));
  const b = Buffer.from(createHash("sha256").update(t).digest("hex"));
  return internalEnabled() && timingSafeEqual(a, b);
}

export function isInternal(request: Request): boolean {
  if (!internalEnabled()) return false;
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && tokenMatches(auth.slice(7))) return true;
  const cookie = request.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|; )${INTERNAL_COOKIE}=([a-f0-9]{64})`).exec(cookie);
  if (!m) return false;
  const want = Buffer.from(sessionValue());
  return timingSafeEqual(Buffer.from(m[1]!), want);
}

export function pipelineEnabled(): boolean {
  return process.env.RESEARCH_PIPELINE_ENABLED !== "0";
}
