import { NextResponse } from "next/server";
import { readJsonBody } from "@/server/api";
import { getResearchStore, isInternal, type ReviewDecision } from "@/server/research/store";

const DECISIONS: ReviewDecision[] = ["accept", "merge", "reject", "needs_evidence"];

/** POST /api/research/review {clusterId, decision, note?} — a reviewer's decision on a draft (internal only). */
export async function POST(request: Request) {
  if (!isInternal(request)) return new NextResponse(null, { status: 404 });
  const body = await readJsonBody(request);
  const decision = DECISIONS.find((d) => d === body?.decision);
  const clusterId = typeof body?.clusterId === "string" && /^[a-z]+-[a-z_]+-[0-9a-f]{8}$/.test(body.clusterId) ? body.clusterId : null;
  if (!decision || !clusterId) return NextResponse.json({ error: "Invalid review." }, { status: 400 });
  const note = typeof body?.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  await getResearchStore().setReview({ clusterId, decision, note, at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
