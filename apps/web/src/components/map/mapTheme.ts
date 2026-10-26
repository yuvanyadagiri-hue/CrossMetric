import type { PriorityBandId } from "@crossmetric/engine";

/** OpenStreetMap-based vector basemap (OpenFreeMap "Positron": light, low-contrast, no API key). */
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export const BAND_COLORS: Record<PriorityBandId, string> = {
  high: "#d33a32",
  elevated: "#ea8a1c",
  moderate: "#e3b52a",
  lower: "#9aa3b2",
};

/** MapLibre `match` expression colouring a feature by its `band` property. */
export const bandColorExpression = [
  "match",
  ["get", "band"],
  "high",
  BAND_COLORS.high,
  "elevated",
  BAND_COLORS.elevated,
  "moderate",
  BAND_COLORS.moderate,
  BAND_COLORS.lower,
] as unknown as string;

export const NAVY = "#15191E";
export const BLUE = "#23744A";

/** Small school glyph used as the selected-school marker (matches the logo's schoolhouse). */
export function schoolMarkerElement(label: string): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.style.cssText = "width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.18),0 0 0 1.5px #15191E;";
  el.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true"><g fill="#15191E">' +
    '<path d="M 10 40 L 36 34 L 36 80 L 10 80 Z"/><path d="M 64 34 L 90 40 L 90 80 L 64 80 Z"/>' +
    '<path d="M 33 32 L 50 16 L 67 32 L 67 80 L 33 80 Z"/><rect x="48.5" y="2" width="3" height="16"/>' +
    '<path d="M 51.5 2 L 63 6 L 51.5 10 Z"/></g><g fill="#fff">' +
    '<rect x="15" y="46" width="7" height="7"/><rect x="24" y="46" width="7" height="7"/><rect x="15" y="58" width="7" height="7"/><rect x="24" y="58" width="7" height="7"/>' +
    '<rect x="69" y="46" width="7" height="7"/><rect x="78" y="46" width="7" height="7"/><rect x="69" y="58" width="7" height="7"/><rect x="78" y="58" width="7" height="7"/>' +
    '<path d="M 44 80 L 44 64 A 6 6 0 0 1 56 64 L 56 80 Z"/></g></svg>';
  return el;
}
