import type { LonLat } from "@/lib/trip-types";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

export function boundsOf(points: LonLat[]): [LonLat, LonLat] | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

/** Point at a fraction of a line's length (for placing route labels). */
export function pointAlong(line: LonLat[], fraction: number): LonLat {
  if (line.length < 2) return line[0] ?? [0, 0];
  const k = Math.cos(((line[0]![1]) * Math.PI) / 180);
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot((line[i]![0] - line[i - 1]![0]) * k, line[i]![1] - line[i - 1]![1]);
    seg.push(d);
    total += d;
  }
  let target = total * fraction;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i]!) {
      const t = seg[i]! > 0 ? target / seg[i]! : 0;
      return [line[i]![0] + (line[i + 1]![0] - line[i]![0]) * t, line[i]![1] + (line[i + 1]![1] - line[i]![1]) * t];
    }
    target -= seg[i]!;
  }
  return line[line.length - 1]!;
}

export const ROUTE_COLORS = {
  selected: "#23744A",
  selectedCasing: "#ffffff",
  alternative: "#8ea3bd",
  elevated: "#e5484d",
  moderate: "#f0a020",
};

/** Small round marker element for map places. */
export function markerElement(kind: "origin" | "destination" | "institution" | "hotspot" | "pickup" | "pickupBest", label: string, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cm-marker";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.title = label;
  if (kind === "origin") {
    el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px #15191E,0 2px 6px rgba(21,25,30,.35)";
  } else if (kind === "destination" || kind === "institution") {
    el.style.cssText = "width:34px;height:42px;display:grid;place-items:start center;filter:drop-shadow(0 2px 4px rgba(21,25,30,.3))";
    el.innerHTML =
      '<svg width="34" height="42" viewBox="0 0 34 42" aria-hidden="true"><path d="M17 41s14-13.2 14-24A14 14 0 0 0 3 17c0 10.8 14 24 14 24Z" fill="' +
      (kind === "destination" ? "#23744A" : "#15191E") +
      '" stroke="#fff" stroke-width="2"/>' +
      (kind === "destination"
        ? '<circle cx="17" cy="17" r="5.5" fill="#fff"/>'
        : '<path d="M17 9.5 8.5 13.5 17 17.5l8.5-4Zm-5.5 6.2v3.6c0 1.6 2.5 2.9 5.5 2.9s5.5-1.3 5.5-2.9v-3.6L17 18.3Z" fill="#fff"/>') +
      "</svg>";
  } else if (kind === "hotspot") {
    el.style.cssText = "width:24px;height:24px;cursor:pointer;filter:drop-shadow(0 1px 2px rgba(21,25,30,.35))";
    el.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 22.5 20.5h-21Z" fill="#e5484d" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.3" fill="#fff"/></svg>';
  } else {
    const best = kind === "pickupBest";
    el.style.cssText = `min-width:26px;height:26px;padding:0 6px;border-radius:13px;display:grid;place-items:center;font:600 12px var(--font-sans),sans-serif;color:#fff;background:${best ? "#12a46f" : "#15191E"};box-shadow:0 0 0 2px #fff,0 2px 6px rgba(21,25,30,.3);cursor:pointer`;
    el.textContent = text ?? "";
  }
  return el;
}
