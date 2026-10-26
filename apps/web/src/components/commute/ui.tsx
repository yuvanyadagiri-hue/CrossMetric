"use client";

import { forwardRef, useId } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Ban, CircleCheck, CircleDollarSign, CircleHelp, Loader2 } from "lucide-react";
import type { EligibilityStatus } from "@crossmetric/engine/commute";

type Btn = ButtonHTMLAttributes<HTMLButtonElement>;

/** Full-width primary action (electric lime with navy type in the dark theme, navy in the light one), at least 56 px tall. One per screen. */
export const PrimaryButton = forwardRef<HTMLButtonElement, Btn & { busy?: boolean; icon?: ReactNode }>(function PrimaryButton({ children, className = "", busy, icon, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`flex min-h-[56px] w-full items-center justify-center gap-2 rounded-ctl bg-app-primary px-6 text-body font-semibold text-app-on-primary transition-[background-color,transform] duration-150 hover:bg-app-primary-hover active:scale-[0.985] ${className}`}
      {...rest}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/** Secondary action: a soft gray button, 48 px. */
export function SecondaryButton({ children, className = "", icon, ...rest }: Btn & { icon?: ReactNode }) {
  return (
    <button type="button" className={`cm-press flex min-h-[48px] items-center justify-center gap-2 rounded-ctl bg-app-chip px-5 text-body font-medium text-app-ink hover:bg-app-chip-hover ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** Quiet text action (links inside panels). */
export function TextButton({ children, className = "", icon, ...rest }: Btn & { icon?: ReactNode }) {
  return (
    <button type="button" className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-chip px-1 text-body font-medium text-app-route hover:underline ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function LinkButton({ children, className = "", icon, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { icon?: ReactNode }) {
  const external = !!href && /^(https?:|tel:)/.test(href);
  return (
    <a
      href={href}
      {...(external && !href!.startsWith("tel:") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`cm-press flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-ctl bg-app-chip px-4 text-body font-medium text-app-ink transition-colors hover:bg-app-chip-hover ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </a>
  );
}

/** Small round icon button (44 px target). */
export function IconButton({ label, children, className = "", ...rest }: Btn & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-app-ink transition-colors hover:bg-app-chip ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Compact on/off chip (ways to travel, filters you can combine). "On" is a quiet route-blue tint, so lime stays for single choices and the primary action. */
export function Chip({ active, children, icon, className = "", ...rest }: Btn & { active?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`cm-press inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-chip px-3.5 text-small font-medium ${active ? "bg-app-route-bg text-app-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-route)_45%,transparent)]" : "bg-app-chip text-app-muted hover:bg-app-chip-hover hover:text-app-ink"} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** On/off switch with a visible label (role="switch"). */
export function Toggle({ label, detail, checked, onChange, disabled, id }: { label: ReactNode; detail?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  const auto = useId();
  const tid = id ?? auto;
  return (
    <div className="flex min-h-[48px] items-center justify-between gap-3">
      <label htmlFor={tid} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-body text-app-ink">{label}</span>
        {detail ? <span className="block text-small text-app-muted">{detail}</span> : null}
      </label>
      <button
        id={tid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-app-primary" : "bg-app-line-strong"}`}
      >
        <span aria-hidden className={`absolute left-0 top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-standard)] ${checked ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
      </button>
    </div>
  );
}

/** Segmented choice (radio semantics). */
export function Segmented<T extends string | number | boolean | null>({ label, value, options, onChange, hideLabel }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; hideLabel?: boolean }) {
  return (
    <fieldset>
      <legend className={hideLabel ? "sr-only" : "mb-1.5 text-small font-medium text-app-ink"}>{label}</legend>
      <div className="flex rounded-ctl bg-app-chip p-1" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`min-h-[40px] flex-1 rounded-chip px-2 text-small font-medium transition-[background-color,color,box-shadow] duration-150 ${value === v ? "bg-app-surface text-app-ink shadow-[0_1px_2px_rgb(0_0_0/0.16)]" : "text-app-muted hover:text-app-ink"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const STATUS: Record<EligibilityStatus, { cls: string; icon: ReactNode; word: string }> = {
  allowed: { cls: "bg-app-teal-bg text-app-teal", icon: <CircleCheck className="h-3.5 w-3.5" aria-hidden />, word: "Eligible" },
  requires_action: { cls: "bg-app-chip text-app-ink", icon: <CircleDollarSign className="h-3.5 w-3.5" aria-hidden />, word: "Pay to park" },
  prohibited: { cls: "bg-app-red-bg text-app-red", icon: <Ban className="h-3.5 w-3.5" aria-hidden />, word: "Not allowed" },
  unknown: { cls: "bg-app-gray-bg text-app-gray", icon: <CircleHelp className="h-3.5 w-3.5" aria-hidden />, word: "Rules unknown" },
};

/** Eligibility badge: colour plus icon plus words (never colour alone). */
export function EligibilityBadge({ status, children }: { status: EligibilityStatus; children?: ReactNode }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-tag px-2 py-0.5 text-small font-medium ${s.cls}`}>
      {s.icon}
      {children ?? s.word}
    </span>
  );
}

export function Notice({ tone = "amber", children, icon }: { tone?: "amber" | "red" | "gray" | "route"; children: ReactNode; icon?: ReactNode }) {
  const cls = { amber: "bg-app-amber-bg text-app-amber", red: "bg-app-red-bg text-app-red", gray: "bg-app-gray-bg text-app-gray", route: "bg-app-route-bg text-app-route" }[tone];
  return (
    <p className={`flex items-start gap-2 rounded-ctl px-3 py-2 text-small font-medium leading-snug ${cls}`}>
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon ?? <AlertTriangle className="h-4 w-4" />}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Designed empty, error and status states: an icon, one plain sentence of what is
 * happening, and the action that fixes it. Never a blank area or an endless skeleton.
 */
export function StateMessage({ icon, title, children, action, tone = "neutral", busy }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; tone?: "neutral" | "warn" | "error"; busy?: boolean }) {
  // Only a warning or an error is a tinted surface (the colour means something). A neutral state is
  // plain content on the sheet, so its buttons are the only filled things in it.
  const box = tone === "error" ? "rounded-surface bg-app-red-bg p-4" : tone === "warn" ? "rounded-surface bg-app-amber-bg p-4" : "py-1";
  const mark = tone === "error" ? "text-app-red" : tone === "warn" ? "text-app-amber" : "text-app-ink";
  return (
    <div className={`flex flex-col items-start gap-3 ${box}`} role={tone === "error" ? "alert" : "status"} aria-busy={busy || undefined}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center ${mark}`} aria-hidden>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
        </span>
        <div className="min-w-0">
          <p className="t-component text-app-ink">{title}</p>
          {children ? <div className="mt-0.5 text-small text-app-muted">{children}</div> : null}
        </div>
      </div>
      {action ? <div className="flex w-full flex-wrap gap-2 pl-9">{action}</div> : null}
    </div>
  );
}

/** Route role label: the fastest and cheapest get the accent, everything else is neutral. */
export function RoleBadge({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return <span className={`inline-flex h-6 items-center rounded-tag px-2 text-meta font-semibold ${strong ? "bg-app-accent text-app-on-accent" : "bg-app-chip text-app-ink"}`}>{children}</span>;
}

export function SheetTitle({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="t-section text-app-ink [overflow-wrap:anywhere]">{children}</h2>
        {sub ? <p className="mt-0.5 text-small text-app-muted">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Panel header with a back button (browser history), title, subtitle and an optional action. */
export function PanelHeader({ title, sub, onBack, action, backLabel = "Back" }: { title: ReactNode; sub?: ReactNode; onBack?: () => void; action?: ReactNode; backLabel?: string }) {
  return (
    <div className="flex items-start gap-1">
      {onBack ? (
        <IconButton label={backLabel} onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </IconButton>
      ) : null}
      <div className={`min-w-0 flex-1 ${onBack ? "pt-1.5" : ""}`}>
        <h2 className="t-section [overflow-wrap:anywhere]">{title}</h2>
        {sub ? <div className="mt-0.5 text-small text-app-muted">{sub}</div> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * A page (Account, all services, your trips): a back button, the title and one line on the screen
 * colour, then the content. No coloured header block, so the page reads like the panels.
 */
export function TabPage({ title, sub, children, onBack }: { title: ReactNode; sub?: ReactNode; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-4 pb-2" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        {onBack ? (
          <IconButton label="Back" onClick={onBack} className="-ml-2 mb-1">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </IconButton>
        ) : null}
        <h2 className="t-page">{title}</h2>
        {sub ? <p className="mt-1.5 max-w-[440px] text-body text-app-muted">{sub}</p> : null}
      </header>
      <div className="flex-1 px-4 pb-4 pt-4">{children}</div>
    </div>
  );
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="t-component text-app-ink">{children}</h3>
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-app-chip ${className}`} />;
}

/** A tappable list row with a 44 px minimum height. */
export function Row({ children, className = "", selected, ...rest }: Btn & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`cm-press flex min-h-[60px] w-full items-center gap-3 rounded-ctl border-2 px-3.5 py-2.5 text-left ${selected ? "border-app-select bg-[var(--app-selected-bg)]" : "border-transparent hover:bg-app-chip"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
