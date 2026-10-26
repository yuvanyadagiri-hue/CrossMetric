/**
 * Small, pure helpers behind the app's motion: where a released sheet settles,
 * how much camera padding still leaves a usable map, and a light haptic tick.
 * No React here, so they are unit-tested directly.
 */

export type SnapPoint<S extends string> = [S, number];

/** Above this speed (px per ms) a release is a flick: it moves one snap in that direction. */
export const FLICK_SPEED = 0.45;

/**
 * Where a released sheet settles. `height` is its height at release and `velocity`
 * its speed in px/ms (positive = moving up, getting taller). A flick goes to the
 * next snap in its direction; a slow release goes to the snap nearest to where
 * the motion would carry it.
 */
export function settleSnap<S extends string>(height: number, velocity: number, points: SnapPoint<S>[]): S {
  const sorted = [...points].sort((a, b) => a[1] - b[1]);
  if (!sorted.length) throw new Error("settleSnap needs at least one snap point");
  if (Math.abs(velocity) >= FLICK_SPEED) {
    if (velocity > 0) return (sorted.find((p) => p[1] > height + 8) ?? sorted[sorted.length - 1]!)[0];
    return ([...sorted].reverse().find((p) => p[1] < height - 8) ?? sorted[0]!)[0];
  }
  const projected = height + velocity * 160;
  return sorted.reduce((best, p) => (Math.abs(p[1] - projected) < Math.abs(best[1] - projected) ? p : best))[0];
}

/** Release speed from recent samples (time ms, height px): the slope over the last ~100 ms. */
export function releaseVelocity(samples: { t: number; h: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  let first = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    first = samples[i]!;
    if (last.t - first.t >= 100) break;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.h - first.h) / dt : 0;
}

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Camera padding that always leaves at least `min` px of map to frame into. When the
 * sheet covers most of the screen, the padding shrinks proportionally instead of the
 * camera refusing to move (MapLibre will not fit bounds into a negative area).
 */
export function fitPadding(pad: Padding, width: number, height: number, min = 96): Padding {
  const fit = (a: number, b: number, size: number) => {
    const free = size - a - b;
    if (free >= min) return [a, b] as const;
    const room = Math.max(0, size - min);
    const total = a + b || 1;
    return [Math.floor((a / total) * room), Math.floor((b / total) * room)] as const;
  };
  const [top, bottom] = fit(pad.top, pad.bottom, height);
  const [left, right] = fit(pad.left, pad.right, width);
  return { top, bottom, left, right };
}

/** A barely-there tap on phones that support it (Android Chrome); silently nothing elsewhere. */
export function haptic(ms = 8): void {
  try {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    navigator.vibrate(ms);
  } catch {
    // Not allowed here; haptics are decoration.
  }
}
