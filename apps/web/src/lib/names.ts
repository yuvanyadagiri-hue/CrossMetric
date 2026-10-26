/**
 * Transit feeds often publish names in capitals ("NORTH SPRINGS STATION",
 * "PEACHTREE ST NE @ 10TH ST"). Shown as "North Springs Station" and
 * "Peachtree St NE @ 10th St". Names that already use mixed case are left alone.
 */
const KEEP_UPPER = new Set(["NE", "NW", "SE", "SW", "N", "S", "E", "W", "MARTA", "UGA", "GT", "SEC", "MLK", "II", "III", "US", "GA", "SR", "CDC", "VA", "ATL"]);
const SMALL = new Set(["to", "at", "of", "and", "the", "via", "on", "in", "for"]);

export function tidyStopName(name: string): string {
  if (name !== name.toUpperCase()) return name.trim();
  let first = true;
  return name
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((w) => {
      if (!w.trim() || w === "-" || w === "/") return w;
      const out = KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : /^\d+(st|nd|rd|th)$/.test(w) ? w : !first && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
      first = false;
      return out;
    })
    .join("")
    .trim();
}
