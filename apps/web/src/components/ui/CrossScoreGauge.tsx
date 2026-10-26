"use client";

import { useEffect, useRef, useState } from "react";
import { crossScoreBand } from "@crossmetric/engine";
import { BAND_HEX } from "./Status";

const TICKS = 36;
const SWEEP = 240; // degrees
const START = 90 + (360 - SWEEP) / 2; // from lower-left, clockwise over the top

/** Animate a number toward `target` (skipped when the user prefers reduced motion). */
function useAnimatedNumber(target: number, durationMs = 450): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    fromRef.current = target;
    if (reduce || from === target) {
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

/**
 * CrossScore instrument: a segmented 240° scale with band thresholds marked,
 * filled to the score, with the number at its center.
 */
export function CrossScoreGauge({ score, size = 132, label, showScale = true }: { score: number; size?: number; label?: string; showScale?: boolean }) {
  const shown = useAnimatedNumber(score);
  const band = crossScoreBand(shown);
  const color = BAND_HEX[band.id];
  const r = 50;
  const inner = 41;
  const filled = Math.round((shown / 100) * TICKS);
  const thresholds = [50, 75];
  const big = size >= 110;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size * 0.86 }} role="img" aria-label={label ?? `CrossScore ${score} out of 100: ${crossScoreBand(score).label}`}>
      <svg viewBox="0 0 120 104" width={size} height={size * 0.86} aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => {
          const a = ((START + (i / (TICKS - 1)) * SWEEP) * Math.PI) / 180;
          const value = (i / (TICKS - 1)) * 100;
          const major = thresholds.some((t) => Math.abs(value - t) < 100 / (TICKS - 1) / 2);
          const r0 = major && showScale ? inner - 3 : inner;
          const on = i < filled;
          return (
            <line
              key={i}
              x1={60 + r0 * Math.cos(a)}
              y1={58 + r0 * Math.sin(a)}
              x2={60 + r * Math.cos(a)}
              y2={58 + r * Math.sin(a)}
              stroke={on ? color : "#e3e8ef"}
              strokeWidth={big ? 3.2 : 3.6}
              strokeLinecap="round"
              style={{ transition: "stroke 220ms ease" }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-x-0 text-center" style={{ top: size * 0.25 }}>
        <span className="tabular block font-semibold leading-none text-navy-900" style={{ fontSize: size * 0.3 }}>
          {shown}
        </span>
        <span className="tabular mt-1 block font-medium text-ink-muted" style={{ fontSize: Math.max(11, size * 0.095) }}>
          / 100
        </span>
      </div>
    </div>
  );
}

/** Compact circular meter for mode cards and lists. */
export function ScoreRing({ score, size = 56, muted = false }: { score: number | null; size?: number; muted?: boolean }) {
  const band = score === null ? null : crossScoreBand(score);
  const r = 22;
  const c = 2 * Math.PI * r;
  const frac = score === null ? 0 : (score / 100) * 0.75;
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={score === null ? "No CrossScore" : `CrossScore ${score} out of 100: ${band!.label}`}>
      <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden className="-rotate-[225deg]">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#e3e8ef" strokeWidth="5" strokeDasharray={`${c * 0.75} ${c}`} strokeLinecap="round" />
        {score !== null ? (
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            stroke={muted ? "#9fb3cc" : BAND_HEX[band!.id]}
            strokeWidth="5"
            strokeDasharray={`${c * frac} ${c}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 400ms var(--ease-out)" }}
          />
        ) : null}
      </svg>
      <span className="tabular absolute text-body font-semibold text-navy-900" style={{ fontSize: size * 0.3 }}>
        {score === null ? "—" : score}
      </span>
    </span>
  );
}
