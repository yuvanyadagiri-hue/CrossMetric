import { NextResponse } from "next/server";
import { getRepository } from "@/server/repository";

/** GET /api/schools — compact index of every analyzed Georgia public school (for maps). */
export async function GET() {
  const index = await getRepository().getSchoolIndex();
  return NextResponse.json(index, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
