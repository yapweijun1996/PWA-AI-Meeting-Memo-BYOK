import { expect, type Page } from "@playwright/test";

export async function changeTopbarLanguage(page: Page, language: string) {
  await page.locator(".topbar-language > button").click();
  await page
    .locator(`[role="menuitemradio"][data-choice-value="${language}"]`)
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}
