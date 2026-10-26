import { NextResponse } from "next/server";
import { thumbData } from "@/lib/institution-summary";
import { getRepository, INSTITUTION_ID } from "@/server/repository";

/** GET /api/schools/{id}/thumb — roads within 800 m of an institution, colored by Priority for Review band. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!INSTITUTION_ID.test(id)) return NextResponse.json({ error: "Unknown institution id." }, { status: 400 });
  const pkg = await getRepository().getSchoolPackage(id);
  if (!pkg) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(thumbData(pkg), { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}
