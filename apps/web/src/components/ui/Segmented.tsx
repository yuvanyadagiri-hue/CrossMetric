"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Single-choice segmented control (radio group) with a sliding indicator.
 * Arrow keys move the selection; the indicator animates between options.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className = "",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
    if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const enabled = options.filter((o) => !o.disabled);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={`relative flex rounded-ctl bg-subtle p-1 ring-1 ring-inset ring-line ${className}`}>
      {box ? (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-chip bg-white shadow-[0_1px_2px_rgb(7_27_51/0.08),0_1px_3px_rgb(7_27_51/0.06)] ring-1 ring-line transition-[transform,width] duration-200 ease-[var(--ease-out)]"
          style={{ width: box.w, transform: `translateX(${box.x - 4}px)`, left: 4 }}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={o.id}
            disabled={o.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
              e.preventDefault();
              const i = enabled.findIndex((x) => x.id === value);
              const next = enabled[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : enabled.length - 1)) % enabled.length];
              if (!next) return;
              onChange(next.id);
              ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.id)}"]`)?.focus();
            }}
            className={`relative z-[1] inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-chip font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              size === "sm" ? "px-2.5 py-1.5 text-meta" : "px-3 py-2 text-small"
            } ${selected ? "text-navy-900" : "text-ink-muted hover:text-navy-900"}`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
