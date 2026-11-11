import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { planMp4Split, readMp4Chunk } from "../../src/audio/mp4-split";

test.use({ serviceWorkers: "block" });

// Synthetic 440 Hz AAC generated with FFmpeg; no real recording or provider call.
test("fragmented AAC becomes independently decodable, timed chunks", async ({ page }) => {
  const source = new Blob([await readFile("tests/fixtures/fragmented-aac.synthetic.m4a")], { type: "audio/mp4" });
  const plan = await planMp4Split(source, { targetSeconds: 5, maxBytes: 1_000_000 });
  expect(plan.chunks.length).toBeGreaterThan(1);
  expect(plan.totalSeconds).toBeGreaterThan(11.9);
  const payloads = await Promise.all(plan.chunks.map(async chunk => Buffer.from(await (await readMp4Chunk(source, plan, chunk.index)).arrayBuffer()).toString("base64")));
  await page.goto("./");
  const decoded = await page.evaluate(async (chunks) => {
    const context = new OfflineAudioContext(1, 44100, 44100);
    return Promise.all(chunks.map(async chunk => {
      const bytes = Uint8Array.from(atob(chunk), character => character.charCodeAt(0));
      const audio = await context.decodeAudioData(bytes.buffer);
      return { seconds: audio.duration, channels: audio.numberOfChannels };
    }));
  }, payloads);
  decoded.forEach((audio, index) => {
    expect(audio.channels).toBe(1);
    expect(Math.abs(audio.seconds - (plan.chunks[index]!.ownDurationSeconds + plan.chunks[index]!.leadInSeconds))).toBeLessThan(0.15);
  });
});

test("imports an over-limit fragmented recording locally and retains it after reload", async ({ page }) => {
  const outgoing: string[] = [];
  page.on("request", request => {
    if (!request.url().startsWith("http://127.0.0.1") && !request.url().startsWith("http://localhost")) outgoing.push(request.url());
  });
  const audio = await readFile("tests/fixtures/fragmented-aac.synthetic.m4a");
  // A legal free box brings the synthetic fixture over the long-import threshold.
  const padding = Buffer.alloc(24_000_001 - audio.length);
  padding.writeUInt32BE(padding.length, 0);
  padding.write("free", 4, "ascii");
  await page.goto("./");
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Fragmented AAC test");
  await dialog.getByLabel("Audio recording").setInputFiles({ name: "synthetic.m4a", mimeType: "audio/mp4", buffer: Buffer.concat([audio, padding]) });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByRole("heading", { name: "Fragmented AAC test" })).toBeVisible();
  await expect(page.getByText(/plays from \d+ local parts/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fragmented AAC test" })).toBeVisible();
  await expect(page.getByText(/plays from \d+ local parts/)).toBeVisible();
  expect(outgoing).toEqual([]);
});
