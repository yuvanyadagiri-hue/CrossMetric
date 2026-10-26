"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The desktop panel: one scrolling column between the rail and the map, holding whichever screen
 * is open (Explore, a route comparison, a report, Account …), with that screen's primary action
 * pinned at its foot. The map beside it stays visible on every screen.
 */
export function SidePanel({ label, children, footer, contentKey, bare }: { label: string; children: ReactNode; footer?: ReactNode; contentKey?: string; /** The content brings its own padding (pages). */ bare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // A new screen starts at its top.
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [contentKey]);
  return (
    <section aria-label={label} className="cm-panel absolute inset-y-0 z-30 flex flex-col" style={{ left: "var(--cm-rail-w)", width: "var(--cm-panel-w)" }}>
      <div ref={ref} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={`flex min-h-full flex-col ${bare ? "pb-6" : "px-5 pb-6 pt-5"}`}>{children}</div>
      </div>
      {footer ? <div className="shrink-0 border-t border-app-line bg-app-bg px-5 py-3">{footer}</div> : null}
    </section>
  );
}
