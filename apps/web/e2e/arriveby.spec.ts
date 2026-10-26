import { expect, test, type Page } from "@playwright/test";

/**
 * ArriveBy (/arrive), in the real app with the live routing service and geocoder,
 * so these need network access. Preferences are seeded the way the app stores them.
 */

const LINDBERGH = { lon: -84.3696, lat: 33.8233, label: "Lindbergh Center" };

async function seed(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript((prefs) => {
    if (window.sessionStorage.getItem("seeded")) return;
    window.sessionStorage.setItem("seeded", "1");
    window.localStorage.clear();
    window.localStorage.setItem("cm.prefs.v1", JSON.stringify(prefs));
  }, { campus: "gt", origin: LINDBERGH, permits: ["W23"], ...extra });
}

async function planKlaus(page: Page) {
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await page.getByRole("combobox").fill("Klaus");
  await page.getByRole("option", { name: /Klaus Advanced Computing/ }).first().click();
  await expect(page).toHaveURL(/\/arrive$/);
  await page.getByRole("button", { name: "Tomorrow 9:00 AM" }).click();
  await expect(page.getByRole("heading", { name: /Leave by \d{1,2}:\d{2} [AP]M/ })).toBeVisible({ timeout: 45_000 });
}

for (const [label, viewport] of [
  ["phone", { width: 390, height: 844 }],
  ["desktop", { width: 1440, height: 900 }],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch: label === "phone" });

    test("from Services: a building and a time give one plan with its parts, permit-aware parking and a backup", async ({ page }) => {
      await seed(page);
      await page.goto("/services");
      await page.getByRole("button", { name: /^Arrive by/ }).click();
      await expect(page).toHaveURL(/\/arrive$/);
      await planKlaus(page);

      // Driving: the parts add up to the plan, parking uses the permit, and nothing claims a space is free.
      await page.getByRole("radio", { name: "Drive" }).click();
      const card = page.getByRole("region", { name: "Your plan" });
      await expect(card.getByRole("term").filter({ hasText: "Drive" })).toBeVisible();
      await expect(card.getByRole("term").filter({ hasText: "Find a space" })).toBeVisible();
      await expect(card.getByRole("term").filter({ hasText: "Walk to the entrance" })).toBeVisible();
      await expect(card).toContainText("Your permit (W23)");
      await expect(card).toContainText("Availability not verified");
      await expect(page.getByRole("region", { name: "Backup plan" })).toContainText(/Availability has not been verified/);

      // Every checked place is listed with its rule source and the date it was checked.
      await page.getByRole("button", { name: "Done" }).click();
      const parking = page.getByRole("region", { name: "Parking near the building" });
      await parking.getByRole("button", { name: /Student Center Deck/ }).click();
      await expect(parking).toContainText(/Official · GT Parking & Transportation — Visitor parking · checked Oct 12, 2026/);

      // The backup can become the plan, and the plan can be started.
      const backup = page.getByRole("region", { name: "Backup plan" });
      const name = (await backup.locator("p").nth(1).textContent())!.trim();
      await backup.getByRole("button", { name: /^Use / }).click();
      await expect(card).toContainText(name);
      await page.getByRole("button", { name: /^Start trip · leave by/ }).click();
      await expect(page).toHaveURL(/\/trip\/live$/);
    });
  });
}

test.describe("checks", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("an arrival time that has passed is refused, not moved to tomorrow", async ({ page }) => {
    await seed(page);
    await page.goto("/arrive");
    await page.getByLabel("Arrival time", { exact: true }).fill("00:01");
    await expect(page.getByText("That arrival time has passed. Choose a later time.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Leave by/ })).toHaveCount(0);
  });

  test("Explore offers ArriveBy without asking for anything first", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.getByRole("button", { name: /^Arrive by a set time/ }).click();
    await expect(page).toHaveURL(/\/arrive$/);
    await expect(page.getByRole("heading", { name: "Arrive by", exact: true })).toBeVisible();
  });
});
