import type { ReactNode } from "react";
import { AlertTriangle, Inbox, WifiOff } from "lucide-react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Empty state: what is missing, why, and (optionally) what to do next. */
export function EmptyState({ title, children, action, icon, compact = false }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "px-4 py-6" : "px-6 py-10"}`}>
      <span className="grid h-10 w-10 place-items-center rounded-full bg-subtle text-ink-muted" aria-hidden>
        {icon ?? <Inbox className="h-5 w-5" />}
      </span>
      <p className="mt-3 text-small font-semibold text-navy-900">{title}</p>
      {children ? <div className="mt-1 max-w-[380px] text-small leading-relaxed text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Recoverable problem: plain explanation plus a way forward. */
export function ErrorState({ title, children, action, kind = "error" }: { title: string; children?: ReactNode; action?: ReactNode; kind?: "error" | "offline" | "warning" }) {
  const Icon = kind === "offline" ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className={`flex gap-3 rounded-ctl border p-4 ${kind === "warning" ? "border-[#f7e0b5] bg-caution-bg" : "border-[#f6d0d0] bg-critical-bg"}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${kind === "warning" ? "text-caution-fg" : "text-critical-fg"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold text-navy-900">{title}</p>
        {children ? <div className="mt-0.5 text-small leading-relaxed text-ink-soft">{children}</div> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

/** Inline note about data limitations (never hidden). */
export function DataNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`rounded-chip bg-subtle px-3 py-2 text-meta leading-relaxed text-ink-soft ${className}`}>{children}</p>;
}
