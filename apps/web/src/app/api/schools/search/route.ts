import { NextResponse, type NextRequest } from "next/server";
import { searchInstitutions } from "@/server/institutions";

/**
 * GET /api/schools/search?q=northview&limit=8[&type=k12|college]
 * Ranked search of Georgia public schools and colleges by name, city or district.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 8);
  const typeParam = request.nextUrl.searchParams.get("type");
  const type = typeParam === "k12" || typeParam === "college" ? typeParam : undefined;
  if (!q.trim()) return NextResponse.json({ query: q, results: [] });
  const hits = await searchInstitutions(q, Number.isFinite(limit) ? limit : 8, type);
  return NextResponse.json({
    query: q,
    results: hits.map((h) => ({ ...h.school, matched: h.matched })),
  });
}
