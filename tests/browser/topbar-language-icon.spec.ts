import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { uiLanguageOptions } from "../../src/ui-language-options";
import { changeTopbarLanguage } from "./helpers/language";

const languageNames = {
  en: "Display language: English",
  "zh-CN": "\u663e\u793a\u8bed\u8a00: \u7b80\u4f53\u4e2d\u6587",
  ms: "Bahasa paparan: Bahasa Melayu",
};

async function checkLayout(page: Page, width: number) {
  const trigger = page.locator(".topbar-language > button");
  const badge = page.locator(".topbar .privacy-top");
  const metrics = await trigger.evaluate(button => {
    const { left, right, width, height } = button.getBoundingClientRect();
    return { left, right, width, height, pageWidth: document.documentElement.scrollWidth };
  });
  expect(metrics.width).toBeGreaterThanOrEqual(44);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(width);
  expect(metrics.pageWidth).toBeLessThanOrEqual(width);
  if (width >= 761) {
    await expect(badge).toBeVisible();
    const box = (await badge.boundingBox())!;
    expect(metrics.right).toBeLessThanOrEqual(box.x);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  } else {
    await expect(badge).toBeHidden();
  }
  return metrics.width;
}

async function checkLanguages(page: Page, width: number) {
  await page.goto("./");
  const trigger = page.locator(".topbar-language > button");
  const value = trigger.locator(".choice-menu-value");
  const compact = width <= 600 || width >= 761;
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await trigger.press("ArrowDown");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitemradio").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS("outline-style", "solid");

  let initialWidth: number | undefined;
  const breadcrumb = page.locator(".topbar .breadcrumb strong");
  await expect(breadcrumb).toHaveText("Your meetings");
  for (const language of uiLanguageOptions) {
    if (language.value !== "en") {
      const previousText = await breadcrumb.innerText();
      await changeTopbarLanguage(page, language.value);
      await expect(breadcrumb).not.toHaveText(previousText);
    }
    await expect(trigger).toHaveAccessibleName(languageNames[language.value]);
    await expect(trigger).toHaveAttribute("title", language.label);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    if (compact) await expect(value).toBeHidden();
    else await expect(value).toBeVisible();
    for (const glyph of ["languages", "chevron-down"]) {
      await expect(trigger.locator(`svg.lucide-${glyph}[stroke="currentColor"]`)).toBeVisible();
    }
    const buttonWidth = await checkLayout(page, width);
    initialWidth ??= buttonWidth;
    if (compact) expect(buttonWidth).toBe(initialWidth);
  }
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

test.use({ reducedMotion: "reduce" });
for (const width of [1440, 1024, 768, 680]) {
  test(`topbar language layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await checkLanguages(page, width);
  });
}

test.describe("mobile topbar language control", () => {
  test.use({ isMobile: true, hasTouch: true });
  test("preserves the compact phone menu", async ({ page, browserName }) => {
    const viewport = browserName === "webkit" ? { width: 390, height: 844 } : { width: 412, height: 915 };
    await page.setViewportSize(viewport);
    await checkLanguages(page, viewport.width);
  });
});
