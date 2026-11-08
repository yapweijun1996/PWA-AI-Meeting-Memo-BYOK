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
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "audio/mpeg" }));
    const result = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 5000);
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve(Number.isFinite(audio.duration) && audio.duration > 0); };
      audio.onerror = () => { clearTimeout(timer); resolve(false); };
      audio.src = url;
    });
    URL.revokeObjectURL(url);
    audio.removeAttribute("src");
    return result;
  }, Array.from(bytes.subarray(0, 1_000_000)));
  test.skip(!decodes, `${browserName} cannot decode the synthetic MP3 probe; chunk switching remains covered by unit tests.`);

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
  const seek = async (time: number) => {
    await slider.evaluate((element, value) => {
      const input = element as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, time);
  };
  const secondPosition = manifest.chunks[1].ownStartSeconds + 2;
  await seek(secondPosition);
  // The range input rounds to its 0.1 step.
  await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(secondPosition, 0);
  await expect(page.locator(".player-time").first()).toHaveText(/\d+:\d{2}/);

  const boundary = manifest.chunks[0].ownStartSeconds + manifest.chunks[0].ownDurationSeconds;
  await seek(Math.max(0, boundary - 1.5));
  await page.getByLabel("Playback speed").selectOption("2");
  await page.getByRole("button", { name: "Play audio" }).click();
  await expect(page.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await expect.poll(async () => Number(await slider.inputValue()), { timeout: 12_000 }).toBeGreaterThan(boundary + 0.2);
  await expect(page.getByRole("button", { name: "Pause audio" })).toBeVisible();
});
