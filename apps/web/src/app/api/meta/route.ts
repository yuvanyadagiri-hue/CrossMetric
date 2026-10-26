import { NextResponse } from "next/server";
import { MODEL } from "@crossmetric/engine";
import { getRepository } from "@/server/repository";

/** GET /api/meta — data sources, analysis window, quality report and the active scoring model. */
export async function GET() {
  const repo = getRepository();
  const [meta, validation] = await Promise.all([repo.getMeta(), repo.getValidation()]);
  return NextResponse.json({ meta, model: MODEL, validation, storage: repo.kind });
}
