import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const channels = color.match(/\d+/g)!.slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("workspace icons, tabs and errors follow semantic colors in every theme", async ({ page }, info) => {
  test.setTimeout(120000);
  await page.context().route("https://**/*", route => route.abort());
  await page.addInitScript(() => { window.confirm = () => true; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  const meeting = sampleMeeting();
  meeting.title = "Synthetic workspace colors";
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "synthetic-colors.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(meeting)),
  });
  await expect(page.getByRole("heading", { name: "Synthetic workspace colors (restored)", exact: true })).toBeVisible();
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({ name: "empty.wav", mimeType: "audio/wav", buffer: Buffer.alloc(0) });
  await expect(page.locator(".app-error")).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();

  for (const theme of ["light", "dark"]) for (const palette of ["forest", "ocean", "violet", "amber"]) {
    await page.evaluate(({ theme, palette }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.palette = palette;
    }, { theme, palette });
    const colors = await page.evaluate(() => {
      const reference = document.createElement("span");
      document.body.append(reference);
      const color = (token: string) => {
        reference.style.color = `var(${token})`;
        return getComputedStyle(reference).color;
      };
      const style = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const s = getComputedStyle(node);
        return { color: s.color, background: s.backgroundColor, border: s.borderBottomColor };
      };
      const value = {
        accent: color("--color-accent-text"), selectedText: color("--action-selected-text"),
        selectedBg: color("--action-selected-bg"), muted: color("--text-muted"),
        subtle: color("--surface-subtle"), danger: color("--status-danger-text"),
        errorBg: color("--status-danger-bg"), surface: color("--bg-surface"),
        privacy: style(".privacy-top"), recording: style(".recording-info .round-icon"),
        empty: style(".memo-review-panel .empty-symbol"), selected: style('.workspace-tabs > button[aria-selected="true"]'),
        selectedCount: style('.workspace-tabs > button[aria-selected="true"] > span'),
        other: style('.workspace-tabs > button[aria-selected="false"]'),
        otherCount: style('.workspace-tabs > button[aria-selected="false"] > span'),
        error: style(".app-error"), dismiss: style(".app-error > button"),
      };
      reference.remove();
      return value;
    });
    const name = `${theme}/${palette}`;
    expect(colors.privacy.color, name).toBe(colors.selectedText);
    expect(colors.privacy.background, name).toBe(colors.selectedBg);
    for (const icon of [colors.recording, colors.empty]) {
      expect(icon.color, name).toBe(colors.selectedText);
      expect(icon.background, name).toBe(colors.selectedBg);
    }
    expect(colors.selected.color, name).toBe(colors.accent);
    expect(colors.selected.border, name).toBe(colors.accent);
    expect(colors.selectedCount.color, name).toBe(colors.selectedText);
    expect(colors.selectedCount.background, name).toBe(colors.selectedBg);
    expect(colors.other.color, name).toBe(colors.muted);
    expect(colors.otherCount.color, name).toBe(colors.muted);
    expect(colors.otherCount.background, name).toBe(colors.subtle);
    expect(colors.error.color, name).toBe(colors.danger);
    expect(colors.error.background, name).toBe(colors.errorBg);
    expect(colors.dismiss.color, name).toBe(colors.danger);
    expect(contrast(colors.selectedText, colors.selectedBg), name + " selected contrast").toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.accent, colors.surface), name + " accent contrast").toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, colors.surface), name + " muted contrast").toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.danger, colors.errorBg), name + " error contrast").toBeGreaterThanOrEqual(4.5);
    if (palette === "violet") {
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`workspace-${theme}-violet.png`) });
    }
  }
  await page.locator(".app-error > button").hover();
  const hover = await page.locator(".app-error > button").evaluate(element => {
    const reference = document.createElement("span");
    reference.style.backgroundColor = "var(--status-danger-hover-bg)";
    document.body.append(reference);
    const result = [getComputedStyle(element).backgroundColor, getComputedStyle(reference).backgroundColor];
    reference.remove();
    return result;
  });
  expect(hover[0]).toBe(hover[1]);
  await page.getByRole("button", { name: "Dismiss error", exact: true }).click();
  await expect(page.locator(".app-error")).toHaveCount(0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
