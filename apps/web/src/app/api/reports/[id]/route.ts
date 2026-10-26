import { NextResponse } from "next/server";
import { apiError, readJsonBody } from "@/server/api";
import { clientAddress, getReportStore, rateLimited, REPORT_ID } from "@/server/reports";

/** POST /api/reports/{id} {vote: "confirm" | "fixed"} — "I see this too" or "This is fixed". */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!REPORT_ID.test(id)) return apiError("Unknown report.", "invalid", 400);
  if (rateLimited(clientAddress(request.headers), "vote")) return apiError("Too many votes from this connection. Please try again later.", "invalid", 429);
  const vote = (await readJsonBody(request))?.vote;
  if (vote !== "confirm" && vote !== "fixed") return apiError("Vote must be confirm or fixed.", "invalid", 400);
  const report = await getReportStore().vote(id, vote);
  if (!report) return apiError("Report not found.", "invalid", 404);
  return NextResponse.json({ report });
}
