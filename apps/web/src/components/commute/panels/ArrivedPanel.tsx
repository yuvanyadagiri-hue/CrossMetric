"use client";

import { ArrowRight, Check, ReceiptText, X } from "lucide-react";
import type { JourneyMode } from "@crossmetric/engine/commute";
import { clock, duration, usd } from "../format";
import { MODE_CHIP_LABEL } from "../journey-ui";
import type { AppModel } from "../model";
import { PrimaryButton, StateMessage } from "../ui";

/**
 * The end of a trip, like the Uber app's trip-complete screen: a bold full-screen moment, then the
 * facts. It states what happened (planned time against the time it took), and never asks the
 * person to rate or report anything.
 */
export function ArrivedPanel({ app }: { app: AppModel }) {
  const a = app.arrived;
  const done = () => {
    app.clearArrived();
    app.go({ kind: "home" });
  };
  if (!a) {
    return (
      <div className="px-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
        <StateMessage icon={<Check className="h-5 w-5" />} title="No trip just finished" action={<PrimaryButton onClick={() => app.go({ kind: "home" })}>Back to Home</PrimaryButton>}>
          When you finish a trip, a summary of it shows here.
        </StateMessage>
      </div>
    );
  }
  const diff = a.tookMin - a.plannedMin;
  const verdict = Math.abs(diff) <= 1 ? "About as planned" : diff < 0 ? `${duration(-diff)} faster than planned` : `${duration(diff)} longer than planned`;
  const way = a.kind in MODE_CHIP_LABEL ? MODE_CHIP_LABEL[a.kind as JourneyMode] : a.title;
  return (
    <section aria-label="Trip complete" className="cm-arrived flex flex-1 flex-col px-5" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
      <div className="flex h-12 items-center justify-between">
        <span className="t-component">CrossMetric</span>
        <button type="button" onClick={done} aria-label="Close" className="cm-press grid h-11 w-11 place-items-center rounded-full bg-black/10 hover:bg-black/15">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <span className="cm-arrived-ring relative grid h-[148px] w-[148px] place-items-center rounded-full" aria-hidden>
          <span className="cm-arrived-ring-a absolute inset-0 rounded-full border-[3px] border-[#07111F]/80" />
          <span className="cm-arrived-ring-b absolute inset-[18px] rounded-full border-[3px] border-[#07111F]/45" />
          <span className="cm-arrived-core relative grid h-[76px] w-[76px] place-items-center rounded-full bg-[#07111F] text-uber">
            <Check className="h-10 w-10" strokeWidth={3.2} />
          </span>
        </span>
        <h2 className="t-display mt-8">You&rsquo;ve arrived.</h2>
        <p className="t-component mt-2 max-w-[300px] [overflow-wrap:anywhere]">{a.to}</p>
        <p className="mt-1 text-body font-medium text-[#07111F]/75">{verdict}</p>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-[#07111F]/15 border-y border-[#07111F]/15 py-3" aria-label="Trip summary">
        <Fact label="Took" value={duration(a.tookMin)} />
        <Fact label="Planned" value={duration(a.plannedMin)} />
        <Fact label="Est. cost" value={a.costUsd === null ? "Unknown" : a.costUsd === 0 ? "Free" : usd(a.costUsd)} />
      </dl>
      <p className="t-num mt-3 text-center text-small font-medium text-[#07111F]/75">
        {way} · finished {clock(a.endedAt)}
      </p>

      <div className="mt-5 space-y-2.5">
        <button type="button" onClick={done} className="cm-press flex min-h-[58px] w-full items-center justify-center gap-2 rounded-ctl bg-[#07111F] px-5 text-component font-semibold text-[#F5F8FC]">
          Done
          <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
        {app.prefs.keepHistory ? (
          <button
            type="button"
            onClick={() => {
              app.clearArrived();
              app.go({ kind: "activity" }, "full", true);
            }}
            className="cm-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-ctl bg-black/10 px-5 text-body font-medium hover:bg-black/15"
          >
            <ReceiptText className="h-5 w-5" aria-hidden />
            See it in Activity
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 text-left first:pl-0 last:pr-0">
      <dt className="text-small font-medium text-[#07111F]/75">{label}</dt>
      <dd className="t-num t-component mt-0.5 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
