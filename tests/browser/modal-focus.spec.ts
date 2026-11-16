import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("NewMeeting restores its keyboard opener after Escape and visible close", async ({ page }) => {
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
  const opener = page.locator("main").getByRole("button", { name: /^(New meeting|Create your first meeting)$/ });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Make space for a new meeting" });
  await expect(dialog.getByLabel("Meeting title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Meeting title")).toBeFocused();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Help restores the keyboard opener without a marked initial target", async ({ page }) => {
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
  const opener = page.locator("#app-sidebar").getByRole("button", { name: "How it works" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "A little clarity, step by step" });
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
