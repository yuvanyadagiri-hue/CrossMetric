import { expect, test } from "@playwright/test";

/**
 * The Analyze layer (Priority for Review), end to end:
 * search school → select → view analysis → select road → inspect evidence →
 * switch scenario → compare candidates → Resource Planner → Methodology.
 */
test("full CrossMetric analysis flow", async ({ page }) => {
  await page.goto("/analyze");
  await expect(page.getByRole("heading", { name: "Where should transportation safety be improved?", level: 1 })).toBeVisible();

  // 1-2. Search for and select a real Georgia school
  const search = page.getByRole("combobox", { name: /search for a georgia public school/i });
  await search.fill("Northview High");
  await expect(page.getByRole("option", { name: /Northview High School/ })).toBeVisible();
  await search.press("Enter");
  await page.waitForURL(/\/analyze\/130228002560/);

  // 3-4. The analysis focuses on the school and ranks nearby candidates
  await expect(page.getByRole("heading", { name: "Northview High School", level: 1 })).toBeVisible();
  const summary = page.getByText(/candidate locations analyzed within 800 m of Northview High School/);
  await expect(summary).toBeVisible();
  const list = page.getByRole("list", { name: /Candidate locations ranked by Priority for Review/ });
  const firstRow = list.getByRole("listitem").first();
  await expect(firstRow).toBeVisible();

  // radius control changes the population
  const before = await summary.textContent();
  await page.getByLabel("Analysis radius", { exact: true }).selectOption("1200");
  await expect(page.getByText(/analyzed within 1,200 m of Northview High School/)).toBeVisible();
  expect(await page.getByText(/candidate locations analyzed within/).textContent()).not.toBe(before);
  await page.getByLabel("Analysis radius", { exact: true }).selectOption("800");

  // 5-6. Select the top location and inspect why it ranks highly
  await firstRow.locator("button[data-row]").click();
  const panel = page.getByRole("complementary", { name: "Location evidence" });
  await expect(panel.getByText(/Ranked #1 of \d+ under the Standard \(Balanced\) scenario/)).toBeVisible();
  await expect(panel.getByText("Score breakdown")).toBeVisible();
  await panel.getByRole("tab", { name: "Evidence" }).click();
  await expect(panel.getByText(/percentile/).first()).toBeVisible();
  await panel.getByRole("tab", { name: "Data" }).click();
  await expect(panel.getByText(/GeoPI Crashes \(GEARS\)/)).toBeVisible();

  // 7. Change the scoring scenario: the ranking responds
  const priorityBefore = await panel.getByLabel(/Priority \d+ out of 100/).getAttribute("aria-label");
  await page.getByLabel("Scoring scenario", { exact: true }).selectOption("pedestrian");
  await expect(page).toHaveURL(/scenario=pedestrian/);
  await expect(panel.getByText(/under the Pedestrian emphasis scenario/)).toBeVisible();
  const priorityAfter = await panel.getByLabel(/Priority \d+ out of 100/).getAttribute("aria-label");
  expect(priorityAfter).not.toBe(priorityBefore);
  await panel.getByRole("tab", { name: "Sensitivity" }).click();
  await expect(panel.getByText(/stability/i).first()).toBeVisible();

  // 8. Compare two candidates
  await list.getByRole("checkbox").nth(0).check();
  await list.getByRole("checkbox").nth(1).check();
  await page.getByRole("tab", { name: /Compare/ }).click();
  const compare = page.getByRole("complementary", { name: "Comparison" });
  await expect(compare.getByText(/Comparing 2 selected locations/)).toBeVisible();
  await expect(compare.getByRole("rowheader", { name: "Pedestrian Evidence" })).toBeVisible();
  await compare.getByRole("button", { name: "Close" }).click();

  // 9. Resource Planner: 5 reviews available
  await page.getByRole("tab", { name: "Resource Planner" }).click();
  await page.getByLabel("Review capacity", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Get recommendations" }).click();
  await expect(page.getByText(/Planning for 5 professional reviews around Northview High School/)).toBeVisible();
  await expect(page).toHaveURL(/capacity=5/);

  // shared link recreates the analysis
  const url = page.url();
  await page.goto(url);
  await expect(page.getByLabel("Scoring scenario", { exact: true })).toHaveValue("pedestrian");

  // 10. Methodology and data sources
  await page.getByRole("link", { name: "Methodology" }).first().click();
  await expect(page.getByRole("heading", { name: "How CrossMetric works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validation" })).toBeVisible();
  await expect(page.getByText(/Agreement with an independent High Injury Network/)).toBeVisible();
});

test("unknown school shows a helpful not-found page", async ({ page }) => {
  await page.goto("/analyze/999999999999");
  await expect(page.getByText(/couldn’t find that school/)).toBeVisible();
});

test("v1 analysis links redirect to Analyze with their settings", async ({ page }) => {
  await page.goto("/school/130228002560?radius=1200&scenario=pedestrian");
  await page.waitForURL(/\/analyze\/130228002560\?radius=1200&scenario=pedestrian/);
  await expect(page.getByLabel("Scoring scenario", { exact: true })).toHaveValue("pedestrian");
});

test("institution profile and comparison", async ({ page }) => {
  await page.goto("/schools/130228002560");
  await expect(page.getByRole("heading", { name: "Northview High School", level: 1 })).toBeVisible();
  await expect(page.getByText("Nearby safety")).toBeVisible();
  await page.goto("/schools/compare?ids=130228002560,139755");
  await expect(page.getByRole("rowheader", { name: "Pedestrian-involved" })).toBeVisible();
});

/**
 * Move layer: plan a trip and get scored routes. Uses the live routing
 * service, so it needs network access.
 */
test("Explore dashboard plans and scores a trip", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: /Safety intelligence for how students move/, level: 1 })).toBeVisible();
  // The example trip is scored live on load.
  await expect(page.getByRole("img", { name: /^CrossScore \d+ out of 100/ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Best ways to get there" })).toBeVisible();
  await expect(page.getByText("Crash history").first()).toBeVisible();
  // Switch to biking: routes are recalculated.
  await page.getByRole("radio", { name: "Bike" }).click();
  await page.getByRole("button", { name: "Find safer routes" }).click();
  await expect(page).toHaveURL(/mode=bike/);
  await expect(page.getByText(/Protected path availability/).first()).toBeVisible({ timeout: 60_000 });
});
