import type { ReactNode } from "react";
import { AlertTriangle, CircleAlert, Info, ShieldCheck } from "lucide-react";
import type { CrossScoreBandId } from "@crossmetric/engine";

export type Tone = "positive" | "caution" | "critical" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  positive: "bg-positive-bg text-positive-fg ring-[#c9ecdb]",
  caution: "bg-caution-bg text-caution-fg ring-[#f7e0b5]",
  critical: "bg-critical-bg text-critical-fg ring-[#f6d0d0]",
  info: "bg-brand-50 text-brand-700 ring-brand-100",
  neutral: "bg-subtle text-ink-soft ring-line",
};

const ICON: Record<Tone, ReactNode> = {
  positive: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
  caution: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
  critical: <CircleAlert className="h-3.5 w-3.5" aria-hidden />,
  info: <Info className="h-3.5 w-3.5" aria-hidden />,
  neutral: null,
};

/** Status label with an icon, so meaning never depends on color alone. */
export function Badge({ tone = "neutral", children, icon = true, className = "" }: { tone?: Tone; children: ReactNode; icon?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ring-1 ring-inset ${TONE[tone]} ${className}`}>
      {icon ? ICON[tone] : null}
      {children}
    </span>
  );
}

export function bandTone(band: CrossScoreBandId): Tone {
  return band === "lower" ? "positive" : band === "mixed" ? "caution" : "critical";
}

/** Hex colors for SVG and map styling of CrossScore bands. */
export const BAND_HEX: Record<CrossScoreBandId, string> = {
  lower: "#12a46f",
  mixed: "#f0a020",
  higher: "#e5484d",
};

export const BAND_TEXT: Record<CrossScoreBandId, string> = {
  lower: "text-positive-fg",
  mixed: "text-caution-fg",
  higher: "text-critical-fg",
};
