import { test, expect } from "@playwright/test";

const base = "/PWA-AI-Meeting-Memo-BYOK/";
const transcriptionEndpoint = "https://api.openai.com/v1/audio/transcriptions";
const syntheticKey = "synthetic-chunked-playback-key";

test.describe.configure({ timeout: 120_000 });
test.use({ serviceWorkers: "block" });

function syntheticMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const bytes = Buffer.alloc(63_000 * frame.length);
  for (let offset = 0; offset < bytes.length; offset += frame.length) frame.copy(bytes, offset);
  return bytes;
}

test("plays long local recordings across chunk boundaries", async ({ page, browserName }) => {
  const bytes = syntheticMp3();
  await page.goto(base);
  const decodes = await page.evaluate(async (data) => {
    if (typeof AudioContext === "undefined") return false;
    const context = new AudioContext();
    const bytes = new Uint8Array(data);
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    try {
      const decoded = await context.decodeAudioData(input);
      return decoded.duration > 0;
    } catch {
      return false;
    } finally {
      await context.close();
    }
  }, Array.from(bytes.subarray(0, 1_000_000)));
  test.skip(!decodes, `${browserName} cannot decode the synthetic MP3 window probe; window switching remains covered by unit tests.`);

  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Chunked playback test");
  await dialog.getByLabel("Audio recording").setInputFiles({
    name: "long-meeting.mp3",
    mimeType: "audio/mpeg",
    buffer: bytes,
  });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByRole("heading", { name: "Chunked playback test", exact: true })).toBeVisible();
  await expect(page.getByText(/This recording plays from \d+ local parts\./)).toBeVisible();
  const slider = page.getByRole("slider", { name: "Playback position" });
  await expect(slider).toBeVisible();
  await expect(page.locator("audio[src]")).toHaveCount(0);
  const meetingHash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page.getByLabel("OpenAI API key", { exact: true }).fill(syntheticKey);
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("button", { name: "Saved on this device" })).toBeVisible();
  await page.evaluate((hash) => { location.hash = hash; }, meetingHash);
  await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
  await page.route(transcriptionEndpoint, (route) => route.fulfill({
    headers: { "Access-Control-Allow-Origin": "*" },
    json: { segments: [{ text: "Synthetic timestamp sample", start: 12, end: 13 }], duration: 600 },
  }));
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  const sendButton = confirmation.getByRole("button", { name: /Confirm and send \d+ requests/ });
  await sendButton.click();
  const timestamp = page.locator(".time-link").first();
  await expect(timestamp).toBeVisible();
  await timestamp.click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(12, 1);
  await page.getByRole("button", { name: "Pause audio" }).click();

  const manifest = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<{ totalSeconds: number; chunks: Array<{ ownStartSeconds: number; ownDurationSeconds: number }> }>((resolve, reject) => {
      const request = db.transaction("audioManifests").objectStore("audioManifests").getAll();
      request.onsuccess = () => resolve(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  });
  expect(manifest.chunks.length).toBeGreaterThan(1);
  await expect(slider).toHaveAttribute("max", String(manifest.totalSeconds));
  const totalLabel = `${Math.floor(manifest.totalSeconds / 60)}:${String(Math.floor(manifest.totalSeconds % 60)).padStart(2, "0")}`;
  await expect(page.locator(".player-time").last()).toHaveText(totalLabel);
  // Real pointer clicks, as a listener would use. A range input maps x to value with the thumb's geometry, so allow 2% slack.
  const seekNear = async (time: number) => {
    const box = await slider.boundingBox();
    if (!box) throw new Error("The playback slider has no box.");
    await page.mouse.click(box.x + box.width * (time / manifest.totalSeconds), box.y + box.height / 2);
  };
  const slack = manifest.totalSeconds * 0.02;
  const secondPosition = manifest.chunks[1].ownStartSeconds + 30;
  await seekNear(secondPosition);
  await expect.poll(async () => Math.abs(Number(await slider.inputValue()) - secondPosition)).toBeLessThan(slack);
  await expect(page.locator(".player-time").first()).toHaveText(/\d+:\d{2}/);

  const boundary = manifest.chunks[0].ownStartSeconds + manifest.chunks[0].ownDurationSeconds;
  await seekNear(Math.max(0, boundary - 12));
  await expect.poll(async () => Math.abs(Number(await slider.inputValue()) - (boundary - 12))).toBeLessThan(slack);
  const before = Number(await slider.inputValue());
  await page.getByLabel("Playback speed").selectOption("2");
  await page.getByRole("button", { name: "Play audio" }).click();
  await expect(page.getByRole("button", { name: "Pause audio" })).toBeVisible();
  // Playing at 2x from at most ~slack seconds before the boundary must cross into the next part and keep advancing.
  await expect.poll(async () => Number(await slider.inputValue()), { timeout: 30_000 }).toBeGreaterThan(Math.max(boundary + 0.2, before + 1));
  await expect(page.getByRole("button", { name: "Pause audio" })).toBeVisible();
});
