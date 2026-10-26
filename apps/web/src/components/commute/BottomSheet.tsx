"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { haptic, releaseVelocity, settleSnap } from "./motion";

export type Snap = "rest" | "half" | "full";

interface Props {
  snap: Snap;
  onSnap: (s: Snap) => void;
  label: string;
  /** Reports the height covering the map once the sheet settles. */
  onCover: (c: { bottom: number; left: number }) => void;
  children: ReactNode;
  /** Optional footer pinned at the bottom of the sheet (primary action). */
  footer?: ReactNode;
  /** Changes when the content is a different screen (scrolls back to the top). */
  contentKey?: string;
  /** Height (px) of the bar the sheet sits on (the phone tab bar), 0 when it reaches the bottom edge. */
  offset?: number;
  /** The most of the screen the resting sheet may take (a share of the height). */
  restMax?: number;
  /** The share of the height the half-open sheet takes. */
  halfShare?: number;
}

const REST_MAX = 0.46;
const HALF = 0.52;
const FULL = 0.86;
const HANDLE_H = 28;
const MIN_H = 120;
/** Movement (px) before a touch decides between scrolling, a sideways list, and dragging the sheet. */
const DECIDE = 3;
/** Less travel than this (px) is a tap, not a drag. */
const TAP_TRAVEL = 10;

type Gesture = {
  /** Where the finger went down. */
  x0: number;
  y0: number;
  /** Finger position and sheet height when the sheet started following (re-based after the decision). */
  baseY: number;
  baseH: number;
  h: number;
  /** Furthest the finger has travelled from where it went down. */
  travel: number;
  axis: "sheet" | "scroll" | "x" | null;
  fromHandle: boolean;
  samples: { t: number; h: number }[];
};

/**
 * Bottom sheet (resting, about half, and nearly full height) over the map. The sheet follows a finger anywhere on it: until it is fully
 * open, dragging the content moves the sheet; when it is open, the content scrolls
 * and a downward drag from the top collapses it. A flick moves one size. The
 * handle is also a button that cycles the size, arrow keys resize it and Escape
 * collapses it. While dragging, only this element and a CSS variable change, so
 * the rest of the app does not re-render on every frame.
 */
export function BottomSheet({ snap, onSnap, label, onCover, children, footer, contentKey, offset = 0, restMax = REST_MAX, halfShare = HALF }: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(180);
  const [footerH, setFooterH] = useState(0);
  const [vh, setVh] = useState(800);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(0);

  useLayoutEffect(() => {
    // The app may sit in a phone-sized frame on a big screen, so measure the app, not the window.
    const host = sheetRef.current?.closest<HTMLElement>(".cm-app") ?? null;
    const measure = () => {
      setVh(host?.clientHeight || window.innerHeight);
      // Inner content height plus the scroll container's vertical padding.
      if (innerRef.current) setContentH(innerRef.current.offsetHeight + 12);
      setFooterH(footerRef.current?.offsetHeight ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (host) ro.observe(host);
    if (innerRef.current) ro.observe(innerRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [footer]);

  // A new screen starts at its top.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [contentKey]);

  const avail = vh - offset;
  const restH = Math.min(contentH + HANDLE_H + footerH, avail * restMax);
  const halfH = Math.max(restH, avail * halfShare);
  // Full height stops below the search bar so it stays reachable.
  const fullH = Math.min(avail * FULL, avail - 88);
  const target = snap === "rest" ? restH : snap === "half" ? halfH : fullH;

  // The map's controls and attribution follow the sheet through a CSS variable set on the
  // map only (not the app root), so a drag restyles a handful of elements per frame.
  const setCoverVar = useCallback(
    (h: number | null, drag = false) => {
      const root = sheetRef.current?.closest<HTMLElement>(".cm-app");
      if (!root) return;
      root.querySelectorAll<HTMLElement>("[data-follow-sheet]").forEach((el) => {
        if (h === null) el.style.removeProperty("--cm-sheet-cover");
        else el.style.setProperty("--cm-sheet-cover", `${Math.round(h + offset)}px`);
        el.toggleAttribute("data-sheet-dragging", drag);
      });
    },
    [offset],
  );

  useEffect(() => {
    if (!dragging) {
      setCoverVar(target);
      onCover({ bottom: Math.round(target + offset), left: 0 });
    }
  }, [target, dragging, onCover, setCoverVar, offset]);

  const cycle = useCallback(() => onSnap(snap === "rest" ? "half" : snap === "half" ? "full" : "rest"), [snap, onSnap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && snap !== "rest") onSnap("rest");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap, onSnap]);

  // Latest values for the native touch listeners (attached once per sheet element).
  const live = useRef({ snap, restH, halfH, fullH, target, onSnap });
  useEffect(() => {
    live.current = { snap, restH, halfH, fullH, target, onSnap };
  });

  const applyHeight = useCallback(
    (h: number) => {
      const el = sheetRef.current;
      if (!el) return;
      el.style.height = `${h}px`;
      setCoverVar(h, true);
    },
    [setCoverVar],
  );

  const begin = useCallback((x: number, y: number, fromHandle: boolean) => {
    const h = sheetRef.current?.getBoundingClientRect().height ?? live.current.target;
    gesture.current = { x0: x, y0: y, baseY: y, baseH: h, h, travel: 0, axis: null, fromHandle, samples: [{ t: performance.now(), h }] };
  }, []);

  /** Returns true while the gesture is moving the sheet. */
  const move = useCallback(
    (x: number, y: number): boolean => {
      const g = gesture.current;
      if (!g) return false;
      const dy = g.y0 - y; // positive: finger moving up
      const dx = x - g.x0;
      g.travel = Math.max(g.travel, Math.hypot(dx, dy));
      if (g.axis === null) {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        // Decide on the first real movement, while the browser still lets a touch cancel its own
        // scrolling (once it starts scrolling, later moves can't be cancelled). Sideways movement
        // belongs to horizontal lists (chips); vertical movement moves the sheet until it is fully
        // open; when open, the content scrolls and only a pull-down from its top moves the sheet.
        if (ax < DECIDE && ay < DECIDE) return false;
        if (g.fromHandle) g.axis = "sheet";
        else if (ax > ay) g.axis = "x";
        else if (live.current.snap !== "full") g.axis = "sheet";
        else {
          const scroller = contentRef.current;
          g.axis = dy < 0 && (!scroller || scroller.scrollTop <= 0) ? "sheet" : "scroll";
        }
        if (g.axis === "sheet") {
          setDragging(true);
          // Re-base so the sheet does not jump by the decision distance.
          g.baseY = y;
          g.baseH = g.h;
        }
      }
      if (g.axis !== "sheet") return false;
      const { fullH: max } = live.current;
      const raw = g.baseH + (g.baseY - y);
      // Rubber-band past the ends instead of a hard stop.
      const h = raw > max ? max + (raw - max) * 0.2 : raw < MIN_H ? MIN_H - (MIN_H - raw) * 0.2 : raw;
      g.h = h;
      g.samples.push({ t: performance.now(), h });
      if (g.samples.length > 8) g.samples.shift();
      applyHeight(h);
      return true;
    },
    [applyHeight],
  );

  const end = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.axis !== "sheet") return false;
    const { restH: r, halfH: hf, fullH: f, snap: current, onSnap: set } = live.current;
    const heights: Record<Snap, number> = { rest: r, half: hf, full: f };
    const next = settleSnap(g.h, releaseVelocity(g.samples), [
      ["rest", r],
      ["half", hf],
      ["full", f],
    ]);
    // A tap with a little jitter is still a tap: the sheet goes back and the tap goes through.
    const tap = g.travel < TAP_TRAVEL;
    const settled = tap ? current : next;
    const el = sheetRef.current;
    if (el) {
      // Re-enable the transition and set the destination in the same frame, so it settles
      // from where the finger left it. React renders the same height next.
      el.removeAttribute("data-dragging");
      el.style.height = `${heights[settled]}px`;
    }
    setCoverVar(heights[settled]);
    setDragging(false);
    if (tap) return false;
    suppressClick.current = performance.now();
    if (next !== current) haptic();
    set(next);
    return true;
  }, [setCoverVar]);

  // Touch: native listeners so a drag on the content can stop it from scrolling (non-passive move).
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        gesture.current = null;
        return;
      }
      const t = e.touches[0]!;
      const target = e.target as HTMLElement;
      // Controls that need their own gestures opt out (text fields, sliders, anything marked).
      if (target.closest("input, textarea, select, [data-sheet-nodrag]")) {
        gesture.current = null;
        return;
      }
      begin(t.clientX, t.clientY, !!target.closest("[data-sheet-handle]"));
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (move(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };
    const onEnd = () => void end();
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [begin, move, end]);

  // A drag that ends over a button must not also press it.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (performance.now() - suppressClick.current < 350) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, []);

  // Mouse and pen drag the handle (touch is handled by the native listeners above).
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    begin(e.clientX, e.clientY, true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || !gesture.current) return;
    move(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const g = gesture.current;
    if (g && g.travel < 4) {
      // A click, not a drag: the button's onClick cycles the size.
      gesture.current = null;
      setDragging(false);
      return;
    }
    end();
  };

  return (
    <section
      ref={sheetRef}
      aria-label={label}
      data-dragging={dragging || undefined}
      className="cm-sheet-panel absolute inset-x-0 z-20 mx-auto flex max-w-[640px] flex-col rounded-t-sheet border-t border-app-line bg-app-surface shadow-[var(--app-shadow-sheet)] sm:border-x"
      style={{ height: target, bottom: offset ? `calc(${offset}px + env(safe-area-inset-bottom))` : 0, paddingBottom: offset ? 0 : "env(safe-area-inset-bottom)" }}
    >
      <button
        type="button"
        data-sheet-handle
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => {
          if (performance.now() - suppressClick.current < 350) return;
          cycle();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onSnap(snap === "rest" ? "half" : "full");
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onSnap(snap === "full" ? "half" : "rest");
          }
        }}
        aria-label={snap === "full" ? "Collapse panel" : "Expand panel"}
        aria-expanded={snap !== "rest"}
        className="group flex h-7 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span aria-hidden className={`h-[5px] rounded-full bg-app-line-strong transition-[width,background-color] duration-200 group-hover:bg-app-muted ${dragging ? "w-12 bg-app-muted" : "w-10"}`} />
      </button>
      {/* Until the sheet is fully open, touch drags move the sheet rather than scroll the content. */}
      <div ref={contentRef} className={`min-h-0 flex-1 px-4 pb-3 ${snap === "rest" && !dragging ? "overflow-hidden" : "overflow-y-auto overscroll-contain"}`} style={{ touchAction: snap === "full" ? "pan-y" : "none" }}>
        <div ref={innerRef}>{children}</div>
      </div>
      {footer ? (
        <div ref={footerRef} className="shrink-0 px-4 pb-3 pt-1">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
