"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DESCRIPTION_MAX, validateReport, type CommunityReport, type ReportCategory } from "@/lib/reports";

/**
 * Community barrier reports for the rider app: the shared list (GET /api/reports), loaded once when
 * a screen that shows them opens, and refreshed on demand. Votes and new reports replace the
 * matching entry with the server's copy, so the screen always shows what the server accepted.
 */
export function useCommunityReports(active: boolean) {
  const [reports, setReports] = useState<CommunityReport[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    fetch("/api/reports", { signal: c.signal, cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { reports?: CommunityReport[]; error?: string } | null;
        if (!r.ok || !body?.reports) throw new Error(body?.error ?? "Community reports couldn't be loaded.");
        setReports(body.reports);
        loaded.current = true;
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(navigator.onLine ? e.message || "Community reports couldn't be loaded." : "You're offline. Community reports need a connection.");
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (active && !loaded.current) refresh();
  }, [active, refresh]);
  useEffect(
    () => () => {
      ctrl.current?.abort();
      ctrl.current = null;
    },
    [],
  );

  /** Put the server's copy of a report into the list (new, or after a vote). */
  const upsert = useCallback((r: CommunityReport) => {
    setReports((list) => {
      const rest = (list ?? []).filter((x) => x.id !== r.id);
      return [r, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  return { reports, loading, error, refresh, upsert };
}

export type CommunityReports = ReturnType<typeof useCommunityReports>;

const VOTES_KEY = "cm.report-votes.v1";

/** Votes this device has already cast (a courtesy so one person doesn't tap twice; the server rate-limits). */
export function readVotes(): Record<string, "confirm" | "fixed"> {
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY) ?? "{}") as Record<string, "confirm" | "fixed">;
  } catch {
    return {};
  }
}

export async function castVote(id: string, vote: "confirm" | "fixed"): Promise<{ ok: true; report: CommunityReport } | { ok: false; error: string }> {
  try {
    const r = await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vote }) });
    const body = (await r.json().catch(() => null)) as { report?: CommunityReport; error?: string } | null;
    if (!r.ok || !body?.report) return { ok: false, error: body?.error ?? "Your vote couldn't be saved. Try again." };
    try {
      localStorage.setItem(VOTES_KEY, JSON.stringify({ ...readVotes(), [id]: vote }));
    } catch {
      // Storage is off: the vote still counted on the server.
    }
    return { ok: true, report: body.report };
  } catch {
    return { ok: false, error: navigator.onLine ? "CrossMetric can't be reached right now. Try again." : "You're offline. Votes need a connection." };
  }
}

export type ReportStep = "location" | "category" | "details" | "review" | "done";

export interface ReportLocation {
  lon: number;
  lat: number;
  /** The nearest address or street, when the reverse lookup found one. */
  label: string | null;
  source: "map" | "current" | "search";
}

/**
 * The report flow: where, what, an optional note, a review, then the server's answer. Success is
 * shown only after the server accepted the report (201 with the saved report).
 */
export function useReportFlow() {
  const [step, setStep] = useState<ReportStep>("location");
  const [location, setLocation] = useState<ReportLocation | null>(null);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CommunityReport | null>(null);
  /** Set once the map has been moved for this report (to the person, or to a searched place), so it is not moved again. */
  const placed = useRef(false);

  const reset = useCallback(() => {
    placed.current = false;
    setStep("location");
    setLocation(null);
    setCategory(null);
    setDescription("");
    setSubmitting(false);
    setError(null);
    setSaved(null);
  }, []);

  /** The same checks the server makes, so a mistake shows before sending. */
  const check = useCallback((): string | null => {
    if (!location) return "Choose where the barrier is.";
    if (!category) return "Choose what kind of barrier it is.";
    if (description.length > DESCRIPTION_MAX) return `Keep the description under ${DESCRIPTION_MAX} characters.`;
    const v = validateReport({ category, description: description.trim() || null, lon: location.lon, lat: location.lat, locationLabel: location.label });
    return v.ok ? null : v.error;
  }, [location, category, description]);

  const submit = useCallback(async (): Promise<CommunityReport | null> => {
    const problem = check();
    if (problem) {
      setError(problem);
      return null;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, description: description.trim() || null, lon: location!.lon, lat: location!.lat, locationLabel: location!.label }),
      });
      const body = (await r.json().catch(() => null)) as { report?: CommunityReport; error?: string } | null;
      if (r.status !== 201 || !body?.report) {
        setError(body?.error ?? "The report wasn't saved. Please try again.");
        return null;
      }
      setSaved(body.report);
      setStep("done");
      return body.report;
    } catch {
      setError(navigator.onLine ? "CrossMetric can't be reached right now. Your report wasn't sent; try again." : "You're offline. Your report wasn't sent; try again when you're connected.");
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [check, category, description, location]);

  const isPlaced = useCallback(() => placed.current, []);
  const markPlaced = useCallback(() => {
    placed.current = true;
  }, []);

  return { step, setStep, location, setLocation, category, setCategory, description, setDescription, submitting, error, setError, saved, reset, check, submit, isPlaced, markPlaced };
}

export type ReportFlow = ReturnType<typeof useReportFlow>;
