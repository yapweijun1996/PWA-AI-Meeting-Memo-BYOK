import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { paletteChoices } from "./helpers/appearance";
import { changeTopbarLanguage } from "./helpers/language";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

const settings = "./#/settings";
const switchToDark = "Switch to dark theme";
const switchToLight = "Switch to light theme";
const toggle = (page: Page) => page.locator(".topbar-theme");

async function expectAction(button: Locator, label: string, icon: "moon" | "sun") {
  await expect(button).toHaveAccessibleName(label);
  await expect(button).toHaveAttribute("title", label);
  await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(button.locator("svg")).toHaveClass(new RegExp(`lucide-${icon}\\b`));
}

async function expectHeaderFits(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(toggle(page)).toBeInViewport({ ratio: 1 });
  const boxes = await page.locator([
    ".topbar-theme", ".topbar-language > button", ".privacy-top",
    ".topbar-install", ".topbar .mobile-menu", ".topbar .sidebar-toggle",
  ].join(", ")).evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
    return { name: element.className, left, right, top, bottom, width, height };
  }));
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  for (const [index, box] of boxes.entries()) {
    expect(box.left, box.name).toBeGreaterThanOrEqual(0);
    expect(box.right, box.name).toBeLessThanOrEqual(viewportWidth + 0.5);
    if (box.name.includes("topbar-theme")) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    for (const other of boxes.slice(index + 1)) {
      expect(box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top,
        `${box.name} overlaps ${other.name}`).toBe(true);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
}

for (const [width, height] of [[1440, 900], [390, 844], [412, 915]]) {
  test(`theme action, Settings, reload and another tab agree at ${width}x${height}`, async ({ page, context, browserName }) => {
    test.skip(width === 412 && browserName !== "chromium", "Additional Chromium phone size");
    await page.setViewportSize({ width, height });
    await page.goto(settings);
    await page.getByRole("tab", { name: "Appearance" }).click();
    const select = page.getByRole("combobox", { name: "Theme", exact: true });
    const button = toggle(page);
    await expect(select).toHaveValue("light");
    await expectAction(button, switchToDark, "moon");
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(select).toHaveValue("dark");
    await expectAction(button, switchToLight, "sun");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("tab", { name: "Appearance" }).click();
    await expect(select).toHaveValue("dark");

    const other = await context.newPage();
    await other.goto("./");
    await expectAction(toggle(other), switchToLight, "sun");
    await select.selectOption("light");
    await expectAction(button, switchToDark, "moon");
    await expect(other.locator("html")).toHaveAttribute("data-theme", "light");
    await expectAction(toggle(other), switchToDark, "moon");
    await toggle(other).click();
    await expect(select).toHaveValue("dark");
    await expectAction(button, switchToLight, "sun");
    await other.close();
    await expectHeaderFits(page);
    await button.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expectAction(button, switchToDark, "moon");
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(audit.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  });
}

test("theme action names follow the display language in both directions", async ({ page }) => {
  await page.goto("./");
  for (const [language, dark, light] of [
    ["en", switchToDark, switchToLight],
    ["zh-CN", "切换到深色主题", "切换到浅色主题"],
    ["ms", "Tukar kepada tema gelap", "Tukar kepada tema cerah"],
  ]) {
    await changeTopbarLanguage(page, language);
    const button = toggle(page);
    await expectAction(button, dark, "moon");
    await button.click();
    await expectAction(button, light, "sun");
    await button.click();
  }
});

for (const width of [320, 390, 768]) {
  test(`topbar fits with largest text and every palette at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(settings);
    await page.getByRole("tab", { name: "Appearance" }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
    await expect(page.locator(".topbar-install")).toBeVisible();
    await page.getByLabel("Font size", { exact: true }).selectOption("xxlarge");
    const palette = page.getByLabel("Color palette", { exact: true });
    for (const choice of paletteChoices) {
      await palette.selectOption(choice);
      await expect(page.locator("html")).toHaveAttribute("data-palette", choice);
      await expectHeaderFits(page);
      await toggle(page).click();
      await expectHeaderFits(page);
    }
  });
}
