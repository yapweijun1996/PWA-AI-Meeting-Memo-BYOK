import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import preferences from "../../src/appearance-preferences.json" with { type: "json" };
import { changeTopbarLanguage } from "./helpers/language";

test.use({ locale: "en-US", serviceWorkers: "block", reducedMotion: "reduce" });
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
});

const palettes = Object.entries(preferences.palette.options);
const trigger = (page: Page) => page.locator(".topbar-palette > button");
const settingsSelect = (page: Page) => page.getByRole("combobox", { name: "Color palette", exact: true });

async function openAppearance(page: Page) {
  await page.goto("./#/settings");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
}

async function expectPalette(page: Page, value: keyof typeof preferences.palette.options) {
  const name = `Color palette: ${preferences.palette.options[value].en}`;
  await expect(page.locator("html")).toHaveAttribute("data-palette", value);
  await expect(trigger(page)).toHaveAccessibleName(name);
  await expect(trigger(page)).toHaveAttribute("title", name);
}

async function expectHeaderFits(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(trigger(page)).toBeInViewport({ ratio: 1 });
  const layout = await page.locator(".topbar").evaluate((header) => {
    const controls = header.querySelectorAll([
      ".topbar-palette > button", ".topbar-theme", ".topbar-language > button",
      ".privacy-top", ".mobile-menu", ".sidebar-toggle", ".topbar-install",
    ].join(", "));
    return {
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headerOverflow: header.scrollWidth - header.clientWidth,
      boxes: Array.from(controls).filter((element) => element.getClientRects().length > 0).map((element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
        return { name: element.className, left, right, top, bottom, width, height };
      }),
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.headerOverflow).toBeLessThanOrEqual(0);
  const palette = (await trigger(page).boundingBox())!;
  expect(palette.width).toBeGreaterThanOrEqual(44);
  expect(palette.height).toBeGreaterThanOrEqual(44);
  for (const [index, box] of layout.boxes.entries()) {
    expect(box.left, box.name).toBeGreaterThanOrEqual(0);
    expect(box.right, box.name).toBeLessThanOrEqual(layout.width + 0.5);
    for (const other of layout.boxes.slice(index + 1)) {
      const overlap = box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
      expect(overlap, `${box.name} overlaps ${other.name}`).toBe(false);
    }
  }
}

async function verifyPaletteWorkflow(page: Page) {
  await openAppearance(page);
  const button = trigger(page);
  const select = settingsSelect(page);
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  const menu = page.getByRole("menu", { name: "Color palette", exact: true });
  const choices = menu.getByRole("menuitemradio");
  await expectPalette(page, "forest");
  await expect(select).toHaveValue(preferences.palette.default);
  const icon = button.locator("svg.lucide-palette");
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute("stroke", "currentColor");
  await expect(icon).toHaveAttribute("aria-hidden", "true");

  for (const mode of preferences.theme.values) {
    await theme.selectOption(mode);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expectHeaderFits(page);
    await button.press("ArrowDown");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(choices).toHaveText(palettes.map(([, labels]) => labels.en));
    await expect(choices.first()).toBeFocused();
    await expect(choices.first()).toHaveAttribute("aria-checked", "true");
    await expect(choices.first().locator("svg.lucide-check")).toBeVisible();
    const colors = await choices.locator(".topbar-palette-swatch[aria-hidden='true']").evaluateAll((swatches) =>
      swatches.map((swatch) => getComputedStyle(swatch).backgroundColor),
    );
    expect(new Set(colors).size).toBe(palettes.length);
    expect(colors[0]).toBe(await page.locator(".sidebar .brand-mark").evaluate((mark) => getComputedStyle(mark).backgroundColor));
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);

    await page.keyboard.press("End");
    await expect(choices.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(choices.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    await expect(button).toHaveCSS("outline-width", "2px");
  }

  await button.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(choices.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expectPalette(page, "ocean");
  await expect(select).toHaveValue("ocean");

  await page.reload();
  await expectPalette(page, "ocean");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(select).toHaveValue("ocean");
  const other = await page.context().newPage();
  await other.setViewportSize(page.viewportSize()!);
  await openAppearance(other);
  await expectPalette(other, "ocean");

  await select.selectOption("amber");
  await expectPalette(page, "amber");
  await expectPalette(other, "amber");
  await expect(settingsSelect(other)).toHaveValue("amber");

  await trigger(other).click();
  await other.getByRole("menuitemradio", { name: "Teal", exact: true }).click();
  await expectPalette(other, "teal");
  await expectPalette(page, "teal");
  await expect(select).toHaveValue("teal");
  await other.close();
}

test("palette menu synchronizes at 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await verifyPaletteWorkflow(page);
});

test.describe("phone palette menu", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const [width, height] of [[390, 844], [412, 915]]) {
    test(`palette menu synchronizes at ${width}x${height}`, async ({ page, browserName }) => {
      test.skip(width === 412 && browserName !== "chromium", "Additional Chromium phone size");
      await page.setViewportSize({ width, height });
      await verifyPaletteWorkflow(page);
    });
  }
});

test("localizes palette controls and uses the shared Malay fallback for palette names", async ({ page }) => {
  await page.goto("./");
  const button = trigger(page);
  for (const [language, label, separator, labelKey] of [
    ["en", "Color palette", ": ", "en"],
    ["zh-CN", "\u914d\u8272", "\uff1a", "zh"],
    ["ms", "Palet warna", ": ", "en"],
  ] as const) {
    await changeTopbarLanguage(page, language);
    const name = `${label}${separator}${preferences.palette.options.forest[labelKey]}`;
    await expect(button).toHaveAccessibleName(name);
    await expect(button).toHaveAttribute("title", name);
    await button.click();
    const menu = page.getByRole("menu", { name: label, exact: true });
    await expect(menu.getByRole("menuitemradio")).toHaveText(palettes.map(([, labels]) => labels[labelKey]));
    await page.keyboard.press("Escape");
  }
});

for (const width of [320, 390, 768]) {
  test(`palette and adjacent controls fit at ${width}px in every font size`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openAppearance(page);
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
    await expect(page.locator(".topbar-install")).toBeVisible();
    const badge = page.locator(".topbar .privacy-top");
    if (width >= 761) await expect(badge).toBeVisible();
    else await expect(badge).toBeHidden();
    const fontSize = page.getByRole("combobox", { name: "Font size", exact: true });
    for (const mode of preferences.theme.values) {
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(mode);
      for (const size of ["small", "normal", "large", "xlarge", "xxlarge"]) {
        await fontSize.selectOption(size);
        await expect(page.locator("html")).toHaveAttribute("data-font-size", size);
        await expectHeaderFits(page);
      }
    }
  });
}
