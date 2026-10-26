import { expect, test } from "@playwright/test";

/**
 * Uber handoff: plan a rideshare trip → review the Uber trip → continue in Uber
 * (or, on a site without NEXT_PUBLIC_UBER_CLIENT_ID, a disabled handoff that says why).
 */
const TRIP = "from=-84.37395,33.78103,place,,Piedmont%20Park&to=-84.36565,33.77262,place,,Ponce%20City%20Market&mode=rideshare";

test("rideshare trip hands its confirmed stops to Uber", async ({ page }) => {
  await page.goto(`/routes?${TRIP}`);
  await page.getByRole("button", { name: "Review Uber trip" }).click();

  const dialog = page.getByRole("dialog", { name: "Review your Uber trip" });
  await expect(dialog).toBeVisible();
  const summary = dialog.getByRole("region", { name: "Trip summary" });
  await expect(summary.getByText("Piedmont Park")).toBeVisible();
  await expect(summary.getByText("Ponce City Market")).toBeVisible();
  await expect(dialog.getByText(/latitude 33\.78103, longitude -84\.37395/)).toBeVisible();

  // Editing a label flows into the summary.
  await dialog.getByLabel("Name shown in Uber").first().fill("Piedmont Park, 12th St gate");
  await expect(summary.getByText("Piedmont Park, 12th St gate")).toBeVisible();

  const link = dialog.getByRole("link", { name: /Continue in Uber/ });
  if (await link.count()) {
    const url = new URL((await link.getAttribute("href"))!);
    expect(`${url.origin}${url.pathname}`).toBe("https://m.uber.com/looking");
    expect(JSON.parse(url.searchParams.get("pickup")!)).toEqual({ latitude: 33.78103, longitude: -84.37395, addressLine1: "Piedmont Park, 12th St gate" });
    expect(JSON.parse(url.searchParams.get("drop[0]")!)).toMatchObject({ latitude: 33.77262, longitude: -84.36565, addressLine1: "Ponce City Market" });
    expect(await link.getAttribute("target")).toBe("_blank");
  } else {
    await expect(dialog.getByRole("button", { name: "Continue in Uber" })).toBeDisabled();
    await expect(dialog.getByText("Uber handoff isn't set up yet")).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Review Uber trip" })).toBeFocused();
});

test("the dashboard's example trip is never sent to Uber", async ({ page }) => {
  await page.goto("/explore");
  await page.getByRole("button", { name: "Ride with Uber" }).click();
  const dialog = page.getByRole("dialog", { name: "Review your Uber trip" });
  await expect(dialog.getByText("This is an example trip")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Continue in Uber/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Go to trip planner" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("combobox", { name: "From" })).toBeFocused();
  expect(new URL(page.url()).searchParams.get("from")).toBeNull();
});
