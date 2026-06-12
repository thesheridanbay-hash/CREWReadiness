import { expect, test } from "@playwright/test";

/**
 * Smoke spec (T5): the app boots and unauthenticated visitors land on
 * sign-in. The 9 employee/owner flow specs from PLAN §7 build on this file
 * as P1/P2 UI lands.
 */

test("unauthenticated visitors are redirected to sign-in", async ({ page }) => {
  await page.goto("/learn");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("sign-in renders both audience tabs", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Crew member" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Owner / Manager" })
  ).toBeVisible();
});
