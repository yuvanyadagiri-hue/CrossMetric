"use client";

import { useEffect, useMemo, useRef } from "react";
import { dueEntries, localMinutes, materialChange, planVersion, reconcileOutbox, remindersFor, type OutboxEntry, type PlanSnapshot } from "@crossmetric/engine/commute";
import { useActiveTrip, useOutbox } from "@/lib/commute-store";
import { tz } from "./format";
import type { AppModel } from "./model";

const CHANNEL = "inapp";

function message(kind: OutboxEntry["kind"], plan: PlanSnapshot, now: number): string {
  if (kind === "leave_now") return "Time to leave";
  if (kind === "update") return plan.late ? "Your trip is running late" : "Leave earlier than planned";
  const m = Math.max(1, Math.round((plan.latestLeave - now) / 60_000));
  return `Leave in ${m} min`;
}

function notify(text: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      // Generic text: no class, building or home address on the lock screen.
      new Notification("CrossMetric", { body: text, tag: "cm-leave", silent: false });
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the in-app announcement still shows.
  }
}

/**
 * In-app reminders for the next class, while CrossMetric is open.
 * The plan is recomputed before anything is sent (usePlan refreshes near
 * departure), entries are idempotent per (occurrence, kind, channel), and
 * past-due alerts collapse into one current instruction.
 */
export function useReminders(app: AppModel) {
  const [outbox, setOutbox] = useOutbox();
  const [trip] = useActiveTrip();
  const enabled = app.prefs.reminders;
  // Reminders follow the next class's own plan, never the route being browsed.
  const rec = app.classPlan.plan?.recommended ?? null;
  const late = app.classPlan.plan?.late ?? null;
  const occ = app.nextClass?.key ?? null;
  const classStart = app.nextClass?.start ?? null;

  const snapshot: PlanSnapshot | null = useMemo(() => {
    if (!enabled || !occ || !classStart || app.classPlan.cached) return null;
    const leave = rec?.leaveBy ?? null;
    if (leave === null && !late) return null;
    const latestLeave = leave ?? app.now;
    return { occurrenceKey: occ, classStart, latestLeave, version: planVersion([occ, latestLeave, rec?.id ?? late?.option.id]), late: !rec, optionSignature: rec?.id ?? "late" };
    // app.now only matters when there is no feasible plan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, occ, classStart, rec, late, app.classPlan.cached]);

  const prev = useRef<PlanSnapshot | null>(null);
  const lastUpdate = useRef<number | null>(null);

  // Schedule (or move) the reminders for the current plan; cancel ones for classes that no longer exist.
  useEffect(() => {
    if (!snapshot) return;
    const active = new Set(app.occurrences.map((o) => o.key));
    setOutbox((box) => {
      let next = reconcileOutbox(box, [{ plan: snapshot, reminders: remindersFor(snapshot, { prepMin: app.prefs.prepMin, classCheckMin: 30, materialMin: 3, cooldownMin: 10 }) }], CHANNEL, active);
      const p = prev.current;
      if (p && p.occurrenceKey === snapshot.occurrenceKey && p.version !== snapshot.version && materialChange(p, snapshot, lastUpdate.current, Date.now())) {
        lastUpdate.current = Date.now();
        next = [...next, { key: `${snapshot.occurrenceKey}|update|${CHANNEL}|${snapshot.version}`, occurrenceKey: snapshot.occurrenceKey, kind: "update", channel: CHANNEL, at: Date.now(), version: snapshot.version, status: "pending" }];
      }
      // Keep the outbox small: drop finished entries for classes that have started.
      return next.filter((e) => e.status === "pending" || e.at > Date.now() - 24 * 3600_000);
    });
    prev.current = snapshot;
  }, [snapshot, app.occurrences, app.prefs.prepMin, setOutbox]);

  // Deliver due entries.
  useEffect(() => {
    if (!enabled || !snapshot) return;
    const { send, drop } = dueEntries(outbox, {
      now: app.now,
      plans: new Map([[snapshot.occurrenceKey, snapshot]]),
      started: new Set(trip?.occurrenceKey ? [trip.occurrenceKey] : []),
      localMinute: localMinutes(app.now, tz),
    });
    if (!send.length && !drop.length) return;
    for (const e of send) notify(message(e.kind, snapshot, app.now));
    const sent = new Set(send.map((e) => e.key));
    const dropped = new Set(drop.map((e) => e.key));
    setOutbox((box) => box.map((e) => (sent.has(e.key) ? { ...e, status: "sent", sentAt: Date.now() } : dropped.has(e.key) ? { ...e, status: "cancelled" } : e)));
    if (send.length) {
      const last = send[send.length - 1]!;
      window.dispatchEvent(new CustomEvent("cm-reminder", { detail: message(last.kind, snapshot, app.now) }));
    }
  }, [app.now, outbox, snapshot, enabled, trip, setOutbox]);
}
