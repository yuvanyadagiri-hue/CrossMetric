// Takes a screenshot of every screen and phase of the app at phone, tablet and desktop sizes and builds
// one page to browse them: test-results/gallery/index.html (git-ignored).
//
//   npm run gallery -w @crossmetric/web
//
// Needs the app running (`npm run dev`, port 3000) and network access: trips use the live routing
// service and the analysis pages need their data. Personal data is seeded into each browser's
// storage the way the app stores it; the splash is forced on with `?intro=1` (it is off under automation).
//
// Environment:
//   BASE=http://localhost:3100   where the app is running (default http://localhost:3000)
//   VIEWPORTS=phone,desktop      only these sizes (phone, tablet, desktop; default all)
//   STEPS=trip,other             only these parts, replacing just their screens in an existing gallery
//                                (launch, tabs, light, car, trip, other, workspace; default all)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { buildGallery, GALLERY_DIR } from "./build-gallery.mjs";

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = GALLERY_DIR;
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, hasTouch: true, isMobile: false },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
};
const VIEWPORTS = (process.env.VIEWPORTS ?? "phone,tablet,desktop").split(",").map((s) => s.trim()).filter((s) => s in SIZES);
const STEPS = (process.env.STEPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (name) => STEPS.length === 0 || STEPS.includes(name);
/** The gallery sections each step produces, so a partial run replaces only its own screens. */
const GROUPS_OF = {
  launch: ["01-launch"],
  tabs: ["02-tabs", "03-account", "04-tools"],
  light: ["05-light"],
  car: ["06-car"],
  trip: ["07-trip"],
  other: ["08-other"],
  workspace: ["09-analysis"],
};
const LINDBERGH = { lon: -84.3696, lat: 33.8233, label: "Lindbergh Center" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifestFile = path.join(OUT, "manifest.json");
let manifest = [];

async function newPage(browser, vp, { prefs = {}, extra = {}, seedWelcome = true } = {}) {
  const ctx = await browser.newContext({ ...SIZES[vp], locale: "en-US", timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ prefs, extra, seedWelcome }) => {
      if (window.sessionStorage.getItem("seeded")) return;
      window.sessionStorage.setItem("seeded", "1");
      window.localStorage.clear();
      if (seedWelcome) window.localStorage.setItem("cm.welcome.v1", "done");
      window.localStorage.setItem("cm.prefs.v1", JSON.stringify(prefs));
      for (const [k, v] of Object.entries(extra)) window.localStorage.setItem(k, JSON.stringify(v));
    },
    { prefs: { campus: "gt", origin: LINDBERGH, ...prefs }, extra, seedWelcome },
  );
  page.on("pageerror", (e) => console.log(`  pageerror (${vp}):`, String(e).slice(0, 160)));
  return { ctx, page };
}

async function shot(page, vp, group, id, title, note = "") {
  const dir = path.join(OUT, vp);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${group}-${id}.jpg`;
  try {
    await page.screenshot({ path: path.join(dir, file), type: "jpeg", quality: 74 });
    manifest.push({ vp, group, id, title, note, file: `${vp}/${file}`, ok: true });
    console.log(`  ok   ${vp}/${file}`);
  } catch (e) {
    manifest.push({ vp, group, id, title, note: String(e).slice(0, 120), ok: false });
    console.log(`  FAIL ${vp}/${file}`, String(e).slice(0, 100));
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
}

async function visit(page, url, wait = 1600) {
  await page.goto(BASE + url, { waitUntil: "load", timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await sleep(wait);
}

/** One part of the capture: a failure is reported and the rest carries on. */
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`  step "${name}" failed:`, String(e).slice(0, 200));
  }
}

/** Starts a trip from Explore: search "klaus", pick the building, wait for options. Returns the options list. */
async function searchKlaus(page, { shots = null } = {}) {
  await visit(page, "/");
  await page.getByRole("button", { name: /where to explore or check/i }).click();
  await sleep(900);
  await shots?.("search-open", "Search · empty");
  await page.getByRole("combobox").fill("klaus");
  await sleep(1800);
  await shots?.("search-results", "Search · results for “klaus”");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  const options = page.getByRole("list", { name: "Options" });
  await sleep(700);
  await shots?.("plan-loading", "Trip options · finding routes");
  await options.getByRole("listitem").first().waitFor({ timeout: 90_000 });
  await sleep(2200);
  return options;
}

/** Walks a started trip to its end, whatever each step asks for, capturing the first steps and the arrival. */
async function guide(page, vp, group) {
  await shot(page, vp, group, "live-1", "Trip in progress · step 1");
  const advance = page.getByRole("button", { name: /^(I.m here|Save car here|I got off|Next step|I.ve arrived)$/ });
  for (let n = 2, guard = 0; guard < 14; guard++) {
    if (page.url().includes("/trip/arrived")) break;
    const stopTimes = page.getByRole("button", { name: "Stop times" });
    if ((await stopTimes.count()) && !manifest.some((m) => m.vp === vp && m.group === group && m.id === "stop")) {
      await step("stop", async () => {
        await stopTimes.first().click();
        await sleep(3000);
        await shot(page, vp, group, "stop", "One stop’s times");
        await page.getByRole("button", { name: "Back" }).first().click();
        await sleep(1200);
      });
    }
    const btn = advance.first();
    if (!(await btn.count())) {
      await sleep(800);
      if (!(await btn.count())) break;
    }
    const label = (await btn.innerText()).trim();
    await btn.click();
    await sleep(1800);
    if (page.url().includes("/trip/arrived")) break;
    if (n <= 4) await shot(page, vp, group, `live-${n}`, `Trip in progress · step ${n}`, label === "Save car here" ? "The parking step saved where the car is" : "");
    n++;
  }
  await sleep(1500);
  await shot(page, vp, group, "arrived", "You’ve arrived");
}

const PAGES = [
  ["/", "home", "Explore", "02-tabs"],
  ["/trip", "routes", "Routes · plan a route", "02-tabs"],
  ["/report", "report", "Report a barrier", "02-tabs"],
  ["/community", "community", "Community", "02-tabs"],
  ["/services", "services", "All services", "03-account"],
  ["/activity", "activity-empty", "Your trips · none yet", "03-account"],
  ["/account", "account", "Account", "03-account"],
  ["/account/places", "places", "Saved places", "03-account"],
  ["/account/settings", "settings", "Preferences", "03-account"],
  ["/account/classes", "classes", "Classes", "03-account"],
  ["/help", "help", "Help", "03-account"],
  ["/safety", "safety", "Safety toolkit", "03-account"],
  ["/search", "search", "Where to? (search page)", "04-tools"],
  ["/night", "night", "Night travel", "04-tools"],
];

const WORKSPACE = [
  ["/explore", "explore", "Explore · scored routes", 9000],
  ["/analyze", "analyze", "Analyze · find a school", 4000],
  ["/analyze/130228002560", "analyze-school", "Analyze · Northview High School", 9000],
  ["/schools", "schools", "Schools", 4000],
  ["/schools/130228002560", "school", "School profile", 5000],
  ["/schools/compare?ids=130228002560,139755", "compare", "Compare schools", 5000],
  ["/methodology", "methodology", "Methodology", 3000],
  ["/map", "map", "Map", 6000],
  ["/routes", "routes", "Routes", 4000],
  ["/reports", "reports", "Reports", 3000],
  ["/saved", "saved", "Saved", 3000],
];

async function captureSize(browser, vp) {
  console.log(`\n== ${vp} ==`);

  // Launch: the splash at five moments, then the welcome slides (the tablet repeats the phone, so it skips them).
  if (vp !== "tablet" && want("launch")) {
    await step("splash", async () => {
      const { ctx, page } = await newPage(browser, vp);
      const t0 = Date.now();
      await page.goto(BASE + "/?intro=1", { waitUntil: "commit" });
      for (const [ms, id, label] of [
        [350, "1", "Green field, before the lines draw"],
        [1100, "2", "Three lines meet at a station"],
        [1900, "3", "The station becomes the mark"],
        [2600, "4", "Wordmark and tagline"],
        [3050, "5", "Held, just before it rises into Home"],
      ]) {
        const wait = ms - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        await shot(page, vp, "01-launch", `splash-${id}`, `Splash · ${label}`, `about ${ms} ms after launch`);
      }
      await ctx.close();
    });
    await step("welcome", async () => {
      const { ctx, page } = await newPage(browser, vp, { seedWelcome: false });
      await visit(page, "/welcome", 1200);
      const tabs = page.locator('[role="tab"][aria-label^="Slide"]');
      const n = await tabs.count();
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          await tabs.nth(i).click();
          await sleep(900);
        }
        await shot(page, vp, "01-launch", `welcome-${i + 1}`, `Welcome · slide ${i + 1} of ${n}`);
      }
      await visit(page, "/welcome/location", 1000);
      await shot(page, vp, "01-launch", "location", "Location primer", "Optional: allowing location is never required");
      await ctx.close();
    });
  }

  // The four tabs, the account pages and the tools (nothing planned yet).
  if (want("tabs")) {
    const { ctx, page } = await newPage(browser, vp);
    for (const [url, id, title, group] of PAGES) {
      await step(id, async () => {
        await visit(page, url);
        await shot(page, vp, group, id, title);
      });
    }
    // The map-first tools wait longer for tiles.
    await step("nearby", async () => {
      await visit(page, "/nearby", 5000);
      await shot(page, vp, "04-tools", "nearby", "Transit near you");
      const first = page.getByRole("list").getByRole("button").first();
      if (await first.count()) {
        await first.click({ timeout: 4000 }).catch(() => {});
        await sleep(2500);
        await shot(page, vp, "04-tools", "nearby-station", "Transit near you · a station selected");
      }
    });
    await step("parking", async () => {
      await visit(page, "/parking", 5000);
      await shot(page, vp, "04-tools", "parking", "Campus parking");
    });
    await ctx.close();
  }

  if (want("light")) {
    await step("light", async () => {
      const { ctx, page } = await newPage(browser, vp, { prefs: { appearance: "light", mapStyle: "light" } });
      await visit(page, "/");
      await shot(page, vp, "05-light", "home", "Home · light appearance");
      await visit(page, "/account/settings");
      await shot(page, vp, "05-light", "settings", "Preferences · light appearance");
      await ctx.close();
    });
  }

  if (want("car")) {
    await step("car", async () => {
      const parked = { campus: "gt", placeId: "demo", label: "Student Center Deck", lon: -84.3989, lat: 33.7743, savedAt: Date.now() - 3 * 3600_000, until: null };
      const { ctx, page } = await newPage(browser, vp, { extra: { "cm.parked.v1": parked } });
      await visit(page, "/car", 5000);
      await shot(page, vp, "06-car", "parked", "Your parked car");
      await visit(page, "/car/return", 5000);
      await shot(page, vp, "06-car", "return", "Getting back to your car");
      await visit(page, "/");
      await shot(page, vp, "06-car", "home", "Home · with a parked car");
      await ctx.close();
    });
  }

  // A whole trip with the option ranked first: search, options, details, guidance, arrival, Activity, receipt.
  if (want("trip")) {
    await step("trip", async () => {
      const { ctx, page } = await newPage(browser, vp);
      await searchKlaus(page, { shots: (id, title) => shot(page, vp, "07-trip", id, title) });
      await shot(page, vp, "07-trip", "plan-half", "Trip options · sheet half open");
      await step("expand", async () => {
        const handle = page.getByRole("button", { name: "Expand panel" });
        if (await handle.count()) {
          await handle.click();
          await sleep(900);
          await shot(page, vp, "07-trip", "plan-full", "Trip options · sheet fully open");
        }
      });
      await step("edit", async () => {
        const edit = page.getByRole("button", { name: "Edit" });
        if (await edit.count()) {
          await edit.first().click();
          await sleep(900);
          await shot(page, vp, "07-trip", "plan-edit", "Trip options · changing the time and start");
          await page.keyboard.press("Escape");
          await sleep(400);
        }
      });
      await page.getByRole("button", { name: /^Choose / }).first().click();
      await sleep(2500);
      await shot(page, vp, "07-trip", "details", "One option in full");
      await step("details-scroll", async () => {
        await page.mouse.wheel(0, 700);
        await sleep(700);
        await shot(page, vp, "07-trip", "details-2", "One option in full · scrolled");
      });
      await page.getByRole("button", { name: "Start trip" }).click();
      await sleep(2500);
      await guide(page, vp, "07-trip");
      await visit(page, "/activity");
      await shot(page, vp, "07-trip", "activity", "Activity · the finished trip");
      await step("receipt", async () => {
        const past = page.getByRole("region", { name: "Past trips" });
        await past.getByRole("link").first().click({ timeout: 5000 }).catch(() => past.getByRole("button").first().click());
        await sleep(1500);
        await shot(page, vp, "07-trip", "receipt", "Trip receipt");
      });
      await ctx.close();
    });
  }

  // The same trip with the other kind of option: driving if the first-ranked option was not, otherwise not driving.
  // Their guidance steps differ (drive, park and save the car, walk, against board, ride, get off).
  if (want("other")) {
    await step("other", async () => {
      const { ctx, page } = await newPage(browser, vp);
      const options = await searchKlaus(page);
      const firstDrives = /Drive/i.test(await options.getByRole("listitem").first().innerText());
      const pick = options.getByRole("listitem").filter(firstDrives ? { hasNotText: /Drive/i } : { hasText: /Drive/i }).first();
      if (!(await pick.count())) throw new Error("no option of the other kind offered");
      const kind = firstDrives ? "a non-driving option" : "a drive-and-park option";
      await pick.getByRole("button").first().click();
      await sleep(1800);
      await shot(page, vp, "08-other", "plan", `Trip options · ${kind} selected`);
      await page.getByRole("button", { name: /^Choose / }).first().click();
      await sleep(2500);
      await shot(page, vp, "08-other", "details", "That option in full");
      await page.getByRole("button", { name: "Start trip" }).click();
      await sleep(2500);
      await guide(page, vp, "08-other");
      await ctx.close();
    });
  }

  if (want("workspace")) {
    console.log(`  (analysis workspace)`);
    const { ctx, page } = await newPage(browser, vp);
    for (const [url, id, title, wait] of WORKSPACE) {
      await step(id, async () => {
        await visit(page, url, wait);
        await shot(page, vp, "09-analysis", id, title);
      });
    }
    await ctx.close();
  }
}

// ---- main ----
try {
  await fetch(BASE, { signal: AbortSignal.timeout(15_000) });
} catch {
  console.error(`Nothing is answering at ${BASE}. Start the app (npm run dev) or set BASE=http://localhost:<port>.`);
  process.exit(1);
}

const full = STEPS.length === 0 && VIEWPORTS.length === Object.keys(SIZES).length;
if (full) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
if (!full && fs.existsSync(manifestFile)) {
  // A partial run keeps everything else and replaces only the screens it is about to retake.
  const groups = new Set((STEPS.length ? STEPS : Object.keys(GROUPS_OF)).flatMap((s) => GROUPS_OF[s] ?? []));
  manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")).filter((m) => !(VIEWPORTS.includes(m.vp) && groups.has(m.group)));
}

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
await Promise.all(VIEWPORTS.map((vp) => captureSize(browser, vp)));
await browser.close();

const failed = manifest.filter((m) => !m.ok).length;
const built = buildGallery();
console.log(`\n${manifest.filter((m) => m.ok).length} screens captured, ${failed} failed.`);
console.log(`Gallery: ${built.file} (${built.megabytes.toFixed(1)} MB, images embedded)`);
console.log(`Linked:  ${built.linked} (small; serve the folder over http)`);
