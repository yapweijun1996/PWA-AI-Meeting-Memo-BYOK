import { expect, test } from "@playwright/test";

test("palette accents remain independent of success and speaker colors", async ({ page }) => {
  await page.goto("#/settings");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.innerHTML = '<span class="pill green">Ready</span><button class="button primary">Action</button><button class="player-skip">Focus</button><span class="speaker-swatch" style="background:var(--speaker-1)">S1</span>';
    const roles = document.createElement("div");
    roles.style.cssText = "position:absolute;left:-10000px;top:0";
    roles.innerHTML = '<div class="evidence-context"><mark>Evidence</mark></div><div class="app-tooltip">Tooltip</div><div class="toast-layer">Toast</div><div class="processing-card"><div class="processing-indicator">Working</div></div>';
    fixture.append(roles);
    fixture.setAttribute("data-testid", "color-fixture");
    document.body.append(fixture);
  });
  const initialBackground = await page.locator("html").evaluate(element => getComputedStyle(element).getPropertyValue("--bg-app").trim());
  const manifestResponse = await page.request.get("manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.background_color).toBe(initialBackground);
  expect(manifest.theme_color).toBe(initialBackground);

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
        const root = getComputedStyle(document.documentElement);
        const roleContracts = [
          [".evidence-context mark", "background:var(--evidence-highlight-bg);color:var(--evidence-highlight-text);border-radius:var(--radius-evidence)", ["background-color", "color", "border-radius"]],
          [".app-tooltip", "background:var(--tooltip-bg);color:var(--tooltip-text);box-shadow:var(--shadow-tooltip);z-index:var(--layer-tooltip)", ["background-color", "color", "box-shadow", "z-index"]],
          [".toast-layer", "box-shadow:var(--shadow-toast);z-index:var(--layer-toast)", ["box-shadow", "z-index"]],
          [".processing-card", "box-shadow:var(--shadow-processing)", ["box-shadow"]],
          [".processing-indicator", "box-shadow:var(--shadow-processing-indicator)", ["box-shadow"]],
        ] as const;
        const roleChecks = roleContracts.map(([selector, cssText, properties]) => {
          const reference = document.createElement("span");
          reference.style.cssText = cssText;
          fixture.append(reference);
          const actual = getComputedStyle(fixture.querySelector(selector)!);
          const expected = getComputedStyle(reference);
          const values = (style: CSSStyleDeclaration) => Object.fromEntries(properties.map(name => [name, style.getPropertyValue(name)]));
          const result = { selector, actual: values(actual), expected: values(expected) };
          reference.remove();
          return result;
        });
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
        return { pill: `${pill.color}/${pill.backgroundColor}`, speaker: speaker.backgroundColor, accent: button.backgroundColor, pillContrast: contrast(pill.color, pill.backgroundColor), buttonContrast: contrast(button.color, button.backgroundColor), focusWidth: focus.outlineWidth, focusStyle: focus.outlineStyle, focusContrast: contrast(focus.outlineColor, focus.backgroundColor), roleChecks, chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"), background: root.getPropertyValue("--bg-app").trim() };
      });
      baseline ??= { pill: colors.pill, speaker: colors.speaker };
      expect(colors.pill, `${theme}/${palette} status`).toBe(baseline.pill);
      expect(colors.speaker, `${theme}/${palette} speaker`).toBe(baseline.speaker);
      expect(colors.pillContrast, `${theme}/${palette} status contrast`).toBeGreaterThanOrEqual(4.5);
      expect(colors.buttonContrast, `${theme}/${palette} button contrast`).toBeGreaterThanOrEqual(4.5);
      expect(colors.focusStyle).toBe("solid");
      expect(parseFloat(colors.focusWidth)).toBeGreaterThanOrEqual(2);
      expect(colors.focusContrast, `${theme}/${palette} focus contrast`).toBeGreaterThanOrEqual(3);
      expect(colors.chrome, `${theme}/${palette} browser chrome`).toBe(colors.background);
      for (const role of colors.roleChecks) expect(role.actual, `${theme}/${palette} ${role.selector}`).toEqual(role.expected);
      accents.add(colors.accent);
    }
    expect(accents.size).toBe(4);
  }
});
