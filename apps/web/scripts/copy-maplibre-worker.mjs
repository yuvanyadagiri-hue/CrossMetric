// MapLibre GL 6 runs tile parsing in an ES-module Web Worker that bundlers
// don't emit automatically. Serve the worker (and the shared chunk it imports)
// from /public/maplibre and point maplibre.setWorkerUrl() at it.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(path.dirname(require.resolve("maplibre-gl/package.json")), "dist");
const out = path.join(here, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(out, file));
}
console.log(`maplibre worker copied to ${path.relative(process.cwd(), out)}`);
