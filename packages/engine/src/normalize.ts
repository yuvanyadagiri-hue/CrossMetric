/**
 * Empirical-percentile normalization (identical to pipeline/scoring/model.py).
 *
 *   score(v) = 100 * (number of available values <= v) / N
 *
 * For "lower is priority" measures (distance), the comparison flips to >=.
 * For evidence measures (crash counts), a value of 0 scores 0: having no
 * observed crashes should add no priority, rather than inheriting the
 * percentile of a large tie at zero.
 * `null` values are unavailable and score `null`.
 */
export function percentileScores(
  values: (number | null)[],
  options: { lowerIsPriority: boolean; evidence: boolean },
): (number | null)[] {
  const available = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const n = available.length;
  if (n === 0) return values.map(() => null);
  const sorted = [...available].sort((a, b) => a - b);
  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return null;
    if (options.evidence && v === 0) return 0;
    const count = options.lowerIsPriority ? n - lowerBound(sorted, v) : upperBound(sorted, v);
    return (100 * count) / n;
  });
}

/** First index with sorted[i] >= v. */
function lowerBound(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with sorted[i] > v. */
function upperBound(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Ordinal suffix for percentile phrases: 1st, 2nd, 3rd, 11th, 95th. */
export function ordinal(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1:
      return `${v}st`;
    case 2:
      return `${v}nd`;
    case 3:
      return `${v}rd`;
    default:
      return `${v}th`;
  }
}

/** Same as Math.round for the non-negative values used here; mirrors Python round_half_up. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
