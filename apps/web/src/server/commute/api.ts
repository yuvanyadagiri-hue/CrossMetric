import "server-only";

import { NextResponse } from "next/server";
import type { CommuteApiError, OptionKind, PlanRequest, VehicleInput } from "@/lib/commute-types";
import { isCampusId } from "@/lib/commute-types";
import { CommuteDataMissing } from "./data";

export function commuteError(error: string, kind: CommuteApiError["kind"], status: number) {
  return NextResponse.json({ error, kind } satisfies CommuteApiError, { status, headers: { "Cache-Control": "no-store" } });
}

export function handleCommuteFailure(err: unknown) {
  if (err instanceof CommuteDataMissing) return commuteError("Campus data has not been built on this server.", "data_missing", 503);
  console.error(err);
  return commuteError("Something went wrong. Try again in a moment.", "unavailable", 500);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);

const YEAR = 365 * 24 * 3600_000;
const PERMIT = /^[A-Za-z0-9-]{2,12}$/;
const BUILDING = /^[wr]\d{1,12}$/;
const MODES: OptionKind[] = ["walk", "drive", "transit", "park_ride"];

/** Rough Georgia bounds: commuters may start anywhere in the state. */
export function inGeorgia(lon: number, lat: number) {
  return lon >= -85.65 && lon <= -80.8 && lat >= 30.33 && lat <= 35.03;
}

export function parseVehicle(raw: unknown): VehicleInput & { hasCar: boolean; mpg: number | null } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const permits = Array.isArray(r.permits) ? r.permits.filter((p): p is string => typeof p === "string" && PERMIT.test(p)).slice(0, 6) : [];
  const registered = r.registered === true ? true : r.registered === false ? false : null;
  const mpg = num(r.mpg);
  return { permits, registered, hasCar: r.hasCar !== false, mpg: mpg !== null && mpg >= 5 && mpg <= 150 ? mpg : null };
}

export function parsePlanRequest(body: Record<string, unknown> | null, now: number): { ok: true; value: PlanRequest; departNow: boolean } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Invalid request." };
  if (!isCampusId(body.campus)) return { ok: false, error: "Choose Georgia Tech or UGA." };
  const o = (body.origin && typeof body.origin === "object" ? body.origin : {}) as Record<string, unknown>;
  const lon = num(o.lon);
  const lat = num(o.lat);
  if (lon === null || lat === null || !inGeorgia(lon, lat)) return { ok: false, error: "The starting point must be in Georgia." };
  const tp = (body.toPoint && typeof body.toPoint === "object" ? body.toPoint : null) as Record<string, unknown> | null;
  const toPoint = tp && num(tp.lon) !== null && num(tp.lat) !== null && inGeorgia(tp.lon as number, tp.lat as number) ? { lon: tp.lon as number, lat: tp.lat as number, label: str(tp.label, 80) || "Destination" } : null;
  const buildingId = typeof body.buildingId === "string" && BUILDING.test(body.buildingId) ? body.buildingId : null;
  if (!buildingId && !toPoint) return { ok: false, error: "Choose a building." };
  const parkAt = typeof body.parkAt === "string" && /^[a-z]{2,3}-[A-Za-z0-9]{2,12}$/.test(body.parkAt) ? body.parkAt : null;
  const departNow = body.departNow === true;
  const deadline = num(body.deadline);
  if (!departNow && body.lastService !== true && (deadline === null || deadline < now - 3600_000 || deadline > now + YEAR)) return { ok: false, error: "Arrival time is out of range." };
  const parkUntil = num(body.parkUntil);
  const walkSpeed = num(body.walkSpeedMps);
  const fuel = num(body.fuelPrice);
  const modes = Array.isArray(body.modes) ? MODES.filter((m) => (body.modes as unknown[]).includes(m)) : MODES;
  return {
    ok: true,
    departNow,
    value: {
      campus: body.campus,
      origin: { lon, lat, label: str(o.label, 80) || "Start" },
      buildingId: buildingId ?? "",
      parkAt,
      toPoint,
      lastService: body.lastService === true,
      deadline: deadline ?? now,
      parkUntil: parkUntil !== null && parkUntil > now - 3600_000 && parkUntil < now + YEAR ? parkUntil : null,
      vehicle: parseVehicle(body.vehicle),
      fuelPrice: fuel !== null && fuel > 0.5 && fuel < 15 ? fuel : null,
      walkSpeedMps: walkSpeed !== null && walkSpeed >= 0.5 && walkSpeed <= 2.5 ? walkSpeed : 1.25,
      modes: modes.length ? modes : MODES,
    },
  };
}
