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
test("keys stay in session memory and clear on reload", async ({ page }) => {
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

test("full backup restores as a new copy without replacing the original", async ({
  page,
}, testInfo) => {
  await page.goto(base);
  await create(page, "Backup round trip");
  await page.getByText("Export", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Full backup with audio" }).click();
  const file = await download,
    path = testInfo.outputPath("meeting.zip");
  await file.saveAs(path);
  page.on("dialog", (d) => void d.accept());
  await page.locator(".nav-file input").setInputFiles(path);
  await expect(
    page.getByRole("heading", {
      name: "Backup round trip (restored)",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(
    page.getByText("Review the current stock process.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "All meetings", exact: true }).click();
  await expect(page.locator(".meeting-card")).toHaveCount(2);
});

test("scoped worker supports offline reload without caching API data", async ({
  page,
  context,
}) => {
  await page.goto(base);
  await create(page, "Offline review");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Offline review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Review the current stock process.", { exact: true }),
  ).toBeVisible();
  const cached = await page.evaluate(async () => {
    const result: string[] = [];
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys())
        result.push(request.url);
    }
    return result;
  });
  expect(
    cached.every((url) => url.startsWith("http://127.0.0.1:4180" + base)),
  ).toBe(true);
  expect(
    cached.some(
      (url) =>
        url.includes("openai") ||
        url.includes("deepgram") ||
        url.includes("openrouter"),
    ),
  ).toBe(false);
  await context.setOffline(false);
});

test("stale tab edits are rejected without losing the unsaved form text", async ({
  page,
  context,
}) => {
  await page.goto(base);
  await create(page, "Two tab review");
  const other = await context.newPage();
  await other.goto(page.url());
  await other
    .getByRole("button", { name: "Edit passage", exact: true })
    .first()
    .click();
  await other.getByLabel("Transcript text").fill("Unsaved second-tab text");
  await page
    .getByRole("button", { name: "Edit passage", exact: true })
    .first()
    .click();
  await page.getByLabel("Transcript text").fill("Winning first-tab text");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(
    page.getByText("Winning first-tab text", { exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Save correction" }).click();
  await expect(other.getByRole("dialog").getByRole("alert")).toContainText(
    "another tab",
  );
  await expect(other.getByLabel("Transcript text")).toHaveValue(
    "Unsaved second-tab text",
  );
  await other.close();
});

test("quota failure is visible and preserves an unsaved correction", async ({
  page,
}) => {
  await page.goto(base);
  await create(page, "Quota review");
  await page
    .getByRole("button", { name: "Edit passage", exact: true })
    .first()
    .click();
  await page.getByLabel("Transcript text").fill("Keep this unsaved correction");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "quota",
  );
  await expect(page.getByLabel("Transcript text")).toHaveValue(
    "Keep this unsaved correction",
  );
});

test("bulk reassignment, merge and split expose their scope and support undo", async ({
  page,
}) => {
  await page.goto(base);
  await create(page, "Speaker correction flow");
  page.on("dialog", (d) => void d.accept());
  await page.getByLabel("Select passage 1", { exact: true }).check();
  await page
    .getByLabel("Assign selected passages", { exact: true })
    .selectOption({ label: "Alex" });
  await page.getByRole("button", { name: "Preview & assign" }).click();
  await expect(
    page.locator(".passage").first().locator(".passage-meta strong"),
  ).toHaveText("Alex");
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await page
    .getByRole("button", { name: "Merge…", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Confirm merge", exact: true })
    .click();
  await expect(page.locator(".speaker-card")).toHaveCount(1);
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page
    .getByRole("button", { name: "Split", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Split passage", exact: true })
    .click();
  await expect(page.locator(".passage")).toHaveCount(3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".passage")).toHaveCount(2);
});
