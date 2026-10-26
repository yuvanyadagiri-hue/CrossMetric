import { NextResponse } from "next/server";
import { minimizeText, type Campus } from "@crossmetric/engine/research";
import { readJsonBody } from "@/server/api";
import { commuteError } from "@/server/commute/api";
import { clientAddress, rateLimited } from "@/server/reports";
import { getResearchStore, RETENTION_DAYS } from "@/server/research/store";

const CAMPUS: Record<string, Campus> = { gt: "GT", uga: "UGA" };

/**
 * POST /api/research/feedback {campus, text, consent: true}
 * First-party feedback for improving CrossMetric. The text is minimized
 * (contact details, handles, addresses removed) before it is stored, kept
 * 30 days, and can be deleted with the returned code.
 */
export async function POST(request: Request) {
  if (rateLimited(clientAddress(request.headers), "create")) return commuteError("Too many submissions. Try again later.", "rate_limited", 429);
  const body = await readJsonBody(request);
  if (!body || body.consent !== true) return commuteError("Please confirm that CrossMetric may use this feedback.", "invalid", 400);
  const raw = typeof body.text === "string" ? body.text : "";
  if (raw.trim().length < 5 || raw.length > 2000) return commuteError("Feedback must be 5 to 2,000 characters.", "invalid", 400);
  const text = minimizeText(raw);
  const now = new Date().toISOString();
  const { deletionCode } = await getResearchStore().addFeedback({ sourceId: "first-party-feedback", campus: CAMPUS[String(body.campus)] ?? "UNKNOWN", text, postedAt: now, fetchedAt: now });
  return NextResponse.json({ deletionCode, retentionDays: RETENTION_DAYS }, { status: 201 });
}

/** DELETE /api/research/feedback {deletionCode} — remove your feedback and any draft evidence built from it. */
export async function DELETE(request: Request) {
  const body = await readJsonBody(request);
  const code = typeof body?.deletionCode === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(body.deletionCode) ? body.deletionCode : null;
  if (!code) return commuteError("Invalid deletion code.", "invalid", 400);
  const id = await getResearchStore().deleteFeedback(code);
  if (!id) return commuteError("Nothing to delete for that code.", "invalid", 404);
  return NextResponse.json({ ok: true });
}
