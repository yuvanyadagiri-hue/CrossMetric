"use client";

import { useState } from "react";

const BAR = "#23744A";
const MUTED = "#c3c9d3";

/** Monthly crash records — shows the complete months used and the partial month excluded. */
export function MonthlyBars({ data, windowEnd }: { data: { month: string; crashes: number }[]; windowEnd: string; excluded?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.crashes), 1);
  const endMonth = windowEnd.slice(0, 7);
  const h = 120;
  const bw = 100 / data.length;
  const fmt = (m: string) => {
    const [y, mm] = m.split("-");
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm) - 1]} ${y}`;
  };
  const active = hover !== null ? data[hover] : null;
  return (
    <figure>
      <div className="relative">
        <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="h-[140px] w-full" role="img" aria-label="Crash records per month in the analysis window">
          <line x1="0" x2="100" y1={h - 0.5} y2={h - 0.5} stroke="#e4e8ee" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => {
            const bh = (d.crashes / max) * (h - 8);
            const inWindow = d.month <= endMonth;
            return (
              <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * bw} y={0} width={bw} height={h} fill="transparent" />
                <rect x={i * bw + bw * 0.12} y={h - bh} width={bw * 0.76} height={bh} rx={0.6} fill={inWindow ? BAR : MUTED} opacity={hover === null || hover === i ? 1 : 0.55} />
              </g>
            );
          })}
        </svg>
        {active ? (
          <div className="pointer-events-none absolute -top-2 rounded-md border border-line bg-white px-2 py-1 text-meta text-ink shadow-[var(--shadow-float)]" style={{ left: `min(calc(${((hover ?? 0) + 0.5) * bw}% - 60px), calc(100% - 130px))` }}>
            <span className="font-semibold">{fmt(active.month)}</span>: {active.crashes.toLocaleString("en-US")} crashes
          </div>
        ) : null}
      </div>
      <figcaption className="mt-1 flex justify-between text-meta text-ink-muted">
        <span>{fmt(data[0]?.month ?? "")}</span>
        <span>{fmt(data[data.length - 1]?.month ?? "")}</span>
      </figcaption>
    </figure>
  );
}

/** Horizontal magnitude bars with the value printed beside each bar. */
export function ValueBars({ rows, total }: { rows: { label: string; value: number; note?: string; tone?: "keep" | "drop" }[]; total: number }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value.toLocaleString("en-US")} (${((100 * r.value) / total).toFixed(1)}%)`}>
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="text-ink">{r.label}</span>
            <span className="tabular shrink-0 font-medium text-ink">
              {r.value.toLocaleString("en-US")} <span className="text-ink-muted">· {((100 * r.value) / total).toFixed(1)}%</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-tag bg-[#f0f2f5]">
            <div className="h-full rounded-tag" style={{ width: `${Math.max(0.4, (100 * r.value) / total)}%`, background: r.tone === "drop" ? "#8a94a6" : BAR }} />
          </div>
          {r.note ? <p className="mt-0.5 text-meta text-ink-muted">{r.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}
