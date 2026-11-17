import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });
for (const locale of ["en", "zh-CN", "ms"])
  for (const width of [1440, 390, 320])
    test(`About records actual recording limits with accessible layout (${locale}, ${width})`, async ({ page, context }) => {
      const external: string[] = [], errors: string[] = [];
      await context.route("https://**/*", route => { external.push(route.request().url()); return route.abort(); });
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(({ locale, width }) => {
        localStorage.setItem("meeting-memo:ui-language-override", locale);
        localStorage.setItem("meeting-memo:font-size", width === 320 ? "xxlarge" : "normal");
      }, { locale, width });
      await page.goto("/PWA-AI-Meeting-Memo-BYOK/#/settings");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const name = locale === "zh-CN" ? "关于" : locale === "ms" ? "Perihal" : "About";
      await page.getByRole("tab", { name, exact: true }).focus();
      await page.keyboard.press("Enter");
      const panel = page.getByRole("tabpanel", { name, exact: true });
      await expect(panel).toBeVisible();
      for (const limit of ["24,000,000", "MP3/MPEG", "M4A/MP4", "4 GiB", "25 MB"])
        await expect(panel).toContainText(limit);
      await expect(panel).not.toContainText("50 MiB");
      await expect(panel).toContainText(locale === "zh-CN" ? "设备、浏览器、格式和可用存储" : "device, browser, format and available storage");
      await expect(panel).toContainText(locale === "zh-CN" ? "仍待完成" : "remain open");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await panel.locator("p.muted").first().evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const axe = await new AxeBuilder({ page }).include("#settings-panel-about").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations).toEqual([]);
      expect(axe.incomplete).toEqual([]);
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
    });
