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

test("recent meetings show their status and short sidebars keep actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto("./");
  const sidebar = page.locator("aside.sidebar");
  const help = sidebar.getByRole("button", { name: "How it works" });
  const icon = await help.locator("svg").boundingBox();
  const label = await help.locator(".nav-text").boundingBox();
  expect(icon!.x).toBeLessThan(label!.x);
  await help.click();
  await page.getByRole("button", { name: "Explore a synthetic example" }).click();
  const recent = sidebar.locator(".sidebar-recent-list a").first();
  await expect(recent).toHaveAttribute("aria-current", "page");
  await expect(recent.locator(".sidebar-recent-status")).not.toBeEmpty();
  const titleBox = await recent.locator(".sidebar-recent-title").boundingBox();
  const statusBox = await recent.locator(".sidebar-recent-status").boundingBox();
  expect(statusBox!.y).toBeGreaterThan(titleBox!.y);
  await sidebar.getByRole("button", { name: "Check for updates" }).scrollIntoViewIfNeeded();
  await expect(sidebar.getByRole("button", { name: "Check for updates" })).toBeInViewport();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("collapsed navigation tooltip follows pointer and supports keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const target = page.getByRole("button", { name: "Needs review" });
  const box = await target.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 12, box!.y + 12);
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText("Needs review");
  const before = await tooltip.boundingBox();
  await page.mouse.move(box!.x + 20, box!.y + 20);
  await expect.poll(async () => (await tooltip.boundingBox())?.x).toBeGreaterThan(before!.x);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await target.focus();
  await expect(tooltip).toHaveText("Needs review");
});
