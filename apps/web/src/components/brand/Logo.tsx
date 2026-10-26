/**
 * CrossMetric mark: a geometric X — two paths that cross at one point, the way two routes meet at an
 * intersection. One stroke is electric lime, the other route blue; the crossing is a navy node, so
 * the two read as separate paths even at 16 px. The geometry is shared with the launch screen
 * (Splash.tsx) and the app icons (scripts/make-app-icons.mjs).
 */

export const MARK = {
  viewBox: "0 0 64 64",
  /** Bottom-left to top-right (lime) and top-left to bottom-right (blue). */
  rise: "M 15 49 L 49 15",
  fall: "M 15 15 L 49 49",
  stroke: 9,
  /** The crossing node. */
  node: { cx: 32, cy: 32, r: 6.5 },
} as const;

/** The brand colours (globals.css carries the same values as tokens). */
export const BRAND = { navy: "#07111F", deep: "#030810", lime: "#91F24D", blue: "#42A5FF", teal: "#30D5C8", paper: "#F5F8FC" } as const;

interface LogoMarkProps {
  size?: number;
  title?: string;
  className?: string;
  /** "color": lime and blue strokes (on navy). "mono": both strokes in currentColor. */
  tone?: "color" | "mono";
  /** Fill of the crossing node (the surface behind the mark). */
  nodeFill?: string;
}

export function LogoMark({ size = 40, title, className, tone = "color", nodeFill = BRAND.navy }: LogoMarkProps) {
  const a = tone === "color" ? BRAND.lime : "currentColor";
  const b = tone === "color" ? BRAND.blue : "currentColor";
  return (
    <svg width={size} height={size} viewBox={MARK.viewBox} fill="none" strokeLinecap="round" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} className={className}>
      {title ? <title>{title}</title> : null}
      <path d={MARK.fall} stroke={b} strokeWidth={MARK.stroke} />
      <path d={MARK.rise} stroke={a} strokeWidth={MARK.stroke} />
      <circle cx={MARK.node.cx} cy={MARK.node.cy} r={MARK.node.r} fill={nodeFill} stroke={a} strokeWidth={3} />
    </svg>
  );
}

/** The app-icon form: the colour mark on a navy rounded tile with a hairline edge. */
export function LogoTile({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={`inline-grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size, borderRadius: size * 0.28, background: BRAND.navy, boxShadow: "inset 0 0 0 1px rgb(245 248 252 / 0.1)" }}>
      <LogoMark size={size * 0.74} />
    </span>
  );
}

/** Mark + wordmark. */
export function LogoLockup({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoTile size={size} />
      <span className="font-semibold tracking-[-0.02em]" style={{ fontSize: size * 0.6 }}>
        CrossMetric
      </span>
    </span>
  );
}

/** Compact header version: small tile + wordmark. */
export function HeaderLogo({ className = "text-navy-900" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoTile size={28} />
      <span className="text-component font-semibold tracking-[-0.02em]" aria-hidden>
        CrossMetric
      </span>
      <span className="sr-only">CrossMetric</span>
    </span>
  );
}
