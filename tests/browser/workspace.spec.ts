import { test, expect, type Page } from "@playwright/test";
const base = "/PWA-AI-Meeting-Memo-BYOK/";
async function create(page: Page, title = "ERP review") {
  await page
    .getByRole("button", { name: "New meeting", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill(title);
  await dialog.getByText("Start from a transcript instead").click();
  await dialog
    .getByLabel("Transcript", { exact: true })
    .fill(
      "Jamie: Review the current stock process.\nAlex: Finance needs to confirm the rule.",
    );
  await dialog
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
test("local review, corrections, undo, speaker confirmation and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await create(page);
  await expect(
    page.getByText("Review the current stock process.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit passage", exact: true })
    .first()
    .click();
  await page.getByLabel("Transcript text").fill("Corrected inventory process.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(
    page.getByText("Corrected inventory process.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByText("Review the current stock process.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await page
    .getByRole("button", { name: "Confirm name", exact: true })
    .first()
    .click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("keys are session-only and do not enter local data or JSON exports", async ({
  page,
}) => {
  await page.goto(`${base}#/settings`);
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("fixture-secret-do-not-persist");
  await page.getByRole("button", { name: "Save session keys" }).click();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fixture-secret",
  );
  await page.reload();
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "",
  );
});
test("responsive navigation and dialogs do not overflow on a phone-sized viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Your meetings." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await expect(page.getByRole("heading", { name: "Settings." })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
