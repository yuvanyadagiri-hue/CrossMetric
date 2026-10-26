import { NextResponse } from "next/server";
import { isInternal, pipelineEnabled } from "@/server/research/store";
import { runResearch } from "@/server/research/run";

/**
 * POST /api/research/run — run one bounded research batch (internal only).
 * Requires the internal session cookie or `Authorization: Bearer <CROSSMETRIC_INTERNAL_TOKEN>`.
 * RESEARCH_PIPELINE_ENABLED=0 is the kill switch.
 */
export async function POST(request: Request) {
  if (!isInternal(request)) return new NextResponse(null, { status: 404 });
  if (!pipelineEnabled()) return NextResponse.json({ error: "The research pipeline is switched off." }, { status: 503 });
  const report = await runResearch();
  return NextResponse.json({ report });
}
