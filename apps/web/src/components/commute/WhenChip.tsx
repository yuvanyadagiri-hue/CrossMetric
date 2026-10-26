"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { LEAVE_NOW, timingLabel, type TripTiming } from "@crossmetric/engine/commute";
import { tz } from "./format";
import { TimingControl } from "./journey-ui";

/**
 * "Now ▾" beside Where to? (the Uber app's pickup-time pill): choose Leave now,
 * Depart at or Arrive by before searching. The choice applies to the next search
 * only; a time that has passed is reported, never moved to another day.
 */
export function WhenChip({ timing, onChange, now, className = "", variant = "default", onOpen }: { timing: TripTiming; onChange: (t: TripTiming) => void; now: number; className?: string; /** "hero": on a navy surface. */ variant?: "default" | "hero"; /** Told when the chooser opens (a sheet makes room for it). */ onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const passed = timing.mode === "depart" ? timing.at < now - 60_000 : timing.mode === "arrive" ? timing.by < now : false;
  const label = timing.mode === "now" ? "Now" : timingLabel(timing, now, tz).replace(/^Depart /, "").replace(/^Arrive by /, "By ");
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`When: ${timing.mode === "now" ? "Leave now" : timingLabel(timing, now, tz)}. Change`}
        className={`cm-press inline-flex max-w-[150px] items-center gap-1.5 text-body font-medium ${variant === "hero" ? "h-[48px] rounded-ctl bg-[#07111F] px-3.5 text-white hover:bg-[#1B2A3E]" : "h-11 rounded-ctl bg-app-chip px-3.5 text-app-ink hover:bg-app-chip-hover"}`}
      >
        <Clock3 className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </button>
      {open ? (
        <div role="dialog" aria-label="When do you want to go?" className="cm-reveal absolute right-0 top-full z-40 mt-2 w-[min(340px,calc(100vw-32px))] space-y-3 rounded-surface border border-app-line bg-app-surface p-4 shadow-[var(--app-shadow-float)]">
          <p className="t-component">When do you want to go?</p>
          <TimingControl timing={timing} onChange={onChange} now={now} error={passed ? "That time has passed. Choose a later time or Leave now." : null} />
          <div className="flex gap-2">
            {timing.mode !== "now" ? (
              <button type="button" onClick={() => onChange(LEAVE_NOW)} className="min-h-[44px] flex-1 rounded-ctl bg-app-chip text-body font-medium hover:bg-app-chip-hover">
                Leave now
              </button>
            ) : null}
            <button type="button" onClick={() => setOpen(false)} disabled={passed} className="min-h-[44px] flex-1 rounded-ctl bg-app-primary text-body font-semibold text-app-on-primary hover:bg-app-primary-hover">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
