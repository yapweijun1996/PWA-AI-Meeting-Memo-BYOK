import { test, expect } from "@playwright/test";
const base = "/PWA-AI-Meeting-Memo-BYOK/";

test("imports long MP3 locally, reloads it, and deletes its chunks with the meeting", async ({ page }) => {
  const outgoing: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1") && !request.url().startsWith("http://localhost")) outgoing.push(request.url());
  });
  await page.goto(base);
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Long recording browser test");
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const bytes = Buffer.alloc(61_000 * frame.length);
  for (let offset = 0; offset < bytes.length; offset += frame.length) frame.copy(bytes, offset);
  await dialog.getByLabel("Audio recording").setInputFiles({ name: "meeting.mp3", mimeType: "audio/mpeg", buffer: bytes });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByRole("heading", { name: "Long recording browser test" })).toBeVisible();
  await expect(page.getByText(/Long recording stored in \d+ parts/)).toBeVisible();
  expect(outgoing).toEqual([]);
  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const chunks = await new Promise<number>((resolve, reject) => {
      const request = db.transaction("audioChunks").objectStore("audioChunks").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return chunks;
  });
  expect(count).toBeGreaterThan(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Long recording browser test" })).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Delete meeting" }).click();
  await expect(page.getByRole("heading", { name: "Long recording browser test" })).toBeHidden();
  const remaining = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction("audioChunks").objectStore("audioChunks").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count;
  });
  expect(remaining).toBe(0);
});
