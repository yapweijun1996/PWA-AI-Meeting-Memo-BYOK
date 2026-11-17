import { expect, test as base, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import path from "node:path";

const test = base.extend<{ diagnostics: { externalRequests: string[]; consoleErrors: string[] } }>({
  // Automatic page fixtures start before beforeEach, including its first navigation.
  diagnostics: [async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error("Catalogue baseURL is required");
    const origin = `${new URL(baseURL).origin}/`;
    const externalRequests: string[] = [];
    const consoleErrors: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(origin)) externalRequests.push(request.url());
    });
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await use({ externalRequests, consoleErrors });
  }, { auto: true }],
});

async function capture(page: Page, filename: string, fullPage = false) {
  const directory = path.resolve("private-fixtures/delivery/catalogue");
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, filename), fullPage });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders actual shared component variants without app services and passes an accessibility scan", async ({ page, diagnostics }) => {
  await expect(page.getByRole("heading", { name: "Components in context" })).toBeVisible();
  await expect(page.getByText("YOUR MEETING WORKSPACE")).toBeVisible();
  for (const status of ["Waiting for review", "Saved", "Needs attention", "Save failed", "Local preview"]) {
    await expect(page.getByText(status, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("textbox", { name: "Disabled synthetic paragraph" })).toBeDisabled();
  await expect(page.locator(".catalogue-avatar-item img")).toHaveAttribute("alt", "");
  const databases = await page.evaluate(() => {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<unknown[]> };
    return factory.databases ? factory.databases() : null;
  });
  if (databases) expect(databases).toEqual([]);
  await page.reload();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(diagnostics.externalRequests).toEqual([]);
  expect(diagnostics.consoleErrors).toEqual([]);
});

test("opens the real modal, focuses its marked control, and returns focus after Escape or Close", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open sample dialog" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Component sample" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Focused on open" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Focused on open" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("shows a keyboard tooltip with an accessible description and dismisses it with Escape", async ({ page }) => {
  const modalOpener = page.getByRole("button", { name: "Open sample dialog" });
  const trigger = page.getByRole("button", { name: "Focus for a tooltip" });
  await modalOpener.focus();
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText("A short keyboard and pointer hint.");
  await expect(trigger).toHaveAttribute("aria-describedby", /app-tooltip/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(trigger).not.toHaveAttribute("aria-describedby", /app-tooltip/);
});

test("announces and dismisses the actual shared toast layer", async ({ page }) => {
  await page.getByRole("button", { name: "Show a status toast" }).click();
  const toast = page.getByRole("status").filter({ hasText: "Local preview saved in memory." });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(toast).toHaveCount(0);
});

test("shows a loading placeholder only during the short local loading transition", async ({ page }) => {
  await page.getByRole("button", { name: "Simulate local loading" }).click();
  await expect(page.getByRole("status", { name: "Loading local catalogue preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simulate local loading" })).toBeDisabled();
  await expect(page.getByRole("status", { name: "Loading local catalogue preview" })).toBeHidden();
});

test("respects reduced motion for the actual loading placeholder animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Simulate local loading" }).click();
  await expect(page.getByRole("status", { name: "Loading local catalogue preview" })).toBeVisible();
  await expect.poll(() => page.locator(".loading-line").first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

test("keeps the catalogue within the viewport at desktop, tablet, and mobile widths", async ({ page }) => {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("preserves an editor draft when its synthetic in-memory save fails", async ({ page }) => {
  const field = page.getByRole("textbox", { name: "Synthetic paragraph draft" });
  await page.getByRole("checkbox", { name: "Fail the next save once" }).check();
  await field.fill("Unsaved local draft retained after the synthetic failure.");
  await expect(page.getByText("Synthetic save failed. Your draft is still here; edit or blur to retry.")).toBeVisible();
  await expect(field).toHaveValue("Unsaved local draft retained after the synthetic failure.");
  await expect(field).toHaveAttribute("data-unsaved-edit", "true");
});

for (const viewport of [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
]) {
  test(`captures the fixed synthetic catalogue at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole("heading", { name: "Components in context" })).toBeVisible();
    await capture(page, `catalogue-${viewport.name}.png`);
  });
}

test("captures the full mobile catalogue with its temporary loading state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Simulate local loading" }).click();
  await expect(page.getByRole("status", { name: "Loading local catalogue preview" })).toBeVisible();
  await capture(page, "catalogue-390x844-full-loading.png", true);
});

test("captures the editor's preserved local error and the open modal state at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = page.getByRole("textbox", { name: "Synthetic paragraph draft" });
  await page.getByRole("checkbox", { name: "Fail the next save once" }).check();
  await editor.fill("Unsaved local draft retained after the synthetic failure.");
  await expect(page.getByText("Synthetic save failed. Your draft is still here; edit or blur to retry.")).toBeVisible();
  await expect(editor).toHaveValue("Unsaved local draft retained after the synthetic failure.");
  await capture(page, "catalogue-390x844-editor-error.png");
  await page.locator("[data-modal-opener]").evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("dialog", { name: "Component sample" })).toBeVisible();
  await capture(page, "catalogue-390x844-modal-editor-error.png", true);
});
