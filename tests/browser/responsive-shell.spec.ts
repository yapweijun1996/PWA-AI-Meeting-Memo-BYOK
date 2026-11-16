import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block" });

async function measureSidebarText(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const parseColor = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return channels.length >= 3
        ? { red: channels[0], green: channels[1], blue: channels[2], alpha: channels.length > 3 ? channels[3] : 1 }
        : null;
    };
    const luminance = (color: { red: number; green: number; blue: number }) => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
    };
    const contrast = (foreground: { red: number; green: number; blue: number }, background: { red: number; green: number; blue: number }) => {
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    return [...document.querySelectorAll<HTMLElement>("#app-sidebar small, #app-sidebar .nav-label, #app-sidebar .nav-text, #app-sidebar .sidebar-empty-hint")]
      .filter((element) => element.getClientRects().length > 0 && element.textContent?.trim())
      .map((element) => {
        const style = getComputedStyle(element);
        let effectiveOpacity = 1;
        let background: ReturnType<typeof parseColor> = null;
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          const currentStyle = getComputedStyle(current);
          effectiveOpacity *= Number(currentStyle.opacity);
          const candidate = parseColor(currentStyle.backgroundColor);
          if (!background && candidate && candidate.alpha >= 0.99) background = candidate;
        }
        const foreground = parseColor(style.color);
        if (!background || !foreground) return null;
        const visibleForeground = {
          red: foreground.red * effectiveOpacity + background.red * (1 - effectiveOpacity),
          green: foreground.green * effectiveOpacity + background.green * (1 - effectiveOpacity),
          blue: foreground.blue * effectiveOpacity + background.blue * (1 - effectiveOpacity),
        };
        return {
          text: element.textContent.trim(),
          color: style.color,
          backgroundColor: `rgb(${background.red}, ${background.green}, ${background.blue})`,
          effectiveOpacity,
          effectiveContrastRatio: Number(contrast(visibleForeground, background).toFixed(2)),
          animationName: style.animationName,
          activeAnimations: element.getAnimations().filter((animation) => animation.playState !== "finished").length,
        };
      })
      .filter((measurement): measurement is NonNullable<typeof measurement> => measurement !== null);
  });
}

async function expectSidebarTextContrast(page: import("@playwright/test").Page, state: string) {
  const measurements = await measureSidebarText(page);
  expect(measurements.length, `${state}: visible sidebar labels should be measured`).toBeGreaterThan(0);
  for (const measurement of measurements) {
    expect(measurement.effectiveOpacity, `${state}: ${measurement.text} opacity`).toBe(1);
    expect(measurement.animationName, `${state}: ${measurement.text} animation`).toBe("none");
    expect(measurement.activeAnimations, `${state}: ${measurement.text} active animations`).toBe(0);
    expect(measurement.effectiveContrastRatio, `${state}: ${measurement.text} contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`empty dashboard has no overflow and no axe violations at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("./");
    await expect(page.getByRole("heading", { name: /Your meetings/ })).toBeVisible();
    await expect(page.getByText("Opening local library…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create your first meeting" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (viewport.width >= 761) {
      const shell = page.locator(".app-shell");
      const startsCollapsed = await shell.evaluate((element) => element.classList.contains("sidebar-collapsed"));
      if (startsCollapsed) {
        await page.getByRole("button", { name: "Expand sidebar" }).click();
        await expect(shell).not.toHaveClass(/sidebar-collapsed/);
        await expectSidebarTextContrast(page, "immediately after initial tablet expansion");
      } else {
        await expectSidebarTextContrast(page, "initial expanded sidebar");
      }
      await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await expect(shell).toHaveClass(/sidebar-collapsed/);
      const expand = page.getByRole("button", { name: "Expand sidebar" });
      await expect(expand).toBeVisible();
      await expand.click();
      await expect(shell).not.toHaveClass(/sidebar-collapsed/);
      await expectSidebarTextContrast(page, "immediately after collapse-to-expand");
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
}
