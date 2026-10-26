import { NextResponse } from "next/server";
import { readJsonBody } from "@/server/api";
import { INTERNAL_COOKIE, internalEnabled, sessionValue, tokenMatches } from "@/server/research/store";

/** POST /api/research/session {token} — sign in to the internal research workspace. DELETE signs out. */
export async function POST(request: Request) {
  if (!internalEnabled()) return new NextResponse(null, { status: 404 });
  const body = await readJsonBody(request);
  if (typeof body?.token !== "string" || !tokenMatches(body.token)) return NextResponse.json({ error: "Wrong token." }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(INTERNAL_COOKIE, sessionValue(), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 3600 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(INTERNAL_COOKIE);
  return res;
}
