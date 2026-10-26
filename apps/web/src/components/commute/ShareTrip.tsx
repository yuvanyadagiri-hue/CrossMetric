"use client";

import { useState } from "react";
import { Copy, Share2, X } from "lucide-react";
import { timingLabel } from "@crossmetric/engine/commute";
import type { JourneyOption } from "@/lib/journey-types";
import { canShareStart, shareTripUrl } from "@/lib/share";
import { clock, duration, tz } from "./format";
import type { AppModel } from "./model";
import { IconButton, SecondaryButton, Toggle } from "./ui";

const HOW: Record<JourneyOption["kind"], string> = { walk: "on foot", bike: "by bike", transit: "by transit", drive: "by car", park_ride: "by park & ride" };

/**
 * Share the trip on screen as a link. The destination and time are always in the link;
 * the start only when the person turns it on, and never their live location.
 */
export function ShareTrip({ app, option, onClose }: { app: AppModel; option: JourneyOption; onClose: () => void }) {
  const j = app.journey;
  const [includeStart, setIncludeStart] = useState(false);
  const startOk = canShareStart(j.origin);
  if (!j.destination) return null;
  const url = shareTripUrl(window.location.origin, { origin: j.origin, destination: j.destination, timing: j.timing, includeStart: includeStart && startOk });
  if (!url) return null;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const text = `${j.destination.label}: about ${duration(option.durationMin)} ${HOW[option.kind]}, leaving ${clock(option.leaveAt)}. A planning estimate from CrossMetric.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      app.toast("Link copied. It opens this trip in CrossMetric.");
    } catch {
      app.toast("Couldn't copy here. Select the link and copy it instead.");
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `Trip to ${j.destination!.label}`, text, url });
    } catch (e) {
      // Cancelled by the person, or not allowed: nothing to report.
      if ((e as Error).name !== "AbortError") void copy();
    }
  };

  return (
    <section aria-label="Share this trip" className="cm-rise-in space-y-3 rounded-surface border border-app-line bg-app-surface p-3.5 shadow-[var(--app-shadow)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-body font-semibold">Share this trip</h3>
          <p className="text-small leading-snug text-app-muted">
            The link opens the same search: {j.destination.label}
            {j.timing.mode === "now" ? ", leaving when it's opened" : `, ${timingLabel(j.timing, app.now, tz).toLowerCase()}`}. Times are recalculated when it is opened.
          </p>
        </div>
        <IconButton label="Close sharing" onClick={onClose} className="-mr-2 -mt-1">
          <X className="h-5 w-5" aria-hidden />
        </IconButton>
      </div>
      {startOk ? (
        <Toggle label="Include the start" detail={includeStart ? `Shares "${j.origin!.label}"` : "Off: the person opening it starts from their own location"} checked={includeStart} onChange={setIncludeStart} />
      ) : (
        <p className="text-small text-app-muted">Your current location is never put in a link; the person opening it starts from theirs.</p>
      )}
      <p className="truncate rounded-chip bg-app-chip px-3 py-2 font-mono text-meta text-app-muted" title={url}>
        {url}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {canNativeShare ? (
          <SecondaryButton icon={<Share2 className="h-4 w-4" aria-hidden />} onClick={() => void share()}>
            Share…
          </SecondaryButton>
        ) : null}
        <SecondaryButton icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => void copy()} className={canNativeShare ? "" : "col-span-2"}>
          Copy link
        </SecondaryButton>
      </div>
    </section>
  );
}
