import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("library and settings meet the automated accessibility checks", async ({
  page,
}, info) => {
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
  await page.screenshot({
    path: info.outputPath("library-desktop.png"),
    fullPage: true,
  });
  // Audit the settled sidebar rather than sampling its initial opacity transition.
  await page.locator("#app-sidebar").evaluate(async (sidebar) => {
    await Promise.all(sidebar.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  let result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
});
test("manifest and worker use the project path", async ({ page, request }) => {
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
  const response = await request.get(
      "/PWA-AI-Meeting-Memo-BYOK/manifest.webmanifest",
    ),
    manifest = await response.json();
  expect(manifest.start_url).toBe("/PWA-AI-Meeting-Memo-BYOK/");
  expect(manifest.scope).toBe(manifest.start_url);
  for (const icon of manifest.icons)
    expect(
      (await request.get("/PWA-AI-Meeting-Memo-BYOK/" + icon.src)).ok(),
    ).toBe(true);
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(scope).toBe(new URL("/PWA-AI-Meeting-Memo-BYOK/", page.url()).href);
});

test("neutral theme roles keep the library and new meeting dialog readable", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await page.goto("/PWA-AI-Meeting-Memo-BYOK/#/settings");
    await page.getByRole("tab", { name: "Appearance" }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption(theme);
    await page.getByLabel("Color palette", { exact: true }).selectOption("violet");
    await page.getByRole("link", { name: "Workspace", exact: true }).click();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`library-${theme}.png`) });
    await page.locator("main").getByRole("button", { name: /^(New meeting|Create your first meeting)$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`new-meeting-${theme}.png`) });
    await page.keyboard.press("Escape");
  }
});
