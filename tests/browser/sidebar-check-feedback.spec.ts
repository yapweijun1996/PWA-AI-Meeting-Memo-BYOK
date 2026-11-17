import {changeTopbarLanguage} from "./helpers/language";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Probe = { mode: "ready" | "fail" | "offline"; checks: number };

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
  await page.addInitScript(() => {
    const probe: Probe = { mode: "ready", checks: 0 };
    Object.defineProperty(window, "__updateProbe", { value: probe });
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => probe.mode !== "offline" });
    const active = Object.assign(new EventTarget(), { state: "activated" });
    const registration = Object.assign(new EventTarget(), {
      waiting: null, installing: null, active,
      update: async () => { probe.checks++; if (probe.mode === "fail") throw new Error("Synthetic update failure"); },
    });
    Object.defineProperties(navigator.serviceWorker, {
      register: { configurable: true, value: async () => registration },
      getRegistration: { configurable: true, value: async () => registration },
      ready: { configurable: true, get: () => Promise.resolve(registration) },
      controller: { configurable: true, get: () => active },
    });
  });
});

for (const scenario of [
  { width: 1440, height: 900, language: "en", font: "normal", button: "Check for updates", result: "No update is ready.", failure: "Could not check for updates. Try again.", offline: "Offline: connect to check for updates.", collapse: "Collapse sidebar", expand: "Expand sidebar" },
  { width: 1280, height: 520, language: "zh-CN", font: "normal", button: "检查更新", result: "尚无可用更新。", failure: "无法检查更新，请重试。", offline: "离线：请联网后检查更新。", collapse: "收起侧边栏", expand: "展开侧边栏" },
  { width: 1280, height: 520, language: "en", font: "xxlarge", button: "Check for updates", result: "No update is ready.", failure: "Could not check for updates. Try again.", offline: "Offline: connect to check for updates.", collapse: "Collapse sidebar", expand: "Expand sidebar" },
]) {
  test("collapsed update feedback is readable and remains available (" + scenario.language + " " + scenario.font + ")", async ({ page }, info) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto("./");
    await changeTopbarLanguage(page, scenario.language);
    await page.evaluate(font => {
      localStorage.setItem("meeting-memo:font-size", font);
      window.dispatchEvent(new StorageEvent("storage", { key: "meeting-memo:font-size" }));
    }, scenario.font);
    await page.getByRole("button", { name: scenario.collapse, exact: true }).click();
    const sidebar = page.locator("aside.sidebar");
    const update = sidebar.getByRole("button", { name: scenario.button, exact: true });
    const feedback = sidebar.getByRole("status");
    await update.scrollIntoViewIfNeeded();
    const before = (await update.boundingBox())!;
    for (const [mode, message] of [["ready", scenario.result], ["fail", scenario.failure], ["offline", scenario.offline]] as const) {
      await page.evaluate(value => { (window as unknown as { __updateProbe: Probe }).__updateProbe.mode = value; }, mode);
      await update.click();
      await expect(feedback).toHaveText(message);
      const geometry = await feedback.evaluate(element => {
        const box = element.getBoundingClientRect();
        const rail = element.closest("aside")!.getBoundingClientRect();
        const visibleAtCenter = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          font: parseFloat(getComputedStyle(element).fontSize),
          left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          railRight: rail.right, hit: !!visibleAtCenter && element.contains(visibleAtCenter),
        };
      });
      console.log(JSON.stringify({ mode, language: scenario.language, ...geometry }));
      expect(geometry.font).toBeGreaterThanOrEqual(12);
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.railRight);
      expect(geometry.right).toBeLessThanOrEqual(scenario.width);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(scenario.height);
      expect(geometry.hit).toBe(true);
      const after = (await update.boundingBox())!;
      expect(Math.abs(after.y + after.height - before.y - before.height)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (mode === "ready") {
        await page.screenshot({ path: info.outputPath("feedback-" + scenario.language + ".png") });
        const accessibility = await new AxeBuilder({ page }).include(".pwa-sidebar").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
        expect(accessibility.violations).toEqual([]);
        await sidebar.getByRole("button", { name: scenario.language === "zh-CN" ? "关闭更新提示" : "Dismiss update message", exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(feedback).toBeEmpty();
        await expect(update).toBeFocused();
      }
    }
    await page.getByRole("button", { name: scenario.expand, exact: true }).click();
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveText(scenario.offline);
    const box = (await feedback.boundingBox())!;
    const rail = (await sidebar.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(rail.x + rail.width);
  });
}
