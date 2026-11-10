import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block" });
const settings = "/PWA-AI-Meeting-Memo-BYOK/#/settings";

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
