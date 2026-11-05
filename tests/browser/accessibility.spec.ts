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
