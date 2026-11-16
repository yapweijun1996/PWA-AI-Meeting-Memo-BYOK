import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });

async function seedMeeting(page: Page, title: string) {
  await page.goto("./");
  await expect(page.locator(".sidebar-recent")).toBeVisible();
  const meeting = { ...sampleMeeting(), id: crypto.randomUUID(), title };
  await page.evaluate(async (item) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("meetings", "readwrite");
      tx.objectStore("meetings").put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, meeting);
  return meeting;
}

async function storedSnapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const counts: Record<string, number> = {};
    for (const name of Array.from(db.objectStoreNames)) {
      counts[name] = await new Promise<number>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return counts;
  });
}

test("settings storage monitor lists meetings with their size and changes nothing", async ({ page }) => {
  const meeting = await seedMeeting(page, "Storage monitor fixture");
  await page.goto("./#/settings");
  const panel = page.getByRole("region", { name: "Storage monitor" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Meeting document")).toHaveCount(0);
  const before = await storedSnapshot(page);

  await panel.getByRole("button", { name: "Scan storage" }).click();
  await expect(panel.getByRole("button", { name: "Scan again" })).toBeVisible();
  const row = panel.locator(".storage-meetings > li", { hasText: meeting.title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/Meeting document \d+(\.\d)? (B|KB|MB) \(\d+% of the limit\)/);
  await expect(panel).toContainText("limited to 64.0 MB");
  // The composition of the meeting document is available on request.
  await row.getByText("What is in the meeting document").click();
  await expect(row.getByText("Transcript passages")).toBeVisible();
  await expect(row.getByText("Undo copies")).toBeVisible();
  const meter = row.getByRole("meter");
  await expect(meter).toHaveAttribute("aria-valuemax", String(64 * 1024 * 1024));
  expect(Number(await meter.getAttribute("aria-valuenow"))).toBeGreaterThan(100);

  // Read-only: no record was added or removed.
  expect(await storedSnapshot(page)).toEqual(before);
  await expect(page.getByText(/Provider keys are not read|provider keys are not read/)).toBeVisible();

  const results = await new AxeBuilder({ page }).include(".storage-report").analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});

test("settings storage monitor follows the display language", async ({ page }) => {
  await seedMeeting(page, "存储监控示例");
  await page.goto("./#/settings");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  const panel = page.getByRole("region", { name: "存储监控" });
  await panel.getByRole("button", { name: "扫描存储" }).click();
  await expect(panel.locator(".storage-meetings > li", { hasText: "存储监控示例" })).toContainText(/会议文档 \d+(\.\d)? (B|KB|MB)/);
});
