import { expect, test } from "@playwright/test";

test("palette accents remain independent of success and speaker colors", async ({ page }) => {
  await page.goto("#/settings");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.innerHTML = '<span class="pill green">Ready</span><button class="button primary">Action</button><button class="player-skip">Focus</button><span class="speaker-swatch" style="background:var(--speaker-1)">S1</span>';
    fixture.setAttribute("data-testid", "color-fixture");
    document.body.append(fixture);
  });

  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Theme", { exact: true }).selectOption(theme);
    let baseline: { pill: string; speaker: string } | undefined;
    const accents = new Set<string>();
    for (const palette of ["forest", "ocean", "violet", "amber"]) {
      await page.getByLabel("Color palette", { exact: true }).selectOption(palette);
      await page.getByTestId("color-fixture").locator(".button.primary").focus();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("color-fixture").locator(".player-skip")).toBeFocused();
      await page.getByTestId("color-fixture").locator(".button.primary").evaluate(async (button) => {
        void getComputedStyle(button).backgroundColor;
        await Promise.all(button.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      });
      const colors = await page.getByTestId("color-fixture").evaluate((fixture) => {
        const pill = getComputedStyle(fixture.querySelector(".pill")!);
        const button = getComputedStyle(fixture.querySelector("button")!);
        const focus = getComputedStyle(fixture.querySelector(".player-skip")!);
        const speaker = getComputedStyle(fixture.querySelector(".speaker-swatch")!);
        const luminance = (color: string) => {
          const channels = color.match(/\d+/g)!.slice(0, 3).map(Number).map((value) => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        const contrast = (a: string, b: string) => {
          const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (values[0] + 0.05) / (values[1] + 0.05);
        };
        return { pill: `${pill.color}/${pill.backgroundColor}`, speaker: speaker.backgroundColor, accent: button.backgroundColor, pillContrast: contrast(pill.color, pill.backgroundColor), buttonContrast: contrast(button.color, button.backgroundColor), focusWidth: focus.outlineWidth, focusStyle: focus.outlineStyle, focusContrast: contrast(focus.outlineColor, focus.backgroundColor) };
      });
      baseline ??= { pill: colors.pill, speaker: colors.speaker };
      expect(colors.pill, `${theme}/${palette} status`).toBe(baseline.pill);
      expect(colors.speaker, `${theme}/${palette} speaker`).toBe(baseline.speaker);
      expect(colors.pillContrast, `${theme}/${palette} status contrast`).toBeGreaterThanOrEqual(4.5);
      expect(colors.buttonContrast, `${theme}/${palette} button contrast`).toBeGreaterThanOrEqual(4.5);
      expect(colors.focusStyle).toBe("solid");
      expect(parseFloat(colors.focusWidth)).toBeGreaterThanOrEqual(2);
      expect(colors.focusContrast, `${theme}/${palette} focus contrast`).toBeGreaterThanOrEqual(3);
      accents.add(colors.accent);
    }
    expect(accents.size).toBe(4);
  }
});
