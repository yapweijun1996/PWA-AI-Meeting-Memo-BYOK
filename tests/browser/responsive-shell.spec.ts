import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block" });

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`empty dashboard has no overflow and no axe violations at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("./");
    await expect(page.getByRole("heading", { name: /Your meetings/ })).toBeVisible();
    await expect(page.getByText("Opening local library…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create your first meeting" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
}
