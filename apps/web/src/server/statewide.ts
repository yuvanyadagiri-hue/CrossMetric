import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContextId, DensityReference } from "@crossmetric/engine";

/**
 * Statewide indexes written by pipeline/publish/statewide.py, loaded once per
 * server process and indexed on a lat/lon grid for fast corridor queries.
 *
 *   crashes.bin  ~1.05M clean GDOT crashes (lon, lat, day, flags)
 *   roads.bin    GDOT major-road pieces (class, lanes, role, AADT, geometry)
 */

export const CRASH_FLAG_LIMITED_ACCESS = 32;
export const ROLE = { surface: 0, accessControlled: 1, ramp: 2, connector: 3 } as const;

export interface StatewideManifest {
  schemaVersion: 1;
  generatedAt: string;
  window: { start: string; end: string };
  crashes: { file: string; count: number };
  roads: { file: string; pieces: number; vertices: number; aadtLengthShare: number; selection: string };
  signals: [number, number][];
  references: DensityReference & {
    bufferM: number;
    unit: string;
    population: string;
    activity: { cell: { dLon: number; dLat: number }; neighborhood: number; thresholds: number[]; definition: string };
  };
  transit: { agency: string; feedDate: string; stops: number };
}

export interface CrashIndex {
  count: number;
  lon: Float64Array;
  lat: Float64Array;
  day: Uint16Array;
  flags: Uint8Array;
  /** CSR grid: crash indices sorted by cell. */
  order: Uint32Array;
  cells: Map<number, [number, number]>;
}

export interface RoadIndex {
  count: number;
  fSystem: Uint8Array;
  lanes: Uint8Array;
  role: Uint8Array;
  aadt: Uint32Array;
  vOffset: Uint32Array;
  vCount: Uint16Array;
  lon: Float64Array;
  lat: Float64Array;
  cells: Map<number, number[]>;
}

export interface Statewide {
  manifest: StatewideManifest;
  crashes: CrashIndex;
  roads: RoadIndex;
  signals: [number, number][];
  /** Surface-street crash counts per map-grid cell (keyed gx * 1e6 + gy), for the setting of a point. */
  activity: Map<number, number>;
}

const SETTINGS: Exclude<ContextId, "freeway">[] = ["quiet", "moderate", "busy", "veryBusy"];

/** Setting of a point: how busy the surrounding ~1.4 km area is, classed with the pipeline's thresholds. */
export function settingAt(sw: Statewide, lon: number, lat: number): Exclude<ContextId, "freeway"> {
  const { cell, thresholds } = sw.manifest.references.activity;
  const gx = Math.floor(lon / cell.dLon);
  const gy = Math.floor(lat / cell.dLat);
  let total = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) total += sw.activity.get((gx + dx) * 1_000_000 + gy + dy) ?? 0;
  let k = 0;
  while (k < thresholds.length && thresholds[k]! <= total) k++;
  return SETTINGS[k] ?? "veryBusy";
}

/** Crash grid cell ~55 m; road grid cell ~220 m. */
export const CRASH_CELL = 0.0005;
export const ROAD_CELL = 0.002;

export function cellKey(lon: number, lat: number, size: number): number {
  const gx = Math.floor((lon + 180) / size);
  const gy = Math.floor((lat + 90) / size);
  return gx * 1_000_000 + gy;
}

function dataDir(): string {
  return path.join(process.env.CROSSMETRIC_DATA_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "published"), "statewide");
}

function view<T>(buf: Buffer, offset: number, length: number, Ctor: { new (b: ArrayBuffer, o: number, l: number): T; BYTES_PER_ELEMENT: number }): T {
  // Copy into an aligned ArrayBuffer: Node Buffers can start at any byte offset.
  const bytes = length * Ctor.BYTES_PER_ELEMENT;
  const ab = new ArrayBuffer(bytes);
  new Uint8Array(ab).set(buf.subarray(offset, offset + bytes));
  return new Ctor(ab, 0, length);
}

function microToDegrees(src: Int32Array): Float64Array {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = (src[i] as number) / 1e6;
  return out;
}

function buildCrashIndex(buf: Buffer, n: number): CrashIndex {
  let o = 0;
  const lon = microToDegrees(view(buf, o, n, Int32Array));
  o += n * 4;
  const lat = microToDegrees(view(buf, o, n, Int32Array));
  o += n * 4;
  const day = view(buf, o, n, Uint16Array);
  o += n * 2;
  const flags = view(buf, o, n, Uint8Array);
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = cellKey(lon[i] as number, lat[i] as number, CRASH_CELL);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => (keys[a] as number) - (keys[b] as number));
  const cells = new Map<number, [number, number]>();
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || keys[order[i] as number] !== keys[order[start] as number]) {
      cells.set(keys[order[start] as number] as number, [start, i]);
      start = i;
    }
  }
  return { count: n, lon, lat, day, flags, order, cells };
}

function buildRoadIndex(buf: Buffer, pieces: number, vertices: number): RoadIndex {
  let o = 0;
  const fSystem = view(buf, o, pieces, Uint8Array);
  o += pieces;
  const lanes = view(buf, o, pieces, Uint8Array);
  o += pieces;
  const role = view(buf, o, pieces, Uint8Array);
  o += pieces;
  const aadt = view(buf, o, pieces, Uint32Array);
  o += pieces * 4;
  const vOffset = view(buf, o, pieces, Uint32Array);
  o += pieces * 4;
  const vCount = view(buf, o, pieces, Uint16Array);
  o += pieces * 2;
  const lon = microToDegrees(view(buf, o, vertices, Int32Array));
  o += vertices * 4;
  const lat = microToDegrees(view(buf, o, vertices, Int32Array));
  const cells = new Map<number, number[]>();
  for (let p = 0; p < pieces; p++) {
    const s = vOffset[p] as number;
    const e = s + (vCount[p] as number);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let v = s; v < e; v++) {
      const x = lon[v] as number;
      const y = lat[v] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (let gx = Math.floor((minX + 180) / ROAD_CELL); gx <= Math.floor((maxX + 180) / ROAD_CELL); gx++) {
      for (let gy = Math.floor((minY + 90) / ROAD_CELL); gy <= Math.floor((maxY + 90) / ROAD_CELL); gy++) {
        const k = gx * 1_000_000 + gy;
        const list = cells.get(k);
        if (list) list.push(p);
        else cells.set(k, [p]);
      }
    }
  }
  return { count: pieces, fSystem, lanes, role, aadt, vOffset, vCount, lon, lat, cells };
}

let loading: Promise<Statewide> | null = null;

/** Load (once) the statewide indexes. Rejects with a clear message if the pipeline step has not run. */
export function getStatewide(): Promise<Statewide> {
  loading ??= (async () => {
    const dir = dataDir();
    let manifest: StatewideManifest;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf-8")) as StatewideManifest;
    } catch {
      throw new Error(`Statewide route data not found in ${dir}. Run: python -m pipeline.publish.statewide`);
    }
    const [crashBuf, roadBuf, gridText] = await Promise.all([
      readFile(path.join(dir, manifest.crashes.file)),
      readFile(path.join(dir, manifest.roads.file)),
      readFile(path.join(dir, "crash-grid.json"), "utf-8"),
    ]);
    const grid = JSON.parse(gridText) as { gx: number[]; gy: number[]; surface: number[] };
    const activity = new Map<number, number>();
    for (let i = 0; i < grid.gx.length; i++) activity.set(grid.gx[i]! * 1_000_000 + grid.gy[i]!, grid.surface[i]!);
    return {
      manifest,
      crashes: buildCrashIndex(crashBuf, manifest.crashes.count),
      roads: buildRoadIndex(roadBuf, manifest.roads.pieces, manifest.roads.vertices),
      signals: manifest.signals,
      activity,
    };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

let manifestOnly: Promise<StatewideManifest | null> | null = null;

/** The statewide manifest alone (cheap): data window, coverage and references, or null if not built. */
export function readStatewideManifest(): Promise<StatewideManifest | null> {
  manifestOnly ??= readFile(path.join(dataDir(), "manifest.json"), "utf-8")
    .then((t) => JSON.parse(t) as StatewideManifest)
    .catch(() => null);
  return manifestOnly;
}

/** Read a statewide map-layer file (crash grid, HIN, transit) as raw JSON text. */
export async function readStatewideLayer(name: "crash-grid" | "hin" | "transit"): Promise<string> {
  return readFile(path.join(dataDir(), `${name}.json`), "utf-8");
}
