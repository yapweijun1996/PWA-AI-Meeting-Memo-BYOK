import { test, expect, type Page } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { readFile } from "node:fs/promises";

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 120_000 });
test.beforeEach(async ({ context }) => {
  await context.route("https://**/*", (route) => route.abort());
});
const base = "/PWA-AI-Meeting-Memo-BYOK/";
const endpoint = "https://api.openai.com/v1/audio/transcriptions";
const fakeKey = "synthetic-chunked-speech-key";

function syntheticMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const bytes = Buffer.alloc(63_000 * frame.length);
  for (let offset = 0; offset < bytes.length; offset += frame.length) frame.copy(bytes, offset);
  return bytes;
}

async function prepare(page: Page, title: string) {
  await page.goto(base);
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill(title);
  await dialog.getByLabel("Audio recording").setInputFiles({
    name: "long-meeting.mp3",
    mimeType: "audio/mpeg",
    buffer: syntheticMp3(),
  });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const meetingHash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page.getByLabel("OpenAI API key", { exact: true }).fill(fakeKey);
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("button", { name: "Saved on this device" })).toBeVisible();
  await page.evaluate((hash) => { location.hash = hash; }, meetingHash);
  await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
}

function installSpeechRoute(page: Page, options: {
  failOn?: number;
  abortOn?: number;
} = {}) {
  let count = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const finished = page.route(endpoint, async (route) => {
    count += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      expect(route.request().headers().authorization).toBe(`Bearer ${fakeKey}`);
      if (count === options.abortOn) {
        await route.abort();
        return;
      }
      if (count === options.failOn) {
        await route.fulfill({ status: 400, json: { error: { param: "file", message: "Synthetic provider failure" } } });
        return;
      }
      await route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: { segments: [{ text: `CHUNK_RESULT_${count}`, start: 12, end: 13 }], duration: 600 },
      });
    } finally {
      inFlight -= 1;
    }
  });
  return { finished, get count() { return count; }, get maxInFlight() { return maxInFlight; } };
}

test("without cross-tab locks, opting into voice analysis sends nothing and transcription can continue without it", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }));
  const routes = installSpeechRoute(page);
  await routes.finished;
  await prepare(page, "Voice lock unavailable");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("group", { name: "Automatic speaker continuity" }).getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /^Confirm and send \d+ requests$/ }).click();
  await expect(page.getByText("Local voice analysis requires browser support for cross-tab locking. Use a supported browser or continue without voice analysis.")).toBeVisible();
  expect(routes.count).toBe(0);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("group", { name: "Automatic speaker continuity" }).getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: /^Confirm and send \d+ requests$/ }).click();
  await expect(page.getByText("CHUNK_RESULT_1", { exact: true })).toBeVisible();
  expect(routes.count).toBeGreaterThanOrEqual(2);
});

test("chunked transcription confirms before sequential per-part requests and merges timestamps", async ({ page }) => {
  const routes = installSpeechRoute(page);
  await routes.finished;
  await prepare(page, "Chunked transcription success");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/^\d+ recording parts$/)).toBeVisible();
  await expect(dialog.getByText(/Total estimate: Unknown|Total estimate: US\$/)).toBeVisible();
  await expect(dialog).toContainText("sent one after another with your key");
  await expect(dialog).toContainText("nothing is retried automatically");
  expect(routes.count).toBe(0);
  const totalText = await dialog.getByText(/^\d+ recording parts$/).textContent();
  const total = Number(totalText?.match(/\d+/)?.[0]);
  expect(total).toBeGreaterThanOrEqual(2);
  await dialog.getByRole("button", { name: `Confirm and send ${total} requests` }).click();
  await expect(page.getByText("CHUNK_RESULT_1", { exact: true })).toBeVisible();
  await expect(page.getByText(`CHUNK_RESULT_${total}`, { exact: true })).toBeVisible();
  expect(routes.count).toBe(total);
  expect(routes.maxInFlight).toBe(1);
  const timestamps = await page.locator(".time-link").allTextContents();
  const seconds = timestamps.map((text) => {
    const values = text.match(/\d+/g)?.map(Number) ?? [];
    return values.length >= 2 ? values[0] * 60 + values[1] : 0;
  });
  expect(seconds.length).toBeGreaterThanOrEqual(2);
  expect(seconds.at(-1)).toBeGreaterThan(seconds[0]);
  await page.locator(".history-panel summary").click();
  await expect(page.getByText(/Part 1\/\d+/)).toBeVisible();
});

for (const restore of [false, true]) {
test(restore ? "restored transcription resumes only unsaved parts after reattachment" : "chunked transcription stops after a failed part and resumes only unsaved parts", async ({ page }, info) => {
  const routes = installSpeechRoute(page, { failOn: 2 });
  await routes.finished;
  await prepare(page, "Chunked transcription failure");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const totalText = await dialog.getByText(/^\d+ recording parts$/).textContent();
  const total = Number(totalText?.match(/\d+/)?.[0]);
  await dialog.getByRole("button", { name: `Confirm and send ${total} requests` }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Provider returned HTTP 400/ })).toBeVisible();
  await expect.poll(() => routes.count).toBe(2);
  // Parts are merged into the transcript only after every part is saved.
  await expect(page.getByText("CHUNK_RESULT_1", { exact: true })).toHaveCount(0);
  const resume = page.getByRole("button", { name: `Resume transcription (1 of ${total} parts done)` });
  if (restore) {
    await expect(resume).toBeEnabled();
    await page.getByText("Export", { exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Full backup with audio", exact: true }).click();
    const path = info.outputPath("resume.zip");
    await (await download).saveAs(path);
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Restore backup", { exact: true }).setInputFiles(path);
    await expect(page.getByRole("heading", { name: "Chunked transcription failure (restored)", exact: true })).toBeVisible();
    await page.getByLabel("Attach audio", { exact: true }).setInputFiles({ name: "long-meeting.mp3", mimeType: "audio/mpeg", buffer: syntheticMp3() });
    await expect(resume).toBeEnabled();
    expect(routes.count).toBe(2);
  }
  await page.reload();
  await expect(resume).toBeEnabled();
  await resume.click();
  const resumeDialog = page.getByRole("dialog");
  await expect(resumeDialog.getByRole("button", { name: `Confirm and send ${total - 1} requests` })).toBeEnabled();
  await resumeDialog.getByRole("button", { name: `Confirm and send ${total - 1} requests` }).click();
  await expect(page.getByText(`CHUNK_RESULT_${total + 1}`, { exact: true })).toBeVisible();
  expect(routes.count).toBe(total + 1);
  expect(routes.maxInFlight).toBe(1);
});
}

for (const restore of [false, true]) {
test(`unknown chunk outcomes require account review before an explicit resend (restore: ${restore})`, async ({ page }, info) => {
  const routes = installSpeechRoute(page, { abortOn: 1 });
  await routes.finished;
  await prepare(page, "Chunked transcription unknown outcome");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const totalText = await dialog.getByText(/^\d+ recording parts$/).textContent();
  const total = Number(totalText?.match(/\d+/)?.[0]);
  await dialog.getByRole("button", { name: `Confirm and send ${total} requests` }).click();
  await expect.poll(() => routes.count).toBe(1);
  if (restore) {
    await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
    await page.getByText("Export", { exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Full backup with audio", exact: true }).click();
    const path = info.outputPath("unknown.zip"); await (await download).saveAs(path);
    page.on("dialog", dialog => dialog.accept());
    await page.getByLabel("Restore backup", { exact: true }).setInputFiles(path);
    await expect(page.getByRole("heading", { name: "Chunked transcription unknown outcome (restored)", exact: true })).toBeVisible();
    await page.getByLabel("Attach audio", { exact: true }).setInputFiles({ name: "long-meeting.mp3", mimeType: "audio/mpeg", buffer: syntheticMp3() });
    // Metadata is already visible before the async reattachment is published.
    await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
  }
  await page.reload();
  expect(routes.count).toBe(1);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  const resumeDialog = page.getByRole("dialog");
  const review = resumeDialog.getByLabel("I checked my provider account for part 1 and want to send it again");
  await expect(review).not.toBeChecked();
  await expect(resumeDialog.getByRole("button", { name: `Confirm and send ${total} requests` })).toBeDisabled();
  await review.check();
  await expect(resumeDialog.getByRole("button", { name: `Confirm and send ${total} requests` })).toBeEnabled();
  await resumeDialog.getByRole("button", { name: `Confirm and send ${total} requests` }).click();
  await expect(page.getByText("CHUNK_RESULT_2", { exact: true })).toBeVisible();
  expect(routes.count).toBe(total + 1);
  expect(routes.maxInFlight).toBe(1);
});

}

async function evidenceSnapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const request = database.transaction("meetings").objectStore("meetings").get(location.hash.split("/").at(-1)!);
      return await new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => {
          const { segments, history, undo, runs, memos, jobs, speakers, revision } = request.result;
          resolve({ segments, history, undo, runs, memos, jobs, speakers, revision });
        };
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

test("restored completed transcription blocks missing checkpoints before consent or another request", async ({ page }, info) => {
  const routes = installSpeechRoute(page); await routes.finished;
  await prepare(page, "Checkpoint backup");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Confirm and send \d+ requests$/ }).click();
  await expect(page.getByText("CHUNK_RESULT_2", { exact: true })).toBeVisible();
  const submitted = routes.count;
  await page.getByRole("button", { name: "Edit passage", exact: true }).first().click();
  await page.getByLabel("Transcript text").fill("Human corrected first passage.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Human corrected first passage.", { exact: true })).toBeVisible();
  const evidence = await evidenceSnapshot(page);
  await page.getByText("Export", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Full backup with audio", exact: true }).click();
  const path = info.outputPath("checkpoints.zip"); await (await download).saveAs(path);
  const files = unzipSync(await readFile(path));
  expect(files["chunk-speech.json"]).toBeDefined();
  delete files["chunk-speech.json"];
  page.on("dialog", dialog => dialog.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "older-checkpoints.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync(files)),
  });
  await expect(page.getByRole("heading", { name: "Checkpoint backup (restored)", exact: true })).toBeVisible();
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({ name: "long-meeting.mp3", mimeType: "audio/mpeg", buffer: syntheticMp3() });
  await expect(page.getByText(/plays from \d+ local parts/)).toBeVisible();
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(page.locator(".app-error")).toContainText("Completed transcription results are missing");
  expect(routes.count).toBe(submitted);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("CHUNK_RESULT_2", { exact: true })).toBeVisible();
  await expect(page.getByText("Human corrected first passage.", { exact: true })).toBeVisible();
  expect(await evidenceSnapshot(page)).toEqual(evidence);
  expect(routes.count).toBe(submitted);
});
