import "server-only";

import { NextResponse } from "next/server";
import type { ApiError, Place, PlaceKind } from "@/lib/trip-types";
import { isGeorgiaPoint } from "@/lib/trip-types";
import { INSTITUTION_ID } from "./repository";
import { RoutingError } from "./valhalla";

const KINDS: PlaceKind[] = ["school", "college", "address", "place", "current", "station"];

/** Validate an untrusted place object from a request body. */
export function parsePlace(raw: unknown): Place | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lon = Number(r.lon);
  const lat = Number(r.lat);
  if (!isGeorgiaPoint(lon, lat)) return null;
  const kind = KINDS.find((k) => k === r.kind) ?? "place";
  const label = typeof r.label === "string" ? r.label.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  const place: Place = { label: label || (kind === "current" ? "My location" : "Selected point"), lon, lat, kind };
  if (typeof r.sublabel === "string") place.sublabel = r.sublabel.replace(/\s+/g, " ").trim().slice(0, 160);
  if (typeof r.id === "string" && INSTITUTION_ID.test(r.id)) place.id = r.id;
  return place;
}

export function apiError(error: string, kind: ApiError["kind"], status: number) {
  return NextResponse.json({ error, kind } satisfies ApiError, { status });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 20_000) return null;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Map failures from routing / data loading onto honest API errors. */
export function handleRouteFailure(err: unknown) {
  if (err instanceof RoutingError) {
    return err.kind === "no_route"
      ? apiError("No route could be calculated between these places for this mode.", "no_route", 422)
      : apiError("The routing service is not responding right now. Try again in a moment.", "unavailable", 503);
  }
  if (err instanceof Error && err.message.includes("pipeline.publish.statewide")) {
    return apiError("Statewide safety data has not been built on this server.", "data_missing", 503);
  }
  return apiError("Something went wrong while analyzing this trip.", "unavailable", 500);
}
