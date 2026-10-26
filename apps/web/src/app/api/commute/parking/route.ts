import { NextResponse } from "next/server";
import { availabilityLabel, evaluateNow, evaluateStay, summarizeAvailability } from "@crossmetric/engine/commute";
import type { LonLat, ParkingResponse, ParkingResult } from "@/lib/commute-types";
import { isCampusId } from "@/lib/commute-types";
import { readJsonBody } from "@/server/api";
import { commuteError, handleCommuteFailure, inGeorgia, parseVehicle } from "@/server/commute/api";
import { getCampus } from "@/server/commute/data";
import { getObservationStore } from "@/server/commute/observations";

const YEAR = 365 * 24 * 3600_000;
const WALK_MPS = 1.25;

/**
 * POST /api/commute/parking {campus, vehicle, at, until?, near?}
 * Eligibility for every parking place (full stay when `until` is given, otherwise
 * "rules now"), price, walk estimate to `near`, and live availability reports.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const now = Date.now();
  if (!body || !isCampusId(body.campus)) return commuteError("Choose Georgia Tech or UGA.", "invalid", 400);
  const at = typeof body.at === "number" && Math.abs(body.at - now) < YEAR ? body.at : now;
  const until = typeof body.until === "number" && body.until > at + 60_000 && body.until < at + 7 * 24 * 3600_000 ? body.until : null;
  const near =
    Array.isArray(body.near) && body.near.length === 2 && body.near.every((v) => typeof v === "number") && inGeorgia(body.near[0] as number, body.near[1] as number)
      ? (body.near as LonLat)
      : null;
  const vehicle = parseVehicle(body.vehicle);
  try {
    const data = await getCampus(body.campus);
    const obs = (await getObservationStore().recent(now - 15 * 60_000)).filter((o) => o.verification !== "held");
    const results: ParkingResult[] = data.bundle.parking.map((p) => {
      const rules = data.rules.get(p.id)!;
      const ev = until ? evaluateStay(rules, vehicle, at, until, now) : evaluateNow(rules, vehicle, at);
      const k = near ? Math.cos((near[1] * Math.PI) / 180) : 1;
      const walkMin = near ? Math.max(1, Math.round((Math.hypot((p.center[0] - near[0]) * k, p.center[1] - near[1]) * 111_195 * 1.3) / WALK_MPS / 60)) : null;
      const sum = summarizeAvailability(obs, p.id, now);
      return {
        placeId: p.id,
        mode: until ? "stay" : "now",
        status: ev.status,
        price: ev.price,
        reason: ev.reason,
        usableUntil: ev.usableUntil,
        nextChange: ev.nextChange,
        walkMin,
        availability: { state: sum.state, reports: sum.reports, latestAt: sum.latestAt, label: availabilityLabel(sum, now) },
        sourceIds: ev.sourceIds,
        reviewBy: rules.reviewBy,
      };
    });
    const response: ParkingResponse = { campus: body.campus, at, until, results, notes: data.bundle.parkingNotes };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleCommuteFailure(err);
  }
}
