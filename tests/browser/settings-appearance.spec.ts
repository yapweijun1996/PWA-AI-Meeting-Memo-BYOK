import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block" });
const settings = "/PWA-AI-Meeting-Memo-BYOK/#/settings";

test("appearance groups distinguish language drafts from immediate settings", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(settings);
  await page.getByLabel("OpenAI API key", { exact: true }).fill("test-key-not-real");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByRole("heading", { name: "Interface appearance" })).toBeVisible();
  const fields = page.locator(".appearance-fields").first();
  expect(await fields.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await expect(page.getByText("语言更改尚未保存。保存时也会保存 API 和模型草稿。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存所有设置" }).click();
  await expect(page.getByText("语言更改尚未保存。保存时也会保存 API 和模型草稿。", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("OpenAI API 密钥", { exact: true })).toHaveValue("test-key-not-real");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "外观" }).click();
  expect(await fields.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("font persists across reload and tabs without losing API drafts", async ({ page, context }) => {
  await page.goto(settings);
  await page.getByLabel("OpenAI API key", { exact: true }).fill("test-key-not-real");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByText("Unsaved settings")).toBeVisible();
  const font = page.getByLabel("Font family");
  await font.selectOption("georgia");
  await expect(page.locator("html")).toHaveAttribute("data-font", "georgia");
  await expect(page.getByRole("status").filter({ hasText: "Font saved" })).toBeVisible();
  await page.getByRole("tab", { name: "API & models" }).click();
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue("test-key-not-real");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-font", "georgia");
  const other = await context.newPage();
  await other.goto(settings);
  await other.getByRole("tab", { name: "Appearance" }).click();
  await other.getByLabel("Font family").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-font", "system");
  await other.getByRole("button", { name: "Restore default font" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "default");
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue("test-key-not-real");
});

test("appearance supports keyboard, narrow screens and storage failure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(settings);
  const api = page.getByRole("tab", { name: "API & models" });
  await api.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Appearance" })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Appearance" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "meeting-memo:font-family") throw new DOMException("denied", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByLabel("Font family").selectOption("georgia");
  await expect(page.getByRole("alert")).toContainText("Could not save the font");
  await expect(page.locator("html")).toHaveAttribute("data-font", "default");
  await expect(page.getByLabel("Font family")).toHaveValue("default");
});

test("forgetting keys retains font and unsaved language changes", async ({ page }) => {
  await page.goto(settings);
  await page.getByLabel("OpenAI API key", { exact: true }).fill("test-key-not-real");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Font family").selectOption("segoe");
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("tab", { name: "API 与模型" }).click();
  await page.getByRole("button", { name: "清除密钥" }).click();
  await expect(page.getByLabel("OpenAI API 密钥", { exact: true })).toHaveValue("");
  await expect(page.getByText("设置尚未保存")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-font", "segoe");
  await page.getByRole("tab", { name: "外观" }).click();
  await expect(page.getByLabel("Display language / 显示语言")).toHaveValue("zh-CN");
});

test("font size persists and changes rendered typography", async ({ page }) => {
  await page.goto(settings);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByLabel("Font family").locator("option")).toHaveCount(10);
  await expect(page.getByLabel("Font size").locator("option")).toHaveCount(5);
  const preview = page.getByLabel("Font preview").locator("strong");
  const before = await preview.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await page.getByLabel("Font size").selectOption("large");
  await expect(page.locator("html")).toHaveAttribute("data-font-size", "large");
  await expect.poll(() => preview.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(before);
  await page.reload();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByLabel("Font size")).toHaveValue("large");
});

test("theme and palette persist with readable dark surfaces", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(settings);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.getByLabel("Color palette", { exact: true }).selectOption("ocean");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#131d18");
  for (const mode of ["light", "dark"]) {
    await page.getByLabel("Theme", { exact: true }).selectOption(mode);
    for (const palette of ["forest", "ocean", "violet", "amber"]) {
      await page.getByLabel("Color palette", { exact: true }).selectOption(palette);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations, `${mode}/${palette}`).toEqual([]);
    }
  }
  await page.getByLabel("Color palette", { exact: true }).selectOption("ocean");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
});

test("sidebar update check reports unavailability without shifting layout", async ({ page }) => {
  await page.goto(settings);
  const sidebar = page.locator(".pwa-sidebar");
  await expect(sidebar.getByText(/Version 0\.1\.0/)).toBeVisible();
  const before = await sidebar.boundingBox();
  await sidebar.getByRole("button", { name: "Check for updates" }).click();
  await expect(sidebar.getByRole("status")).toContainText(/unavailable|Could not check/);
  const after = await sidebar.boundingBox();
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
});

test("topbar language updates the clean settings form without making it dirty", async ({ page }) => {
  await page.goto(settings);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.locator(".topbar-language select").selectOption("zh-CN");
  await expect(page.getByLabel("字体", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved settings", { exact: true })).toHaveCount(0);
});

test("topbar language refreshes settings while preserving unsaved drafts", async ({ page }) => {
  await page.goto(settings);
  await page.getByLabel("OpenAI API key", { exact: true }).fill("test-key-not-real");
  await page.locator(".topbar-language select").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.getByLabel("OpenAI API 密钥", { exact: true })).toHaveValue("test-key-not-real");
  await expect(page.getByText("设置尚未保存")).toBeVisible();
  await page.getByRole("tab", { name: "外观" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("en");
  await page.locator(".topbar-language select").selectOption("ms");
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");
  await expect(page.getByLabel("Display language / 显示语言")).toHaveValue("en");
  await page.getByRole("tab", { name: "API & models" }).click();
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue("test-key-not-real");
});

test("largest font size remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(settings);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Font size", { exact: true }).selectOption("xxlarge");
  await expect(page.locator("html")).toHaveAttribute("data-font-size", "xxlarge");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
