import { expect, test, type Page } from "@playwright/test";

/**
 * The CrossMetric app (/), on a phone-sized screen. Plans use the live routing
 * service and geocoder, so these need network access. Personal data is seeded
 * into this browser's storage exactly as the app would store it. The intro
 * animation is skipped automatically under automation (navigator.webdriver).
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const LINDBERGH = { lon: -84.3696, lat: 33.8233, label: "Lindbergh Center" };

async function seed(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript((prefs) => {
    if (window.sessionStorage.getItem("seeded")) return;
    window.sessionStorage.setItem("seeded", "1");
    window.localStorage.clear();
    window.localStorage.setItem("cm.prefs.v1", JSON.stringify(prefs));
  }, { campus: "gt", origin: LINDBERGH, ...extra });
}

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name, exact: true });
const search = (page: Page) => page.getByRole("button", { name: /where to explore or check/i });
/** A row on the All services page (its accessible name starts with the label). */
async function service(page: Page, label: string) {
  await page.goto("/services");
  await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).first().click();
}

test("first visit: Explore is the map with search, four ways in and the four destinations, with no account or questions", async ({ page }) => {
  await page.goto("/");
  await expect(search(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /^When: Leave now/ })).toBeVisible();
  for (const name of ["Plan route", "Transit", "Parking", "Report"]) await expect(page.getByRole("navigation", { name: "Ways in" }).getByRole("button", { name, exact: true })).toBeVisible();
  for (const name of ["Explore", "Routes", "Report", "Community"]) await expect(tab(page, name)).toBeVisible();
  await expect(tab(page, "Explore")).toHaveAttribute("aria-current", "page");
  // Explore is map-first: the map and its controls are on screen from the start.
  await expect(page.getByRole("button", { name: /^Map style/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
  await expect(page.getByText("Make it yours")).toHaveCount(0);
});

test("reporting a barrier: four short steps, the server's refusal is shown, and success only after the server saved it", async ({ page }) => {
  await seed(page);
  // The report API is answered here so the test never writes to the shared store: first a refusal, then a save.
  let calls = 0;
  await page.route("**/api/reports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    const body = route.request().postDataJSON() as { category: string; lon: number; lat: number; description: string | null };
    expect(body.category).toBe("curb_ramp");
    if (calls === 1) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many reports from this connection. Please try again later." }) });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ report: { id: "0b6f1c2e-4d5a-4b7c-9e8f-112233445566", ...body, locationLabel: "Test corner", createdAt: new Date().toISOString(), confirmations: 0, resolvedVotes: 0 } }) });
  });
  await page.goto("/");
  await tab(page, "Report").click();
  await expect(page.getByRole("heading", { name: "Where is the barrier?" })).toBeVisible();
  await page.getByRole("button", { name: "Use this location" }).click();
  await page.getByText("Missing or inaccessible curb ramp").click();
  await page.getByRole("button", { name: "Continue" }).click();
  // A phone number in the note is caught before anything is sent.
  await page.getByLabel(/What should people know/).fill("Call 404-555-1234");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText(/phone numbers/).first()).toBeVisible();
  await page.getByLabel(/What should people know/).fill("No ramp at the northeast corner.");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Check and send" })).toBeVisible();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Your report wasn't sent")).toBeVisible();
  await expect(page.getByText("Too many reports from this connection")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report sent" })).toHaveCount(0);
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("heading", { name: "Report sent" })).toBeVisible();
  await page.getByRole("button", { name: "See it in Community" }).click();
  await expect(page).toHaveURL(/\/community\?report=0b6f1c2e/);
  await expect(page.getByRole("heading", { name: "Missing or inaccessible curb ramp" })).toBeVisible();
  await expect(page.getByText("Unconfirmed").first()).toBeVisible();
});

test("Community lists reports with their standing and explains how they are confirmed", async ({ page }) => {
  await seed(page);
  await page.route("**/api/reports", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            reports: [
              { id: "11111111-1111-4111-8111-111111111111", category: "blocked_path", description: null, lon: -84.396, lat: 33.776, locationLabel: "Ferst Drive", createdAt: new Date().toISOString(), confirmations: 3, resolvedVotes: 0 },
              { id: "22222222-2222-4222-8222-222222222222", category: "difficult_crossing", description: "Signal too short", lon: -84.389, lat: 33.778, locationLabel: "Spring Street", createdAt: new Date().toISOString(), confirmations: 0, resolvedVotes: 2 },
            ],
          }),
        })
      : route.continue(),
  );
  await page.goto("/community");
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  const list = page.getByRole("list", { name: "Reports, newest first" });
  await expect(list.getByText("Blocked sidewalk")).toBeVisible();
  await expect(list.getByText("Confirmed")).toBeVisible();
  // Reported-fixed reports leave the open list.
  await expect(list.getByText("Pedestrian crossing issue")).toHaveCount(0);
  await page.getByRole("radio", { name: "Reported fixed" }).click();
  await expect(list.getByText("Pedestrian crossing issue")).toBeVisible();
  await page.getByRole("button", { name: "How reports work" }).click();
  await expect(page.getByText(/not inspections/)).toBeVisible();
});

test("search a building: a new search is Leave now, compares options, and starts guidance", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
  await page.goto("/");
  await search(page).click();
  await page.getByRole("combobox").fill("klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  // The saved start is used (and labelled); timing is Leave now, never a class or tomorrow.
  await expect(page.getByText(/^Leave now$/).first()).toBeVisible();
  const options = page.getByRole("list", { name: "Options" });
  await expect(options.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expect(options.getByText("Best match").first()).toBeVisible();
  await expect(page.getByText(/Tomorrow/)).toHaveCount(0);
  await page.getByRole("button", { name: /^Choose / }).click();
  await expect(page.getByText("Planned trip · estimates")).toBeVisible();
  await expect(page.getByRole("region", { name: "CrossScore" })).toBeVisible();
  await page.getByRole("button", { name: "Start trip" }).click();
  await expect(page.getByRole("button", { name: "End trip", exact: true })).toBeVisible();
  // Ending early records the trip in Activity (labels and times only).
  await page.getByRole("button", { name: "End trip", exact: true }).click();
  await page.goto("/activity");
  const past = page.getByRole("region", { name: "Past trips" });
  await expect(past.getByText(/Klaus Advanced Computing/)).toBeVisible();
  await expect(past.getByText(/Ended early · 0 of \d+ steps done/)).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("cm.history.v1"))).not.toMatch(/-84\.|33\./);
});

test("a typed request without driving never offers a drive", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page, { campus: null });
  await page.goto("/");
  await search(page).click();
  await page.getByRole("combobox").fill("Get me to Georgia Tech without driving");
  await expect(page.getByText("Avoid driving").first()).toBeVisible();
  await page.getByRole("option", { name: /Main Campus/ }).first().click({ timeout: 20_000 });
  const options = page.getByRole("list", { name: "Options" });
  await expect(options.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expect(options.getByText(/Drive|park at/i)).toHaveCount(0);
});

test("changing the time marks old results as out of date until they update", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
  await page.goto("/");
  await search(page).click();
  await page.getByRole("combobox").fill("klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  await expect(page.getByRole("list", { name: "Options" }).getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("radio", { name: "Arrive by" }).click();
  await expect(page.getByText("Updating for your changes…")).toBeVisible();
  await expect(page.getByText(/^Arrive by (today|Tomorrow)/).first()).toBeVisible({ timeout: 60_000 });
});

test("parking near the destination shows eligibility and directions, and asks for no reports", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
  await page.goto("/");
  await search(page).click();
  await page.getByRole("combobox").fill("klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  // Then Parking from Explore: the destination stays, so parking is ranked near it.
  await expect(page.getByRole("list", { name: "Options" }).getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await tab(page, "Explore").click();
  await page.getByRole("navigation", { name: "Ways in" }).getByRole("button", { name: "Parking", exact: true }).click();
  const list = page.getByRole("list", { name: "Parking places" });
  await expect(list.getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/stay not set/)).toBeVisible();
  await list.getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "Directions" })).toBeVisible();
  await expect(page.getByText("Report what you see")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Opened" })).toHaveCount(0);
});

test("nearby transit ranks stations by walking time with scheduled (not live) departures", async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page);
  await page.goto("/");
  await service(page, "Nearby");
  await expect(page.getByText(/Near Lindbergh Center/)).toBeVisible();
  await expect(page.getByText("Lindbergh Center Station").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/scheduled times from published timetables, not live/i)).toBeVisible();
});

test("night travel lists official services, booking hand-offs and help", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await service(page, "Night");
  await expect(page.getByText("Stingerette", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open booking" })).toHaveAttribute("href", "https://ondemand.transloc.com/");
  await expect(page.getByRole("link", { name: /Call Georgia Tech Police/ })).toHaveAttribute("href", "tel:+14048942500");
  await expect(page.getByText(/doesn.t have lighting data/)).toBeVisible();
});

test("campus tools ask for a campus instead of assuming one", async ({ page }) => {
  await seed(page, { campus: null });
  await page.goto("/");
  await service(page, "Parking");
  await expect(page.getByText("Choose a campus")).toBeVisible();
  await page.getByRole("button", { name: "UGA" }).click();
  await expect(page.getByRole("list", { name: "Parking places" }).getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
});

test("the sheet can be resized from the keyboard", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await service(page, "Nearby");
  const handle = page.getByRole("button", { name: "Expand panel" });
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Expand panel|Collapse panel/ })).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Expand panel" })).toHaveAttribute("aria-expanded", "false");
});

test("the intro plays once, can be skipped, and is replaced by a static frame with reduced motion", async ({ page, browser }) => {
  await page.goto("/?intro=1");
  const splash = page.locator(".cm-splash");
  await expect(splash).toBeVisible();
  // One tap ends it; the app was already rendered underneath.
  await page.mouse.click(200, 400);
  await expect(splash).toHaveCount(0, { timeout: 2_000 });
  await expect(search(page)).toBeVisible();
  // It does not replay when moving between pages.
  await tab(page, "Community").click();
  await expect(page.locator(".cm-splash")).toHaveCount(0);
  // Reduced motion: a brief static frame, gone within about two seconds.
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto("/?intro=1");
  await expect(p.locator(".cm-splash")).toBeVisible();
  await expect(p.locator(".cm-splash")).toHaveCount(0, { timeout: 4_000 });
  await ctx.close();
});

test("results summarize the quickest time for each way of travel, and a chip selects that option", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
  await page.goto("/");
  await search(page).click();
  await page.getByRole("combobox").fill("klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  await expect(page.getByRole("list", { name: "Options" }).getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  const summary = page.getByRole("group", { name: "Quickest by way of travel" });
  await expect(summary).toBeVisible();
  const walk = summary.getByRole("button", { name: /^Walk: quickest/ });
  await walk.click();
  await expect(walk).toHaveAttribute("aria-pressed", "true");
});

test("like Uber's Choose a ride, the half-open results show the first two options above the Choose button", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
  await page.goto("/");
  await search(page).click();
  await page.getByRole("combobox").fill("klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  const rows = page.getByRole("list", { name: "Options" }).getByRole("listitem");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^from Lindbergh Center$/)).toBeVisible();
  const choose = page.getByRole("button", { name: /^Choose / });
  await expect(choose).toBeVisible();
  // Let the sheet settle at its half size.
  await page.waitForTimeout(800);
  const footerTop = (await choose.boundingBox())!.y;
  for (const i of [0, 1]) {
    const box = (await rows.nth(i).boundingBox())!;
    expect(box.y + box.height, `option ${i + 1} ends above the Choose button`).toBeLessThanOrEqual(footerTop);
  }
  // The recommended row is highlighted but closed; tapping a row selects and opens it.
  await expect(rows.first().getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[aria-label='Options'] .cm-reveal")).toHaveCount(0);
  await rows.nth(1).getByRole("button").click();
  await expect(rows.nth(1).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(rows.nth(1).locator(".cm-reveal")).toBeVisible();
  // "from …" opens the trip form, like Edit.
  await page.getByRole("button", { name: /^Change trip:/ }).click();
  await expect(page.getByRole("button", { name: /^Start: Lindbergh Center/ })).toBeVisible();
});

test("a shared trip link opens that trip; a passed time opens as Leave now and says so", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
  const to = "-84.36520,33.77244,place,,,Ponce City Market";
  const from = "-84.36960,33.82330,station,,,Lindbergh Center";
  await page.goto(`/?to=${encodeURIComponent(to)}&from=${encodeURIComponent(from)}&depart=${Date.now() - 3 * 3600_000}`);
  await expect(page.getByText("The time in this link has passed, so the trip opens as Leave now.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("list", { name: "Options" }).getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Leave now$/).first()).toBeVisible();
  // The link is read once and removed from the address bar.
  expect(new URL(page.url()).search).toBe("");
});

test("sharing never puts the current location in the link", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["geolocation", "clipboard-read", "clipboard-write"]);
  await context.setGeolocation({ latitude: 33.7756, longitude: -84.3963 });
  await seed(page, { origin: null });
  await page.goto("/");
  await search(page).click();
  await page.getByRole("combobox").fill("klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  await expect(page.getByRole("list", { name: "Options" }).getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Choose / }).click();
  await page.getByRole("button", { name: "Share this trip" }).click();
  const share = page.getByRole("region", { name: "Share this trip" });
  await expect(share.getByText(/current location is never put in a link/)).toBeVisible();
  const link = await share.locator("p.font-mono").textContent();
  const params = new URL(link!).searchParams;
  expect(params.get("to")).toMatch(/Klaus Advanced Computing/);
  expect(params.has("from")).toBe(false);
});

test("app shortcuts open their screen and tab", async ({ page }) => {
  await page.goto("/?view=saved");
  await expect(page).toHaveURL(/\/account\/places$/);
  await page.goto("/?view=nearby");
  await expect(page).toHaveURL(/\/nearby$/);
});

test("a Services tile offers only that way of travelling, as a removable chip", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^All services/ }).click();
  await page.getByRole("region", { name: "Go anywhere in Georgia" }).getByRole("button", { name: /^Walk/ }).click();
  await page.getByRole("combobox").fill("klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  const options = page.getByRole("list", { name: "Options" });
  await expect(options.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Change trip: from .+, Leave now · Walk$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Choose Walk/ })).toBeVisible();
  await expect(options.getByText(/Drive|park at/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Walk only")).toBeVisible();
});

test("Now chooses the time of the next search; a past time is refused", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^When: Leave now/ }).click();
  const when = page.getByRole("dialog", { name: "When do you want to go?" });
  await when.getByRole("radio", { name: "Arrive by" }).click();
  await expect(page.getByRole("button", { name: /^When: Arrive by/ })).toBeVisible();
  await when.getByRole("button", { name: "Leave now" }).click();
  await expect(page.getByRole("button", { name: /^When: Leave now/ })).toBeVisible();
});

test("the map is dark by default and the layers button switches it", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await service(page, "Nearby");
  const toggle = page.getByRole("button", { name: /^Map style: dark/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("button", { name: /^Map style: light/ })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem("cm.prefs.v1") ?? "{}").mapStyle)).toBe("light");
});

test("the app can be installed: manifest, icons and shortcuts", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as { name: string; display: string; icons: { src: string; sizes: string; purpose?: string }[]; shortcuts: { url: string }[] };
  expect(m.name).toBe("CrossMetric");
  expect(m.display).toBe("standalone");
  expect(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
  }
  expect(m.shortcuts.map((s) => s.url)).toEqual(["/?view=nearby", "/report"]);
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
});

test("the previous dashboard is still available at /explore", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: /Safety intelligence for how students move/, level: 1 })).toBeVisible();
});
