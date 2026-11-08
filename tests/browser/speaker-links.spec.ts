import { test, expect, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 180_000 });
const base = "/PWA-AI-Meeting-Memo-BYOK/";
const endpoint = "https://api.openai.com/v1/audio/transcriptions";
const fakeKey = "synthetic-speaker-links-key";

type ChunkMeta = { index: number; ownStartSeconds: number; ownDurationSeconds: number; leadInSeconds: number };
type Manifest = { chunks: ChunkMeta[] };

function syntheticMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const bytes = Buffer.alloc(63_000 * frame.length);
  for (let offset = 0; offset < bytes.length; offset += frame.length) frame.copy(bytes, offset);
  return bytes;
}

async function prepare(page: Page) {
  await page.goto(base);
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Speaker overlap links");
  await dialog.getByLabel("Audio recording").setInputFiles({ name: "speaker-links.mp3", mimeType: "audio/mpeg", buffer: syntheticMp3() });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByRole("heading", { name: "Speaker overlap links", exact: true })).toBeVisible();
  const meetingHash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page.getByLabel("OpenAI API key", { exact: true }).fill(fakeKey);
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("button", { name: "Saved on this device" })).toBeVisible();
  await page.evaluate((hash) => { location.hash = hash; }, meetingHash);
  await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
}

async function readManifest(page: Page): Promise<Manifest> {
  return page.evaluate(async () => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const meetings = await new Promise<Array<{ id: string; title: string }>>((resolve, reject) => {
      const transaction = database.transaction("meetings", "readonly");
      const get = transaction.objectStore("meetings").getAll();
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    const meeting = meetings.find((item) => item.title === "Speaker overlap links");
    if (!meeting) throw new Error("Meeting fixture not found");
    const manifest = await new Promise<Manifest>((resolve, reject) => {
      const transaction = database.transaction("audioManifests", "readonly");
      const get = transaction.objectStore("audioManifests").get(meeting.id);
      get.onsuccess = () => resolve(get.result as Manifest);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return manifest;
  });
}

function installSpeechRoute(page: Page) {
  let manifest: Manifest;
  let requestCount = 0;
  const ready = page.route(endpoint, async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${fakeKey}`);
    if (!manifest) throw new Error("Chunk manifest was not loaded before transcription");
    const index = requestCount++;
    const current = manifest.chunks[index];
    if (!current) throw new Error(`Missing chunk ${index}`);
    const segments: { text: string; start: number; end: number; speaker: string }[] = [];
    const addOverlap = (boundaryIndex: number, absoluteStart: number, localStart: number) => {
      for (let word = 0; word < 8; word += 1) {
        const start = localStart + word * 0.4;
        segments.push({ text: `overlap${boundaryIndex}word${word}`, start, end: start + 0.2, speaker: `part-${index}` });
      }
      expect(absoluteStart).toBeGreaterThanOrEqual(0);
    };
    if (index > 0) {
      const previousBoundary = current.ownStartSeconds - current.leadInSeconds;
      addOverlap(index - 1, previousBoundary, 0.5);
    }
    const next = manifest.chunks[index + 1];
    if (next) {
      const absoluteStart = next.ownStartSeconds - next.leadInSeconds + 0.5;
      const localStart = absoluteStart - current.ownStartSeconds + current.leadInSeconds;
      addOverlap(index, absoluteStart, localStart);
    }
    await route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: { segments, duration: current.ownDurationSeconds + current.leadInSeconds },
    });
  });
  return {
    ready,
    setManifest(value: Manifest) { manifest = value; },
  };
}

test("overlap links merge as one undoable group and manual selection merges independently", async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort());
  const route = installSpeechRoute(page);
  await route.ready;
  await prepare(page);
  const manifest = await readManifest(page);
  expect(manifest.chunks.length).toBeGreaterThan(1);
  route.setManifest(manifest);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const totalText = await dialog.getByText(/recording parts/).textContent();
  const total = Number(totalText?.match(/\d+/)?.[0]);
  await dialog.getByRole("button", { name: `Confirm and send ${total} requests` }).click();
  await expect(page.getByRole("heading", { name: "Suggested same-speaker links from overlapping audio" })).toBeVisible();
  await expect(page.getByText("8 matching words across the part overlap").first()).toBeVisible();
  await expect(page.getByText(/Speakers are numbered per part/)).toBeVisible();
  const names = page.locator(".playback-speaker");
  const originalCount = await names.count();
  expect(originalCount).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Merge all suggested groups" }).click();
  await expect(names).toHaveCount(1);
  await expect(page.getByText("Speakers merged. Use Undo to restore them.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(names).toHaveCount(originalCount);

  await expect(page.getByRole("heading", { name: "Suggested same-speaker links from overlapping audio" })).toBeVisible();
  await page.getByRole("button", { name: "Not the same" }).click();
  await expect(page.getByRole("heading", { name: "Suggested same-speaker links from overlapping audio" })).toBeHidden();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.getByRole("heading", { name: "Suggested same-speaker links from overlapping audio" })).toBeVisible();
  await page.locator(".speaker-mode-switch").getByRole("button", { name: "Edit speakers" }).click();
  const checkboxes = page.locator(".speaker-review-card input[type=checkbox]");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "Merge selected" }).click();
  const mergeDialog = page.getByRole("dialog");
  await mergeDialog.getByLabel("Keep this speaker's name").selectOption({ index: 0 });
  await mergeDialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.locator(".speaker-review-card")).toHaveCount(originalCount - 1);
});
