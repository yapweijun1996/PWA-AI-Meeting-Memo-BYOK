import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { paletteChoices } from "./helpers/appearance";

test.use({ serviceWorkers: "block" });

test("favicon follows the brand palette across selection, reload and another tab", async ({
  page,
  context,
}) => {
  await page.goto("./#/settings");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const icon = page.locator('link[rel="icon"]');
  const original = await icon.getAttribute("href");
  await page.getByLabel("Color palette", { exact: true }).selectOption("amber");
  await expect(icon).not.toHaveAttribute("href", original!);
  const amber = await icon.getAttribute("href");
  expect(amber).toContain("data:image/svg+xml");
  const svg = decodeURIComponent(amber!.split(",")[1]);
  const brand = await page
    .locator(".brand-mark")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const normalized = await page.evaluate((svg) => {
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const canvas = window.document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = document.querySelector("rect")!.getAttribute("fill")!;
    return ctx.fillStyle;
  }, svg);
  expect(
    await page.evaluate((color) => {
      const el = document.createElement("div");
      el.style.color = color;
      document.body.append(el);
      const result = getComputedStyle(el).color;
      el.remove();
      return result;
    }, normalized),
  ).toBe(brand);
  const pixel = await page.evaluate(async (href) => {
    const image = new Image();
    image.src = href;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, 64, 64);
    return Array.from(context.getImageData(32, 8, 1, 1).data);
  }, amber!);
  expect(pixel).toEqual([...brand.match(/\d+/g)!.map(Number), 255]);
  await page.reload();
  await expect(icon).toHaveAttribute("href", amber!);
  const other = await context.newPage();
  await other.goto("./#/settings");
  await other.getByRole("tab", { name: "Appearance", exact: true }).click();
  await other
    .getByLabel("Color palette", { exact: true })
    .selectOption("ocean");
  await expect(icon).not.toHaveAttribute("href", amber!);
  await expect(icon).toHaveAttribute(
    "href",
    (await other.locator('link[rel="icon"]').getAttribute("href"))!,
  );
});

for (const width of [1440, 390])
  test(`language menu supports keyboard and stays inside ${width}px viewport`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./#/settings");
    const trigger = page.locator(".topbar-language > button");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitemradio", { name: "English", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("menuitemradio", { name: /Bahasa Melayu/ }),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitemradio", { name: "简体中文", exact: true }),
    ).toBeFocused();
    const box = (await page
      .getByRole("menu", { name: "Display language", exact: true })
      .boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `private-fixtures/language-menu-${info.project.name}-${width}.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await trigger.click();
    await page
      .getByRole("menuitemradio", { name: "简体中文", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("heading", { name: /设置/ }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByRole("tab", { name: "外观", exact: true }).click();
    await expect(
      page.getByLabel("配色", { exact: true }).locator("option"),
    ).toHaveCount(paletteChoices.length);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width >= 1100) {
      await expect
        .poll(() =>
          page.evaluate(() => {
            const sidebar = document
              .querySelector(".sidebar")!
              .getBoundingClientRect();
            const panel = document
              .querySelector(".settings-appearance-panel")!
              .getBoundingClientRect();
            return panel.left - sidebar.right;
          }),
        )
        .toBeGreaterThanOrEqual(24);
    }
    const layout = () =>
      page.evaluate(() => ({
        scrollX,
        viewport: innerWidth,
        sidebar: document
          .querySelector(".sidebar")!
          .getBoundingClientRect()
          .toJSON(),
        panel: document
          .querySelector(".settings-appearance-panel")!
          .getBoundingClientRect()
          .toJSON(),
        main: document
          .querySelector(".main-shell")!
          .getBoundingClientRect()
          .toJSON(),
        margin: getComputedStyle(document.querySelector(".main-shell")!)
          .marginLeft,
      }));
    const before = await layout();
    await page.screenshot({
      path: `private-fixtures/appearance-${info.project.name}-${width}.png`,
      fullPage: true,
      // Chromium full-page capture can restart the existing sidebar margin transition.
      animations: "disabled",
    });
    const after = await layout();
    await info.attach("appearance-layout", {
      body: JSON.stringify({ before, after }),
      contentType: "application/json",
    });
    if (width >= 1100)
      expect(after.panel.left - after.sidebar.right).toBeGreaterThanOrEqual(24);
  });

test("appearance stays beside the sidebar after normal-motion toggles and resizing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./#/settings");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const toggle = page.locator(".sidebar-toggle");
  for (const width of [1440, 1200, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const collapsed of [true, false]) {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", String(!collapsed));
      await page.locator(".main-shell").evaluate(async (element) => {
        void getComputedStyle(element).marginLeft;
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const geometry = await page.evaluate(() => {
        const sidebar = document.querySelector(".sidebar")!.getBoundingClientRect();
        const main = document.querySelector(".main-shell")!.getBoundingClientRect();
        const panel = document.querySelector(".settings-appearance-panel")!.getBoundingClientRect();
        return { overlap: sidebar.right - main.left, gap: panel.left - sidebar.right, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(geometry.overlap).toBeLessThanOrEqual(1);
      expect(geometry.gap).toBeGreaterThanOrEqual(24);
      expect(geometry.overflow).toBe(false);
    }
  }
});
