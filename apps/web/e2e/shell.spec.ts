import { expect, test } from "@playwright/test";

const heading = { name: "Input Secretary", level: 1 };

test("the shell renders and its Lit component upgrades", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", heading)).toBeVisible();
  await expect(page.locator("app-status").getByRole("status")).toHaveText("Ready");
});
