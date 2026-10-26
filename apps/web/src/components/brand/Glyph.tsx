import type { SVGProps } from "react";

/**
 * CrossMetric's ways of travelling as solid pictograms on a 48 × 48 grid. They are drawn in the current
 * text colour with cut-outs in `--glyph-cut` (the colour of whatever sits behind them), so one set works
 * on green, on near-black and on gray. Decorative: always pair with a visible or screen-reader label.
 */
export type GlyphName = "transit" | "walk" | "bike" | "drive" | "rideshare" | "park_ride" | "compare" | "night" | "car";

const CUT = "var(--glyph-cut, #91F24D)";

export function Glyph({ name, ...rest }: { name: GlyphName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden focusable="false" {...rest}>
      {SHAPES[name]}
    </svg>
  );
}

const SHAPES: Record<GlyphName, React.ReactNode> = {
  // A metro car seen from the front.
  transit: (
    <>
      <rect x="9" y="4" width="30" height="33" rx="9" fill="currentColor" />
      <rect x="13.5" y="9" width="21" height="12" rx="4" fill={CUT} />
      <circle cx="17" cy="29" r="2.6" fill={CUT} />
      <circle cx="31" cy="29" r="2.6" fill={CUT} />
      <path d="M16 37l-4.5 7.5M32 37l4.5 7.5" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
    </>
  ),
  // A person mid-stride.
  walk: (
    <>
      <circle cx="28" cy="8" r="4.6" fill="currentColor" />
      <path d="M26.5 16.5L22.5 29M22.5 29l7.5 8.5-1 7.5M22.5 29l-7.5 8-2 6.5M25.5 18.5l8.5 6M25.5 18.5l-8 5.5-1 6.5" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // A bicycle in profile.
  bike: (
    <>
      <circle cx="11" cy="32" r="7.2" stroke="currentColor" strokeWidth="3.6" />
      <circle cx="37" cy="32" r="7.2" stroke="currentColor" strokeWidth="3.6" />
      <path d="M11 32l9-14h13M25 32L20 18M25 32l8-14 4 14M33 18l-1.6-5.5H37M16.5 17.5H24" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // A car in profile.
  drive: (
    <>
      <path d="M4 30c0-4.4 1.6-6.4 5.2-7.2l3.2-6.6C13.8 13.4 15.8 12 18.6 12h10.8c2.8 0 4.8 1.4 6.2 4.2l3.2 6.6c3.6.8 5.2 2.8 5.2 7.2v4H4z" fill="currentColor" />
      <path d="M15.2 22.4l2.6-5.2c.4-.8 1-1.2 1.9-1.2H24v6.4zM27 22.4V16h4.3c.9 0 1.5.4 1.9 1.2l2.6 5.2z" fill={CUT} />
      <circle cx="13.5" cy="35.5" r="5.6" fill="currentColor" stroke={CUT} strokeWidth="2.6" />
      <circle cx="34.5" cy="35.5" r="5.6" fill="currentColor" stroke={CUT} strokeWidth="2.6" />
    </>
  ),
  // The same car with a roof light, for ride-hail.
  rideshare: (
    <>
      <rect x="19" y="5.5" width="10" height="5" rx="2.2" fill="currentColor" />
      <path d="M4 31c0-4.4 1.6-6.4 5.2-7.2l3.2-6.2C13.8 14.8 15.8 13.5 18.6 13.5h10.8c2.8 0 4.8 1.3 6.2 4.1l3.2 6.2c3.6.8 5.2 2.8 5.2 7.2v3.5H4z" fill="currentColor" />
      <path d="M15.2 23l2.6-4.9c.4-.8 1-1.1 1.9-1.1H24v6zM27 23v-6h4.3c.9 0 1.5.3 1.9 1.1L35.8 23z" fill={CUT} />
      <circle cx="13.5" cy="36" r="5.4" fill="currentColor" stroke={CUT} strokeWidth="2.6" />
      <circle cx="34.5" cy="36" r="5.4" fill="currentColor" stroke={CUT} strokeWidth="2.6" />
    </>
  ),
  // A P sign: park, then ride.
  park_ride: (
    <>
      <rect x="5" y="5" width="38" height="38" rx="11" fill="currentColor" />
      <path d="M18.5 37V11h8.6c5.2 0 8.4 3.1 8.4 7.9s-3.2 7.9-8.4 7.9h-4.6V37zm4-14.3h4.2c2.5 0 4.3-1.4 4.3-3.8s-1.8-3.8-4.3-3.8h-4.2z" fill={CUT} fillRule="evenodd" />
    </>
  ),
  // Two ways to the same place.
  compare: (
    <>
      <circle cx="10" cy="38" r="5.4" fill="currentColor" />
      <rect x="29" y="5" width="14" height="14" rx="3.4" fill="currentColor" />
      <path d="M10 32.5C10 20 36 28 36 20" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M16 38c12 0 20-4 20-12" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeDasharray="1 7" />
    </>
  ),
  // A crescent moon with a star.
  night: (
    <>
      <path d="M35 29.5A15.5 15.5 0 0 1 18.5 13c0-2.3.5-4.5 1.4-6.4A17.5 17.5 0 1 0 41.4 28.1c-2 .9-4.2 1.4-6.4 1.4z" fill="currentColor" />
      <path d="M33 6l1.6 3.9L38.5 11.5 34.6 13.1 33 17l-1.6-3.9-3.9-1.6 3.9-1.6z" fill="currentColor" />
    </>
  ),
  // A parked car seen from above.
  car: (
    <>
      <rect x="12" y="3" width="24" height="42" rx="10" fill="currentColor" />
      <path d="M16.5 14.5c0-2 .8-3 2.4-3.4 3.6-.9 6.6-.9 10.2 0 1.6.4 2.4 1.4 2.4 3.4v4.5h-15z" fill={CUT} />
      <path d="M16.5 33.5h15v3.2c0 1.6-.7 2.6-2.2 3-3.5.8-6.7.8-10.6 0-1.5-.4-2.2-1.4-2.2-3z" fill={CUT} />
    </>
  ),
};
