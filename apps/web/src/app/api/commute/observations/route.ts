import { NextResponse, type NextRequest } from "next/server";
import { allowSubmission, availabilityLabel, isSuspiciousBurst, summarizeAvailability, type ObservationKind } from "@crossmetric/engine/commute";
import { isCampusId } from "@/lib/commute-types";
import { readJsonBody } from "@/server/api";
import { commuteError, handleCommuteFailure } from "@/server/commute/api";
import { getCampus } from "@/server/commute/data";
import { DEVICE_KEY, getObservationStore, OBSERVATION_ID, reporterHash } from "@/server/commute/observations";
import { clientAddress, rateLimited } from "@/server/reports";

const KINDS: ObservationKind[] = ["opening", "full", "meter_active"];
const UNDO_MS = 10 * 60_000;
const PLAUSIBLE_M = 600;

/** GET /api/commute/observations?campus=gt — live availability summaries (reports expire in minutes). */
export async function GET(request: NextRequest) {
  const campus = request.nextUrl.searchParams.get("campus");
  if (!isCampusId(campus)) return commuteError("Unknown campus.", "invalid", 400);
  try {
    const now = Date.now();
    const [data, obs] = await Promise.all([getCampus(campus), getObservationStore().recent(now - 15 * 60_000)]);
    const live = obs.filter((o) => o.verification !== "held");
    const summaries = data.bundle.parking
      .map((p) => {
        const s = summarizeAvailability(live, p.id, now);
        return { placeId: p.id, state: s.state, reports: s.reports, latestAt: s.latestAt, label: availabilityLabel(s, now) };
      })
      .filter((s) => s.state !== "none");
    return NextResponse.json({ now, summaries }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleCommuteFailure(err);
  }
}

/**
 * POST /api/commute/observations {campus, placeId, kind, deviceKey, location?}
 * One-tap report. An optional location (shared with consent) is checked against the
 * place and then discarded. Meter reports go to review and are never shown as availability.
 */
export async function POST(request: Request) {
  if (rateLimited(clientAddress(request.headers), "vote")) return commuteError("Too many reports from this connection. Try again later.", "rate_limited", 429);
  const body = await readJsonBody(request);
  if (!body || !isCampusId(body.campus)) return commuteError("Unknown campus.", "invalid", 400);
  const kind = KINDS.find((k) => k === body.kind);
  const deviceKey = typeof body.deviceKey === "string" && DEVICE_KEY.test(body.deviceKey) ? body.deviceKey : null;
  if (!kind || !deviceKey || typeof body.placeId !== "string") return commuteError("Invalid report.", "invalid", 400);
  try {
    const data = await getCampus(body.campus);
    const place = data.bundle.parking.find((p) => p.id === body.placeId);
    if (!place) return commuteError("Unknown parking place.", "invalid", 400);
    let verification: "located" | "manual" | "held" = "manual";
    const loc = body.location as { lon?: unknown; lat?: unknown } | undefined;
    if (loc && typeof loc.lon === "number" && typeof loc.lat === "number") {
      const k = Math.cos((loc.lat * Math.PI) / 180);
      const m = Math.hypot((loc.lon - place.center[0]) * k, loc.lat - place.center[1]) * 111_195;
      if (m > PLAUSIBLE_M) return commuteError("You seem to be away from this place. Reports are for places you can see.", "invalid", 422);
      verification = "located";
    }
    const store = getObservationStore();
    const now = Date.now();
    const reporter = reporterHash(deviceKey);
    const recent = await store.recent(now - 15 * 60_000);
    const allowed = allowSubmission(recent, reporter, place.id, now);
    if (!allowed.ok) return commuteError(allowed.reason, "rate_limited", 429);
    if (kind !== "meter_active" && isSuspiciousBurst(recent, place.id, now)) verification = "held";
    const saved = await store.add({ placeId: place.id, kind, reporter, at: now, verification });
    const live = [...recent, saved].filter((o) => o.verification !== "held");
    const s = summarizeAvailability(live, place.id, now);
    return NextResponse.json(
      {
        id: saved.id,
        at: saved.at,
        undoUntil: now + UNDO_MS,
        held: verification === "held",
        review: kind === "meter_active",
        summary: { placeId: place.id, state: s.state, reports: s.reports, latestAt: s.latestAt, label: availabilityLabel(s, now) },
      },
      { status: 201 },
    );
  } catch (err) {
    return handleCommuteFailure(err);
  }
}

/** DELETE /api/commute/observations {id, deviceKey} — undo your own report within 10 minutes. */
export async function DELETE(request: Request) {
  const body = await readJsonBody(request);
  const id = typeof body?.id === "string" && OBSERVATION_ID.test(body.id) ? body.id : null;
  const deviceKey = typeof body?.deviceKey === "string" && DEVICE_KEY.test(body.deviceKey) ? body.deviceKey : null;
  if (!id || !deviceKey) return commuteError("Invalid request.", "invalid", 400);
  try {
    const store = getObservationStore();
    const mine = (await store.recent(Date.now() - UNDO_MS)).find((o) => o.id === id);
    if (!mine || !(await store.remove(id, reporterHash(deviceKey)))) return commuteError("This report can no longer be undone.", "invalid", 410);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleCommuteFailure(err);
  }
}
