import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import type { Observation, ObservationKind } from "@crossmetric/engine/commute";

/**
 * One-tap parking reports.
 *  - With DATABASE_URL: the `parking_observations` table.
 *  - Otherwise: a JSON file in data/community (or COMMUNITY_DATA_DIR).
 * Stored: place, kind, time, verification level and a salted hash of the
 * anonymous device key. No coordinates, names, accounts or IP addresses.
 * Reports older than two hours are deleted; nothing is kept as history.
 */

export interface ObservationStore {
  recent(sinceMs: number): Promise<Observation[]>;
  add(o: Omit<Observation, "id">): Promise<Observation>;
  remove(id: string, reporter: string): Promise<boolean>;
}

const KEEP_MS = 2 * 3600_000;

class FileObservationStore implements ObservationStore {
  private file = path.join(process.env.COMMUNITY_DATA_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "community"), "parking-observations.json");
  private queue: Promise<unknown> = Promise.resolve();

  private async read(): Promise<Observation[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf-8")) as Observation[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async write(all: Observation[]) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(all), "utf-8");
    await rename(tmp, this.file);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async recent(sinceMs: number) {
    return (await this.read()).filter((o) => o.at >= sinceMs);
  }

  add(o: Omit<Observation, "id">) {
    return this.exclusive(async () => {
      const now = Date.now();
      const all = (await this.read()).filter((x) => now - x.at < KEEP_MS);
      const saved: Observation = { id: randomUUID(), ...o };
      all.push(saved);
      await this.write(all);
      return saved;
    });
  }

  remove(id: string, reporter: string) {
    return this.exclusive(async () => {
      const all = await this.read();
      const next = all.filter((x) => !(x.id === id && x.reporter === reporter));
      if (next.length === all.length) return false;
      await this.write(next);
      return true;
    });
  }
}

interface Row {
  id: string;
  place_id: string;
  kind: ObservationKind;
  reporter_hash: string;
  observed_at: Date;
  verification: "located" | "manual" | "held";
}

class PostgresObservationStore implements ObservationStore {
  constructor(private sql: postgres.Sql) {}

  async recent(sinceMs: number) {
    const rows = await this.sql<Row[]>`
      select id, place_id, kind, reporter_hash, observed_at, verification
      from parking_observations where observed_at >= ${new Date(sinceMs)} order by observed_at desc limit 2000`;
    return rows.map((r) => ({ id: r.id, placeId: r.place_id, kind: r.kind, reporter: r.reporter_hash, at: r.observed_at.getTime(), verification: r.verification }));
  }

  async add(o: Omit<Observation, "id">) {
    await this.sql`delete from parking_observations where observed_at < ${new Date(Date.now() - KEEP_MS)}`;
    const [row] = await this.sql<Row[]>`
      insert into parking_observations (place_id, kind, reporter_hash, observed_at, verification)
      values (${o.placeId}, ${o.kind}, ${o.reporter}, ${new Date(o.at)}, ${o.verification ?? "manual"})
      returning id, place_id, kind, reporter_hash, observed_at, verification`;
    return { id: row!.id, placeId: row!.place_id, kind: row!.kind, reporter: row!.reporter_hash, at: row!.observed_at.getTime(), verification: row!.verification };
  }

  async remove(id: string, reporter: string) {
    const rows = await this.sql`delete from parking_observations where id = ${id} and reporter_hash = ${reporter} returning id`;
    return rows.length > 0;
  }
}

let store: ObservationStore | null = null;

export function getObservationStore(): ObservationStore {
  if (!store) {
    const url = process.env.DATABASE_URL;
    store = url ? new PostgresObservationStore(postgres(url, { max: 3, idle_timeout: 20, prepare: false })) : new FileObservationStore();
  }
  return store;
}

const SALT = process.env.OBSERVATION_SALT ? Buffer.from(process.env.OBSERVATION_SALT) : randomBytes(16);

/** Salted hash of the anonymous device key; the raw key is never stored. */
export function reporterHash(deviceKey: string): string {
  return createHash("sha256").update(SALT).update(deviceKey).digest("hex").slice(0, 32);
}

export const DEVICE_KEY = /^[A-Za-z0-9_-]{16,64}$/;
export const OBSERVATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
