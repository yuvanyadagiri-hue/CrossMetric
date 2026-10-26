import { readStatewideLayer } from "@/server/statewide";

const LAYERS = ["crash-grid", "hin", "transit"] as const;

/** GET /api/map/{crash-grid | hin | transit} — statewide map layers built by the pipeline. */
export async function GET(_request: Request, { params }: { params: Promise<{ layer: string }> }) {
  const { layer } = await params;
  const name = LAYERS.find((l) => l === layer);
  if (!name) return Response.json({ error: "Unknown layer." }, { status: 404 });
  try {
    const body = await readStatewideLayer(name);
    return new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "This map layer has not been built. Run: python -m pipeline.publish.statewide" }, { status: 503 });
  }
}
