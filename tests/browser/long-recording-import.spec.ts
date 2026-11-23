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
  await expect(page.getByText(/plays from \d+ local parts/)).toBeVisible();
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

function recording() {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const buffer = Buffer.alloc(61_000 * frame.length);
  for (let offset = 0; offset < buffer.length; offset += frame.length) frame.copy(buffer, offset);
  return { name: "recovery.mp3", mimeType: "audio/mpeg", buffer };
}
async function createLong(page: import("@playwright/test").Page) {
  await page.context().route("https://**/*", route => route.abort());
  await page.goto(base);
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Recording recovery");
  await dialog.getByLabel("Audio recording").setInputFiles(recording());
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByText(/plays from \d+ local parts/)).toBeVisible();
}

test("restored long recording accepts identical audio under the new meeting ID", async ({ page }, info) => {
  await createLong(page);
  await page.getByText("Export", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Meeting backup (long audio not included)", exact: true }).click();
  const path = info.outputPath("recording.zip");
  await (await download).saveAs(path);
  page.on("dialog", dialog => dialog.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles(path);
  await expect(page.getByRole("heading", { name: "Recording recovery (restored)", exact: true })).toBeVisible();
  await expect(page.getByText(/audio missing on this device/)).toBeVisible();
  await expect(page.getByText(/plays from \d+ local parts/)).toHaveCount(0);
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles(recording());
  await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
  await expect(page.getByText(/plays from \d+ local parts/)).toBeVisible();
  await expect(page.locator(".app-error")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
  await expect(page.getByText(/audio missing on this device/)).toHaveCount(0);
});

test("wrong reattachment preserves a damaged recording and its acoustic evidence", async ({ page }) => {
  await createLong(page);
  const retained = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("meeting-memo-byok-v1"); request.onsuccess = () => resolve(request.result); });
    const id = location.hash.split("/").at(-1)!;
    const tx = database.transaction(["audioChunks", "audioManifests", "acousticCheckpoints"], "readwrite");
    const manifest = await new Promise<unknown>(resolve => { const r = tx.objectStore("audioManifests").get(id); r.onsuccess = () => resolve(r.result); });
    tx.objectStore("audioChunks").delete([id, 1]);
    tx.objectStore("acousticCheckpoints").put({ sentinel: "preserve" }, id);
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    database.close();
    return manifest;
  });
  const different = recording(); different.buffer[20] = 42;
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles(different);
  await expect(page.locator(".app-error")).toContainText("Recording identity could not be verified");
  const actual = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("meeting-memo-byok-v1"); request.onsuccess = () => resolve(request.result); });
    const id = location.hash.split("/").at(-1)!;
    const tx = database.transaction(["audioChunks", "audioManifests", "acousticCheckpoints"]);
    const get = (store: string, key: IDBValidKey) => new Promise<unknown>(resolve => { const r = tx.objectStore(store).get(key); r.onsuccess = () => resolve(r.result); });
    const [manifest, chunk, acoustic] = await Promise.all([get("audioManifests", id), get("audioChunks", [id, 0]), get("acousticCheckpoints", id)]);
    database.close(); return { manifest, hasChunk: chunk instanceof ArrayBuffer, acoustic };
  });
  expect(actual.manifest).toEqual(retained);
  expect(actual.hasChunk).toBe(true);
  expect(actual.acoustic).toEqual({ sentinel: "preserve" });
});
