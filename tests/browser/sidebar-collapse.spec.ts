import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const KEY = "meeting-memo:sidebar-collapsed";

test.use({ serviceWorkers: "block" });

const sidebarWidth = (page: import("@playwright/test").Page) =>
  page.locator("aside.sidebar").evaluate((el) => el.getBoundingClientRect().width);
const noHorizontalOverflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("desktop toggle collapses to an icon rail, expands again and is accessible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  const toggle = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-controls", "app-sidebar");
  expect(await sidebarWidth(page)).toBeGreaterThan(200);

  await toggle.click();
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => sidebarWidth(page)).toBeLessThan(100);
  expect(await noHorizontalOverflow(page)).toBe(true);
  // Labels stay in the accessibility tree while the sidebar is an icon rail.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Your meetings" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Needs review" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);

  await expand.click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => sidebarWidth(page)).toBeGreaterThan(200);
});

test("choice persists after reload and storage failure does not break the toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("1");
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  expect(await sidebarWidth(page)).toBeLessThan(100);

  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});

test("tablet width starts as a rail without storing a preference", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1024 });
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  expect(await sidebarWidth(page)).toBeLessThan(100);
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test("mobile keeps its drawer and hides the desktop toggle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator(".sidebar-toggle")).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("aside.sidebar")).toHaveClass(/open/);
  expect(await sidebarWidth(page)).toBeGreaterThan(200);
  expect(await noHorizontalOverflow(page)).toBe(true);
});
