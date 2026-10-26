/**
 * Reminder lifecycle: what to schedule for a class occurrence, and an outbox
 * that never sends a routine reminder twice.
 *
 * Logical uniqueness is (occurrence, kind, channel). Plan revisions update the
 * pending entry in place; obsolete entries are cancelled; past-due entries for
 * one occurrence collapse into a single current instruction.
 */

export type ReminderKind = "heads_up" | "leave_now" | "recheck" | "update";

export interface ReminderPrefs {
  /** Preparation buffer before the leave time. */
  prepMin: number;
  /** Also check 30 minutes before class (the requested check), in addition to the computed times. */
  classCheckMin: number;
  /** Notify about a change only if the departure moves earlier by at least this. */
  materialMin: number;
  cooldownMin: number;
  quietStart?: number; // minutes after midnight, local
  quietEnd?: number;
}

export const REMINDER_DEFAULTS: ReminderPrefs = { prepMin: 10, classCheckMin: 30, materialMin: 3, cooldownMin: 10 };

export interface PlanSnapshot {
  occurrenceKey: string;
  classStart: number;
  latestLeave: number;
  /** Hash of the plan's inputs and choice; changes when the plan changes. */
  version: string;
  /** True when no option can arrive on time. */
  late: boolean;
  /** The selected option's identity (to detect "selected leg unusable"). */
  optionSignature: string;
}

export interface ScheduledReminder {
  kind: ReminderKind;
  at: number;
}

/** heads_up = min(class - 30 min, leave - prep); leave_now = leave; recheck = class - 30 min. */
export function remindersFor(plan: PlanSnapshot, prefs: ReminderPrefs = REMINDER_DEFAULTS): ScheduledReminder[] {
  const classCheck = plan.classStart - prefs.classCheckMin * 60_000;
  const headsUp = Math.min(classCheck, plan.latestLeave - prefs.prepMin * 60_000);
  // The class-minus-30 check re-evaluates the plan; every dispatch also recomputes first.
  return [
    { kind: "heads_up", at: headsUp },
    { kind: "leave_now", at: plan.latestLeave },
    { kind: "recheck", at: classCheck },
  ];
}

export interface OutboxEntry {
  /** occurrence|kind|channel */
  key: string;
  occurrenceKey: string;
  kind: ReminderKind;
  channel: string;
  at: number;
  version: string;
  status: "pending" | "sent" | "cancelled";
  sentAt?: number;
}

export function outboxKey(occurrenceKey: string, kind: ReminderKind, channel: string): string {
  return `${occurrenceKey}|${kind}|${channel}`;
}

/**
 * Merge freshly computed reminders into the outbox.
 * - pending entries with the same key are moved to the new time and version (no duplicates)
 * - sent entries are left alone (a routine reminder is never resent)
 * - pending entries for occurrences no longer in `active` are cancelled
 */
export function reconcileOutbox(outbox: OutboxEntry[], plans: { plan: PlanSnapshot; reminders: ScheduledReminder[] }[], channel: string, active: Set<string>): OutboxEntry[] {
  const byKey = new Map(outbox.map((e) => [e.key, { ...e }]));
  for (const e of byKey.values()) {
    if (e.status === "pending" && e.channel === channel && !active.has(e.occurrenceKey)) e.status = "cancelled";
  }
  for (const { plan, reminders } of plans) {
    for (const r of reminders) {
      const key = outboxKey(plan.occurrenceKey, r.kind, channel);
      const prev = byKey.get(key);
      if (prev && prev.status === "sent") continue;
      byKey.set(key, { key, occurrenceKey: plan.occurrenceKey, kind: r.kind, channel, at: r.at, version: plan.version, status: "pending" });
    }
  }
  return [...byKey.values()];
}

export interface DispatchContext {
  now: number;
  /** Current plans by occurrence; entries whose occurrence or version disappeared are dropped. */
  plans: Map<string, PlanSnapshot>;
  /** Occurrences whose trip was started or that already arrived (preparation alerts are obsolete). */
  started: Set<string>;
  /** Minutes after local midnight, for quiet hours. */
  localMinute?: number;
  prefs?: ReminderPrefs;
}

/**
 * Entries to deliver now. Revalidates against the current plan, suppresses obsolete
 * preparation alerts, respects quiet hours, and sends at most one routine alert per
 * occurrence (the most current) instead of a burst of catch-up messages.
 */
export function dueEntries(outbox: OutboxEntry[], ctx: DispatchContext): { send: OutboxEntry[]; drop: OutboxEntry[] } {
  const prefs = ctx.prefs ?? REMINDER_DEFAULTS;
  const send: OutboxEntry[] = [];
  const drop: OutboxEntry[] = [];
  const due = outbox.filter((e) => e.status === "pending" && e.at <= ctx.now);
  const byOcc = new Map<string, OutboxEntry[]>();
  for (const e of due) {
    const plan = ctx.plans.get(e.occurrenceKey);
    if (!plan || plan.version !== e.version || plan.classStart <= ctx.now) {
      drop.push(e);
      continue;
    }
    if (e.kind === "recheck") {
      // A recheck is work for the scheduler, not a message.
      drop.push(e);
      continue;
    }
    if (ctx.started.has(e.occurrenceKey) && (e.kind === "heads_up" || e.kind === "leave_now")) {
      drop.push(e);
      continue;
    }
    const arr = byOcc.get(e.occurrenceKey) ?? [];
    arr.push(e);
    byOcc.set(e.occurrenceKey, arr);
  }
  const quiet =
    prefs.quietStart !== undefined && prefs.quietEnd !== undefined && ctx.localMinute !== undefined
      ? prefs.quietStart <= prefs.quietEnd
        ? ctx.localMinute >= prefs.quietStart && ctx.localMinute < prefs.quietEnd
        : ctx.localMinute >= prefs.quietStart || ctx.localMinute < prefs.quietEnd
      : false;
  const order: Record<ReminderKind, number> = { update: 3, leave_now: 2, heads_up: 1, recheck: 0 };
  for (const entries of byOcc.values()) {
    entries.sort((a, b) => order[b.kind] - order[a.kind] || b.at - a.at);
    const [current, ...stale] = entries;
    drop.push(...stale);
    if (quiet && current!.kind !== "update") drop.push(current!);
    else send.push(current!);
  }
  return { send, drop };
}

/** Whether a recomputed plan deserves an "update" message. */
export function materialChange(prev: PlanSnapshot, next: PlanSnapshot, lastUpdateAt: number | null, now: number, prefs: ReminderPrefs = REMINDER_DEFAULTS, newDisruption = false): boolean {
  const earlier = (prev.latestLeave - next.latestLeave) / 60_000 >= prefs.materialMin;
  const becameLate = !prev.late && next.late;
  const legGone = prev.optionSignature !== next.optionSignature && next.latestLeave < prev.latestLeave;
  if (!(earlier || becameLate || legGone || newDisruption)) return false;
  if (newDisruption) return true;
  return lastUpdateAt === null || now - lastUpdateAt >= prefs.cooldownMin * 60_000;
}

/** A small stable string hash for plan versions (FNV-1a). */
export function planVersion(parts: unknown[]): string {
  const s = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
