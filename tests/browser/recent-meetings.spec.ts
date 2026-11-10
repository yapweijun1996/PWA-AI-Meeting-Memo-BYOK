import { test, expect, type Page } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });

async function seedMeetings(page: Page) {
  await page.goto("./");
  await expect(page.locator(".sidebar-recent")).toBeVisible();
  const meetings = Array.from({ length: 5 }, (_, index) => ({
    ...sampleMeeting(),
    id: crypto.randomUUID(),
    title: index === 4 ? "A very long meeting title for quarterly planning and coordination" : `Meeting ${index + 1}`,
    updatedAt: `2026-11-0${index + 1}T10:00:00.000Z`,
  }));
  await page.evaluate(async (items) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("meetings", "readwrite");
      items.forEach((item) => tx.objectStore("meetings").put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, meetings);
  await page.reload();
  return meetings;
}

test("recent meetings expose full titles and open the full library", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const meetings = await seedMeetings(page);
  const sidebar = page.locator("aside.sidebar");
  const entries = sidebar.locator(".sidebar-recent-list a");
  await expect(entries).toHaveCount(4);
  await expect(entries.first()).toContainText(meetings[4].title);
  await expect(entries.last()).toContainText("Meeting 2");
  await page.setViewportSize({ width: 1280, height: 520 });
  await expect.poll(() => sidebar.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect(sidebar.getByRole("button", { name: "View all meetings" })).toBeInViewport();
  await expect(sidebar.getByRole("button", { name: "Check for updates" })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 600 });
  await entries.first().focus();
  await expect(page.getByRole("tooltip")).toHaveText(meetings[4].title);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await entries.first().click();
  await expect(entries.first()).toHaveAttribute("aria-current", "page");
  await sidebar.getByRole("button", { name: "View all meetings" }).click();
  await expect(page.getByRole("heading", { name: "Your meetings" })).toBeVisible();
  await expect(page.locator(".meeting-card")).toHaveCount(5);
  await expect.poll(() => sidebar.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
});

test("selecting the current recent meeting closes the mobile drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMeetings(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const sidebar = page.locator("aside.sidebar");
  await sidebar.locator(".sidebar-recent-list a").first().click();
  await expect(sidebar).not.toHaveClass(/open/);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await sidebar.locator(".sidebar-recent-list a").first().click();
  await expect(sidebar).not.toHaveClass(/open/);
});
