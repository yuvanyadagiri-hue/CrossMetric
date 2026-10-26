import type { ReactNode } from "react";

export function Card({ children, className = "", as: Tag = "section", interactive = false, ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" | "li"; interactive?: boolean } & Record<`aria-${string}`, string | undefined>) {
  return (
    <Tag className={`card ${interactive ? "card-interactive" : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Card heading row: optional icon tile, title, supporting line and a trailing action. */
export function CardHeader({ icon, title, subtitle, action, level = 2, className = "" }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode; level?: 2 | 3; className?: string }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      {icon ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <H className="text-body font-semibold leading-tight text-navy-900">{title}</H>
        {subtitle ? <p className="mt-0.5 text-small leading-snug text-ink-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SectionHeading({ title, subtitle, action, id }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-component font-semibold text-navy-900 sm:text-section">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 max-w-[680px] text-small leading-relaxed text-ink-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
