import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("new meeting sources and actions remain usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("./");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator("aside.sidebar").getByRole("button", { name: "New meeting", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make space for a new meeting" });
  await expect(dialog.getByLabel("Meeting title")).toBeFocused();
  const audio = dialog.getByLabel("Audio recording");
  await audio.focus();
  await expect(audio).toBeFocused();
  await audio.setInputFiles({ name: "sample.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("sample") });
  await expect(dialog.getByText("sample.mp3")).toBeVisible();
  await dialog.getByText("Start from a transcript instead").click();
  await expect(dialog.getByLabel("Transcript", { exact: true })).toBeVisible();
  await dialog.getByText("Meeting context", { exact: false }).click();
  await expect(dialog.getByLabel("Meeting type")).toBeVisible();
  await dialog.getByRole("button", { name: "Create meeting" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Create meeting" })).toBeInViewport();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("date is unambiguous and invalid timezones cannot create a meeting", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "New meeting", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Make space for a new meeting" });
  await dialog.getByLabel("Meeting title").fill("Calendar check");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-10");
  await expect(dialog.locator("#meeting-date-description")).toHaveText("November 10, 2026");
  await expect(dialog.locator('#meeting-timezones option[value="UTC"]')).toHaveCount(1);
  const timezone = dialog.getByLabel("Timezone", { exact: true });
  await timezone.fill("Invalid/Timezone");
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a valid timezone");
  await expect(dialog.getByLabel("Meeting title")).toHaveValue("Calendar check");
  await timezone.fill("UTC");
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Calendar check" })).toBeVisible();
  const stored = await page.evaluate(() => new Promise<{ date: string; timezone: string }>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("meetings").objectStore("meetings").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => { resolve(read.result.find((meeting) => meeting.title === "Calendar check")); db.close(); };
    };
  }));
  expect(stored).toMatchObject({ date: "2026-11-10", timezone: "UTC" });
});
