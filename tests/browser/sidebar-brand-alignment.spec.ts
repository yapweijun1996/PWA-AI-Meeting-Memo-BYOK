import { expect, test, type Page } from "@playwright/test";
import preferences from "../../src/appearance-preferences.json" with { type: "json" };

test.use({ locale: "en-US", reducedMotion: "reduce", serviceWorkers: "block" });

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
];
const fontSizes = ["small", "normal", "large", "xlarge", "xxlarge"];

async function expectDesktopAlignment(page: Page) {
  const brand = page.getByRole("link", { name: "Meeting Memo home", exact: true });
  const toggle = page.locator(".sidebar-toggle");
  await expect(brand).toBeVisible();
  for (const expanded of [true, false]) {
    await test.step(expanded ? "expanded sidebar" : "collapsed rail", async () => {
      if (!expanded) await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", String(expanded));
      const layout = await page.evaluate(() => {
        const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const centerY = (rect: DOMRect) => rect.top + rect.height / 2;
        const mark = bounds(".sidebar .brand-mark");
        const brand = bounds(".sidebar .brand-link");
        const topbar = bounds(".topbar");
        const nav = bounds(".sidebar nav");
        const navLabel = bounds(".sidebar > .nav-label");
        const navStart = navLabel.height > 0 ? navLabel.top : nav.top;
        return {
          rowDelta: Math.abs(centerY(mark) - centerY(bounds(".topbar .breadcrumb"))),
          toggleDelta: Math.abs(centerY(mark) - centerY(bounds(".sidebar-toggle"))),
          targetWidth: brand.width,
          targetHeight: brand.height,
          topbarClearance: topbar.left - brand.right,
          navClearance: navStart - brand.bottom,
          navStart,
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(layout.rowDelta).toBeLessThanOrEqual(1);
      expect(layout.toggleDelta).toBeLessThanOrEqual(1);
      expect(layout.targetWidth).toBeGreaterThanOrEqual(44);
      expect(layout.targetHeight).toBeGreaterThanOrEqual(44);
      expect(layout.topbarClearance).toBeGreaterThanOrEqual(0);
      expect(layout.navClearance).toBeGreaterThanOrEqual(0);
      expect(layout.navStart).toBeCloseTo(107, 0);
      expect(layout.horizontalOverflow).toBeLessThanOrEqual(0);
    });
  }
}

for (const viewport of viewports) {
  for (const theme of preferences.theme.values) {
    for (const fontSize of fontSizes) {
      test(`aligns the sidebar brand with the topbar at ${viewport.width}x${viewport.height}, ${theme}, ${fontSize}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript(({ themeKey, theme, fontSize }) => {
          localStorage.setItem(themeKey, theme);
          localStorage.setItem("meeting-memo:font-size", fontSize);
          localStorage.setItem("meeting-memo:sidebar-collapsed", "0");
        }, { themeKey: preferences.theme.key, theme, fontSize });
        await page.goto("./");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("html")).toHaveAttribute("data-font-size", fontSize);

        await expectDesktopAlignment(page);
      });
    }
  }
}

test("aligns the brand with the wrapped tablet topbar and an install action", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.addInitScript(() => {
    localStorage.setItem("meeting-memo:font-size", "xxlarge");
    localStorage.setItem("meeting-memo:sidebar-collapsed", "0");
  });
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("data-font-size", "xxlarge");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
  await expect(page.locator(".topbar-install")).toBeVisible();
  const row = (await page.locator(".topbar .breadcrumb").boundingBox())!;
  const badge = (await page.locator(".topbar .privacy-top").boundingBox())!;
  expect(badge.y).toBeGreaterThanOrEqual(row.y + row.height);
  await expectDesktopAlignment(page);
});

test.describe("phone drawer", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: async ({ browserName }, use) => {
      await use(browserName === "webkit" ? { width: 390, height: 844 } : { width: 412, height: 915 });
    },
  });

  test("keeps the drawer brand and navigation in place with a 44px home target", async ({ page }) => {
    await page.goto("./");
    await page.getByRole("button", { name: "Open navigation", exact: true }).tap();
    await expect(page.locator(".sidebar")).toHaveClass(/\bopen\b/);

    const brand = (await page.getByRole("link", { name: "Meeting Memo home", exact: true }).boundingBox())!;
    const mark = (await page.locator(".sidebar .brand-mark").boundingBox())!;
    const navLabel = (await page.locator(".sidebar > .nav-label").boundingBox())!;
    expect(mark.y + mark.height / 2).toBeCloseTo(49, 0);
    expect(navLabel.y).toBeCloseTo(100, 0);
    expect(brand.width).toBeGreaterThanOrEqual(44);
    expect(brand.height).toBeGreaterThanOrEqual(44);
  });
});
