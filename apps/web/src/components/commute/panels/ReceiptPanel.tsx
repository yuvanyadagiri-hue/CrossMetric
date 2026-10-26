"use client";

import { CheckCircle2, CircleSlash, Search, Trash2 } from "lucide-react";
import type { JourneyMode } from "@crossmetric/engine/commute";
import { useTripHistory } from "@/lib/commute-store";
import { clock, dayLabel, duration, usd } from "../format";
import { MODE_ICON } from "../journey-ui";
import type { AppModel } from "../model";
import { PanelHeader, PrimaryButton, SecondaryButton, StateMessage } from "../ui";

const MODES = new Set(["walk", "bike", "transit", "drive", "park_ride"]);

/** One past trip, as a receipt: where, when, how long it took against the plan, and what it was estimated to cost. */
export function ReceiptPanel({ app, id }: { app: AppModel; id: string }) {
  const [history, setHistory] = useTripHistory();
  const t = history.find((x) => x.id === id);
  if (!t) {
    return (
      <div className="space-y-4 pt-1">
        <PanelHeader title="Trip" onBack={app.back} />
        <StateMessage icon={<CircleSlash className="h-5 w-5" />} title="This trip isn't here anymore" action={<SecondaryButton onClick={() => app.go({ kind: "activity" }, "full", true)}>Back to Activity</SecondaryButton>}>
          Past trips are kept on this device only, and they can be cleared from Activity or Account.
        </StateMessage>
      </div>
    );
  }
  const took = Math.max(1, Math.round((t.endedAt - t.startedAt) / 60_000));
  return (
    <div className="space-y-6 pt-1">
      <PanelHeader title="Trip" onBack={app.back} />

      <section aria-label="Summary" className="rounded-sheet bg-[#07111F] p-5 text-[#F5F8FC]">
        <div className="t-num flex items-center gap-2 text-small font-medium text-[#F5F8FC]/70">
          {MODES.has(t.kind) ? <span className="text-uber">{MODE_ICON[t.kind as JourneyMode]("h-5 w-5")}</span> : null}
          {dayLabel(t.startedAt, app.now)} · {clock(t.startedAt)} – {clock(t.endedAt)}
        </div>
        <p className="t-page mt-3 text-[#F5F8FC] [overflow-wrap:anywhere]">{t.to}</p>
        <p className="mt-1 text-body text-[#F5F8FC]/70">{t.title}</p>
        <p className="mt-4 flex items-center gap-2 border-t border-white/15 pt-3 text-body font-medium">
          {t.completed ? <CheckCircle2 className="h-5 w-5 shrink-0 text-uber" aria-hidden /> : <CircleSlash className="h-5 w-5 shrink-0" aria-hidden />}
          {t.completed ? "Arrived" : `Ended early · ${t.stepsDone} of ${t.steps} steps`}
        </p>
      </section>

      <section aria-label="Route" className="flex items-stretch gap-3 px-1">
        <div className="flex w-5 flex-col items-center py-[7px]" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-app-ink" />
          <span className="my-1 w-[2px] flex-1 bg-app-ink" />
          <span className="h-3 w-3 bg-app-ink" />
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          <p className="text-body font-medium [overflow-wrap:anywhere]">{t.from ?? "Where you started"}</p>
          <p className="text-body font-medium [overflow-wrap:anywhere]">{t.to}</p>
        </div>
      </section>

      <dl className="grid grid-cols-3 divide-x divide-app-line border-y border-app-line py-3" aria-label="Trip facts">
        {[
          ["Took", duration(took)],
          ["Planned", duration(t.plannedMin)],
          ["Est. cost", t.costUsd === undefined || t.costUsd === null ? "Unknown" : t.costUsd === 0 ? "Free" : usd(t.costUsd)],
        ].map(([k, v]) => (
          <div key={k} className="px-3 first:pl-0 last:pr-0">
            <dt className="text-small text-app-muted">{k}</dt>
            <dd className="t-num t-component mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2.5">
        <PrimaryButton icon={<Search className="h-5 w-5" aria-hidden />} onClick={() => app.searchFor(null)}>
          Plan a new trip
        </PrimaryButton>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm("Remove this trip from this device?")) return;
            setHistory((h) => h.filter((x) => x.id !== t.id));
            app.go({ kind: "activity" }, "full", true);
          }}
          className="cm-press flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctl text-body font-medium text-app-red"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Remove from Activity
        </button>
      </div>
      <p className="text-center text-meta text-app-muted">Only labels and times are kept on this device. No route or location is stored.</p>
    </div>
  );
}
