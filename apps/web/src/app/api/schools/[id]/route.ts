import { NextResponse } from "next/server";
import { getRepository, INSTITUTION_ID } from "@/server/repository";

/** GET /api/schools/{NCES or IPEDS id} — the institution's analysis package (candidates + matched crash records). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!INSTITUTION_ID.test(id)) {
    return NextResponse.json({ error: "Id must be a 12-digit NCES school id or a 6-digit IPEDS college id." }, { status: 400 });
  }
  const pkg = await getRepository().getSchoolPackage(id);
  if (!pkg) return NextResponse.json({ error: "School not found." }, { status: 404 });
  return NextResponse.json(pkg, { headers: { "Cache-Control": "public, max-age=3600" } });
}
