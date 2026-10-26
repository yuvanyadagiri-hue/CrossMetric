let loaded: Promise<typeof import("maplibre-gl")> | null = null;

/** Load MapLibre in the browser and point it at the statically served worker (see scripts/copy-maplibre-worker.mjs). */
export function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  loaded ??= import("maplibre-gl").then((m) => {
    m.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    return m;
  });
  return loaded;
}
