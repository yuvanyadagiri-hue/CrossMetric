// Renders the installable-app icons from the CrossMetric mark (components/brand/Logo.tsx)
// with the locally installed Chrome. Run after changing the mark:
//   node apps/web/scripts/make-app-icons.mjs
// Writes public/icons/icon-{192,512}.png (rounded, for "any"), public/icons/maskable-512.png
// (full bleed, mark inside the 80% safe zone) and src/app/apple-icon.png (180, full bleed).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAVY = "#07111F"; // the tile: the installed app's launch screen is navy too
const LIME = "#91F24D";
const BLUE = "#42A5FF";

// The mark's geometry (same as MARK in Logo.tsx), in a 64-unit box: two crossing paths and a node.
const mark = () => `
  <g fill="none" stroke-linecap="round">
    <path d="M 15 15 L 49 49" stroke="${BLUE}" stroke-width="9"/>
    <path d="M 15 49 L 49 15" stroke="${LIME}" stroke-width="9"/>
    <circle cx="32" cy="32" r="6.5" fill="${NAVY}" stroke="${LIME}" stroke-width="3"/>
  </g>`;

/** scale: share of the canvas the 64-unit mark box fills; rounded: corner radius share (0 = square). */
function svg(size, { scale, rounded }) {
  const r = rounded * size;
  const box = size * scale;
  const off = (size - box) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="${NAVY}"/>
    <g transform="translate(${off} ${off}) scale(${box / 64})">${mark()}</g>
  </svg>`;
}

const targets = [
  { file: "public/icons/icon-192.png", size: 192, scale: 0.7, rounded: 0.24 },
  { file: "public/icons/icon-512.png", size: 512, scale: 0.7, rounded: 0.24 },
  { file: "public/icons/maskable-512.png", size: 512, scale: 0.56, rounded: 0 },
  { file: "src/app/apple-icon.png", size: 180, scale: 0.64, rounded: 0 },
];

await mkdir(path.join(web, "public/icons"), { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t.size, t)}</body></html>`);
  await page.locator("svg").screenshot({ path: path.join(web, t.file), omitBackground: true });
  console.log("wrote", t.file);
}
await browser.close();
