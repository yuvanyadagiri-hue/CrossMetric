"use client";

import { useEffect, useState } from "react";
import { BRAND, MARK } from "./Logo";

/**
 * The launch screen: a navy field where two paths draw in and cross — the CrossMetric X — the
 * crossing becomes a node, and the name and "Map. Plan. Move." rise under it. Then it fades into the
 * map.
 *
 * It is plain CSS (see premium.css), rendered on the server, so it is the first thing painted and
 * nothing waits for JavaScript. It plays on every cold launch (a fresh page load), never when
 * moving between pages, is skipped under automation unless `?intro=1`, and with reduced motion
 * shows the finished frame briefly. A tap ends it at once. Decoration only: nothing here is a real
 * route or place.
 */
export function Splash() {
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Play once per launch: when it ends, later mounts (moving between pages) hide it from the start.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => {
      document.documentElement.dataset.cmIntro = "off";
      setGone(true);
    }, reduce ? 1500 : 2900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      document.documentElement.dataset.cmIntro = "off";
      setGone(true);
    }, 220);
    return () => clearTimeout(t);
  }, [leaving]);

  if (gone) return null;
  return (
    <div className="cm-splash" data-exit="fade" data-leaving={leaving || undefined} aria-hidden onPointerDown={() => setLeaving(true)}>
      <div className="cm-splash-content">
        <div className="cm-splash-center">
          <svg className="cm-splash-mark" viewBox={MARK.viewBox} fill="none" strokeLinecap="round">
            <path d={MARK.fall} pathLength={1} stroke={BRAND.blue} strokeWidth={MARK.stroke} />
            <path d={MARK.rise} pathLength={1} stroke={BRAND.lime} strokeWidth={MARK.stroke} />
            <circle className="cm-sp-node" cx={MARK.node.cx} cy={MARK.node.cy} r={MARK.node.r} fill={BRAND.navy} stroke={BRAND.lime} strokeWidth={3} />
          </svg>
          <p className="cm-splash-word">CrossMetric</p>
          <p className="cm-splash-tag">Map. Plan. Move.</p>
        </div>
      </div>
    </div>
  );
}
