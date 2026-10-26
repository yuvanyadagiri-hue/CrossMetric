"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PriorityBand, PriorityBandId, StabilityLevel } from "@crossmetric/engine";

const BAND_STYLE: Record<PriorityBandId, { bg: string; fg: string; dot: string }> = {
  high: { bg: "bg-priority-high", fg: "text-white", dot: "bg-priority-high" },
  elevated: { bg: "bg-priority-elevated", fg: "text-navy-950", dot: "bg-priority-elevated" },
  moderate: { bg: "bg-priority-moderate", fg: "text-navy-950", dot: "bg-priority-moderate" },
  lower: { bg: "bg-priority-lower-bg", fg: "text-ink-soft", dot: "bg-priority-lower" },
};

const BAND_TEXT: Record<PriorityBandId, string> = {
  high: "text-priority-high",
  elevated: "text-[#a35607]",
  moderate: "text-[#8a6a05]",
  lower: "text-ink-muted",
};

/** Priority score chip. Colour is never the only signal: the number is always shown. */
export function PriorityPill({ value, band, size = "sm" }: { value: number; band: PriorityBand; size?: "sm" | "lg" }) {
  const s = BAND_STYLE[band.id];
  if (size === "lg") {
    return (
      <span className={`inline-flex items-baseline gap-1 rounded-chip px-3 py-1.5 ${s.bg} ${s.fg}`} aria-label={`Priority ${value} out of 100, ${band.label}`}>
        <span className="tabular text-page font-semibold leading-none tracking-tight">{value}</span>
        <span className="text-small font-medium opacity-85">/ 100</span>
      </span>
    );
  }
  return (
    <span
      className={`tabular inline-flex h-[26px] min-w-[38px] items-center justify-center rounded-tag px-1.5 text-small font-semibold ${s.bg} ${s.fg}`}
      aria-label={`Priority ${value}, ${band.shortLabel}`}
    >
      {value}
    </span>
  );
}

export function BandLabel({ band, className = "" }: { band: PriorityBand; className?: string }) {
  return <span className={`font-semibold ${BAND_TEXT[band.id]} ${className}`}>{band.label}</span>;
}

export function BandDot({ band }: { band: PriorityBandId }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${BAND_STYLE[band].dot}`} />;
}

const STABILITY_STYLE: Record<StabilityLevel, string> = {
  high: "bg-brand-50 text-brand-700 ring-brand-100",
  moderate: "bg-[#fdf6e7] text-[#8a5a00] ring-[#f6e4bd]",
  low: "bg-[#fdeeee] text-[#a2302a] ring-[#f6d3d1]",
};

export function StabilityBadge({ level }: { level: StabilityLevel }) {
  const label = { high: "High stability", moderate: "Moderate stability", low: "Low stability" }[level];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-meta font-semibold ring-1 ring-inset ${STABILITY_STYLE[level]}`}>{label}</span>;
}

/** Accessible help tooltip: a button that reveals a short explanation on hover or focus. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="grid h-4 w-4 place-items-center rounded-full text-ink-faint hover:text-ink-soft"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" strokeLinecap="round" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-6 z-40 w-64 -translate-x-1/2 rounded-md border border-line bg-white p-2.5 text-meta font-normal leading-[1.45] text-ink-soft shadow-[var(--shadow-float)]"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: string;
  badge?: number;
}

/** WAI-ARIA tabs with arrow-key navigation and an animated active indicator. */
export function Tabs<T extends string>({ tabs, active, onChange, label, size = "md" }: { tabs: TabDef<T>[]; active: T; onChange: (id: T) => void; label: string; size?: "sm" | "md" }) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  const measure = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(active)}"]`);
    if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth });
  }, [active]);
  useLayoutEffect(() => {
    measure();
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, tabs.length]);
  return (
    <div ref={listRef} role="tablist" aria-label={label} className="relative flex gap-1 border-b border-line">
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={`${baseId}-${t.id}`}
            data-tab={t.id}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
              onChange(next.id);
              document.getElementById(`${baseId}-${next.id}`)?.focus();
            }}
            className={`relative -mb-px inline-flex items-center gap-1.5 px-2.5 ${size === "sm" ? "py-2 text-meta" : "py-2.5 text-small"} font-medium transition-colors ${
              selected ? "text-navy-900" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.badge ? <span className="tabular rounded-full bg-brand-600 px-1.5 text-meta font-semibold leading-[17px] text-white">{t.badge}</span> : null}
          </button>
        );
      })}
      {bar ? (
        <span
          aria-hidden
          className="absolute bottom-[-1px] left-0 h-[2px] rounded-full bg-brand-600 transition-[transform,width] duration-200 ease-[var(--ease-out)]"
          style={{ width: bar.w, transform: `translateX(${bar.x}px)` }}
        />
      ) : null}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-small font-semibold text-navy-900">{children}</h3>
      {action}
    </div>
  );
}

/** Horizontal score bar (0–100). `null` renders as an explicit "unavailable" state, never as 0. */
export function ScoreBar({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return (
      <div className="h-2 w-full rounded-full bg-[repeating-linear-gradient(45deg,#eef0f3,#eef0f3_4px,#f7f8fa_4px,#f7f8fa_8px)]" role="img" aria-label={`${label}: data unavailable`} />
    );
  }
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[#edf0f4]" role="img" aria-label={`${label}: ${Math.floor(value + 0.5)} out of 100`}>
      <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-700 transition-[width] duration-300" style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  );
}
