import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { changeTopbarLanguage } from "./helpers/language";

const english = {
  message: "Offline installation is unavailable. Your local meetings can still be backed up.",
  close: "Dismiss notice for one week",
};
const chinese = {
  message: "\u79bb\u7ebf\u5b89\u88c5\u4e0d\u53ef\u7528\u3002\u60a8\u4ecd\u53ef\u5907\u4efd\u672c\u5730\u4f1a\u8bae\u3002",
  close: "\u5173\u95ed\u63d0\u793a\uff0c\u4e00\u5468\u540e\u518d\u63d0\u9192",
};
const week = 7 * 24 * 60 * 60 * 1000;

function notice(page: Page, labels = english) {
  return page.getByRole("status").filter({ hasText: labels.message });
}
function dismiss(page: Page, labels = english) {
  return notice(page, labels).getByRole("button", { name: labels.close, exact: true });
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "mobile" : "desktop", () => {
    test.use({ serviceWorkers: "block", reducedMotion: "reduce" });
    if (mobile) {
      test.use({
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        viewport: async ({ browserName }, use) => {
          await use(browserName === "webkit" ? { width: 390, height: 844 } : { width: 412, height: 915 });
        },
      });
    }

    test.beforeEach(async ({ context, baseURL }) => {
      const origin = new URL(baseURL!).origin;
      await context.route("**/*", route => new URL(route.request().url()).origin === origin
        ? route.continue() : route.abort());
      await context.addInitScript(() => {
        Object.defineProperty(navigator.serviceWorker, "register", {
          configurable: true,
          value: async () => { throw new Error("Synthetic registration failure"); },
        });
      });
    });

    test("localizes dismissal, restores keyboard focus and repeats each week across reload", async ({ page }) => {
      await page.clock.install();
      await page.goto("./");
      await expect(dismiss(page)).toBeVisible();
      await changeTopbarLanguage(page, "zh-CN");
      const close = dismiss(page, chinese);
      await expect(close).toBeVisible();
      await close.focus();
      await page.keyboard.press("Enter");
      await expect(notice(page, chinese)).toHaveCount(0);
      await expect(page.locator("main h1")).toBeFocused();
      await page.reload();
      await expect(page.locator("main h1")).toBeVisible();
      await page.clock.fastForward(week - 60 * 60 * 1000);
      await expect(close).toHaveCount(0);
      await page.clock.fastForward(60 * 60 * 1000);
      await expect(close).toBeVisible();
      await page.clock.fastForward(week);
      await expect(notice(page, chinese)).toHaveCount(1);
      await close.click();
      await expect(notice(page, chinese)).toHaveCount(0);
      await page.clock.fastForward(week);
      await expect(close).toBeVisible();
    });

    test("blocked localStorage allows page-only dismissal", async ({ context, page }) => {
      await context.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() { throw new DOMException("Storage denied", "SecurityError"); },
        });
      });
      await page.goto("./");
      await dismiss(page).click();
      await expect(notice(page)).toHaveCount(0);
      await page.evaluate(() => { location.hash = "#/settings"; });
      await expect(page.getByRole("tab", { name: "Appearance" })).toBeVisible();
      await expect(notice(page)).toHaveCount(0);
      await page.reload();
      await expect(dismiss(page)).toBeVisible();
    });

    test("closing in one tab hides the notice in another open tab", async ({ page, context }) => {
      await page.goto("./");
      await expect(dismiss(page)).toBeVisible();
      const other = await context.newPage();
      await other.goto("./");
      await expect(dismiss(other)).toBeVisible();
      await dismiss(other).click();
      await expect(notice(other)).toHaveCount(0);
      await expect(notice(page)).toHaveCount(0);
    });

    test("keeps the named control inside the notice and passes serious accessibility checks", async ({ page }) => {
      await page.goto("./");
      const close = dismiss(page);
      await expect(close).toBeVisible();
      const initial = page.viewportSize()!;
      for (const width of new Set([initial.width, 320, 390, 768])) {
        await page.setViewportSize({ width, height: initial.height });
        const geometry = await close.evaluate(button => {
          const status = button.closest('[role="status"]')!;
          const bounds = status.getBoundingClientRect();
          const text = status.querySelector("span")!.getBoundingClientRect();
          const hit = button.getBoundingClientRect();
          return {
            fits: bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth &&
              hit.left >= text.right && hit.right <= bounds.right && hit.top >= bounds.top && hit.bottom <= bounds.bottom,
            pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            width: hit.width, height: hit.height,
          };
        });
        expect(geometry.fits, `notice at ${width}px`).toBe(true);
        expect(geometry.pageFits, `viewport at ${width}px`).toBe(true);
        expect(geometry.width).toBeGreaterThanOrEqual(44);
        expect(geometry.height).toBeGreaterThanOrEqual(44);
      }
      await page.setViewportSize(initial);
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await expect(close).toHaveCSS("outline-style", "solid");
      const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(audit.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    });
  });
}
