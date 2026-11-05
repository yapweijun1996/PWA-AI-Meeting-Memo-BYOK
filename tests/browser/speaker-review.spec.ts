import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const base = "/PWA-AI-Meeting-Memo-BYOK/";
const speakerIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];
const firstSegmentId = "10000000-0000-4000-8000-000000000001";

function fixtureMeeting() {
  const now = "2026-11-05T00:00:00.000Z";
  const segment = (
    id: string,
    start: number | null,
    end: number | null,
    speakerIdsForSegment: string[],
    text: string,
  ) => ({
    id,
    revision: 1,
    start,
    end,
    speakerIds: speakerIdsForSegment,
    originalText: text,
    text,
    reviewed: false,
    parents: [],
  });
  return {
    schemaVersion: 1,
    version: 0,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Imported speaker review fixture",
    date: "2026-11-05",
    timezone: "UTC",
    languages: "English",
    attendees: [],
    glossary: "",
    kind: "general",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    synthetic: true,
    referenceVideo: null,
    speakers: [
      { id: speakerIds[0], name: "Speaker 1", confirmed: false, sourceLabels: ["fixture"] },
      { id: speakerIds[1], name: "Speaker 2", confirmed: false, sourceLabels: ["fixture"] },
    ],
    segments: [
      segment(firstSegmentId, 0.1, 0.7, [speakerIds[0]], "The first speaker opens the review with a longer sentence."),
      segment("10000000-0000-4000-8000-000000000002", 0.7, 1.4, [speakerIds[0]], "The opening turn continues with useful context."),
      segment("10000000-0000-4000-8000-000000000003", 1.4, 1.9, [speakerIds[1]], "The second speaker answers the question."),
      segment("10000000-0000-4000-8000-000000000004", 1.9, 2.2, [speakerIds[0], speakerIds[1]], "The two attributed speakers overlap briefly."),
      segment("10000000-0000-4000-8000-000000000005", null, null, [speakerIds[0]], "This passage has no trustworthy timing."),
    ],
    history: [],
    undo: [],
    memos: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        createdAt: now,
        sourceRevision: 1,
        model: "fixture-model",
        items: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            type: "summary",
            text: "Human reviewed summary",
            ownerId: null,
            dueDate: null,
            dueOriginal: null,
            sources: [{ id: firstSegmentId, revision: 1 }],
            review: "accepted",
            reviewedRevision: 1,
          },
        ],
        originalItems: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            type: "summary",
            text: "Original generated summary",
            ownerId: null,
            dueDate: null,
            dueOriginal: null,
            sources: [{ id: firstSegmentId, revision: 1 }],
            review: "accepted",
            reviewedRevision: 1,
          },
        ],
      },
    ],
    jobs: [],
    audio: null,
    runs: [],
  };
}

function wavFile(seconds = 40) {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function createFixture(page: Page, audioName = "speaker-review.wav") {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      this.dataset.testPlaying = "true";
      this.dataset.testPaused = "false";
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      this.dataset.testPlaying = "false";
      this.dataset.testPaused = "true";
      this.dispatchEvent(new Event("pause"));
    };
  });
  await page.goto(base);
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title", { exact: true }).fill("Speaker UI fixture");
  await dialog.getByText("Start from a transcript instead").click();
  await dialog.getByLabel("Transcript", { exact: true }).fill(JSON.stringify(fixtureMeeting()));
  await dialog.getByRole("button", { name: "Create meeting", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Speaker UI fixture", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({
    name: audioName,
    mimeType: audioName.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
    buffer: wavFile(),
  });
  await expect(page.locator(".recording-info")).toContainText(audioName);
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.locator("audio").evaluate((element) => {
    try {
      Object.defineProperty(element, "duration", {
        configurable: true,
        value: 40,
      });
    } catch {
      // WebKit may expose a non-configurable media duration; the UI still gets
      // its real-time events below and the assertion remains bounded.
    }
    element.dispatchEvent(new Event("loadedmetadata", { bubbles: true }));
  });
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.locator(".speaker-review-card")).toHaveCount(2);
}

async function storedMeeting(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open("meeting-memo-byok-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction("meetings", "readonly").objectStore("meetings").getAll();
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            db.close();
            resolve(read.result.at(-1));
          };
        };
      }),
  );
}

async function seedMemoFixture(page: Page) {
  const memo = fixtureMeeting().memos[0];
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("meeting-memo-byok-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("meetings", "readwrite");
          const store = tx.objectStore("meetings");
          const read = store.getAll();
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const meeting = read.result.at(-1);
            if (!meeting) {
              reject(new Error("fixture meeting was not saved"));
              return;
            }
            meeting.memos = [value];
            store.put(meeting);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    memo,
  );
}

function sourceSnapshot(meeting: unknown) {
  const value = meeting as Record<string, unknown> | undefined;
  return JSON.stringify({
    speakers: value?.speakers,
    segments: value?.segments,
    history: value?.history,
    runs: value?.runs,
    memos: value?.memos,
  });
}

function parseRange(text: string | null) {
  const values = [...(text || "").matchAll(/(\d+):(\d{2})/g)].map((match) => Number(match[1]) * 60 + Number(match[2]));
  return { start: values[0] ?? 0, end: values[1] ?? 0 };
}

test("speaker review offers long samples and explicit overlap/gap activity", async ({ page }) => {
  await createFixture(page);
  await expect(page.getByRole("button", { name: "Sample 1", exact: true }).first()).toBeEnabled();
  await expect(page.getByLabel("Sample length", { exact: true })).toHaveValue("20");
  const beforeListening = sourceSnapshot(await storedMeeting(page));
  const firstRange = parseRange(await page.locator(".speaker-sample-range").first().textContent());
  expect(firstRange.end - firstRange.start).toBeGreaterThanOrEqual(19);
  await page.getByLabel("Sample length", { exact: true }).selectOption("30");
  const longRange = parseRange(await page.locator(".speaker-sample-range").first().textContent());
  expect(longRange.end - longRange.start).toBeGreaterThanOrEqual(29);
  await expect(page.getByText("Range includes surrounding context; it may contain other voices.", { exact: true }).first()).toBeVisible();
  const audio = page.locator("audio");
  await page.getByRole("button", { name: "Sample 1", exact: true }).first().click();
  await expect(audio).toHaveAttribute("data-test-playing", "true");
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 30.2;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(audio).toHaveAttribute("data-test-paused", "true");
  expect(sourceSnapshot(await storedMeeting(page))).toBe(beforeListening);
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 2;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(page.locator('.speaker-stage-card[data-speaker-active="true"]')).toHaveCount(2);
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 2.6;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(page.locator('.speaker-stage-card[data-speaker-active="true"]')).toHaveCount(0);
  await expect(page.getByText("No attributed speaker at this position", { exact: true })).toBeVisible();
  await expect(page.getByText(/Some passages have no time/)).toBeVisible();
});

test("sample playback and name confirmation keep the identity review explicit", async ({ page }) => {
  await createFixture(page);
  await seedMemoFixture(page);
  await page.reload();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  const name = page.getByLabel("Name for speaker 1", { exact: true });
  const revisionBeforeWhitespace = (await storedMeeting(page) as { revision: number }).revision;
  await name.fill(" Speaker 1 ");
  const saveName = page.getByRole("button", { name: "Save name", exact: true }).first();
  await expect(saveName).toBeEnabled();
  await saveName.click();
  await expect(name).toHaveValue("Speaker 1");
  await expect(name).toHaveAttribute("data-unsaved-edit", "false");
  expect((await storedMeeting(page) as { revision: number }).revision).toBe(revisionBeforeWhitespace);
  const sample = page.getByRole("button", { name: "Sample 1", exact: true }).first();
  await expect(sample).toBeEnabled();
  await sample.click();
  await expect(page.getByText("Needs a name", { exact: true })).toHaveCount(2);
  await name.fill(" Alex ");
  await page.getByRole("button", { name: "Confirm name", exact: true }).first().click();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(1);
  await expect(name).toHaveValue("Alex");
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByText("Source details changed after these notes were generated.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "View current transcript", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate another version", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View current transcript", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Transcript/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.locator(".original-text").first().locator("summary").click();
  await expect(page.getByText("Original generated summary", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.getByLabel("Name for speaker 1", { exact: true })).toHaveValue("Speaker 1");
  await expect(page.getByText("Needs a name", { exact: true })).toHaveCount(2);
  await page.reload();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.getByLabel("Name for speaker 1", { exact: true })).toHaveValue("Speaker 1");
});

test("workspace actions and count labels explain their units", async ({ page }) => {
  await createFixture(page);
  await expect(page.getByRole("button", { name: "Edit meeting details", exact: true })).toHaveAttribute(
    "title",
    "Edit meeting details",
  );
  await expect(page.getByRole("button", { name: "Delete meeting", exact: true })).toHaveAttribute(
    "title",
    "Delete meeting and local recording",
  );
  await expect(page.getByRole("group", { name: "Recording details", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Transcript, \d+ passages/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Speakers, \d+ speakers/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Meeting notes, \d+ items/ })).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByRole("button", { name: "Generate meeting notes", exact: true })).toHaveAttribute(
    "title",
    "Creates a separate version; provider charges may apply.",
  );
});

test("filename video suggestion does not load YouTube until the user watches", async ({ page }) => {
  const youtubeRequests: string[] = [];
  page.on("request", (request) => {
    if (/youtube(?:-nocookie)?\.com|youtu\.be/i.test(request.url())) youtubeRequests.push(request.url());
  });
  await createFixture(page, "The State of Startups in 2026 [yslXlV2BP_Y].mp3");
  await page.getByRole("button", { name: "Sample 1", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Use filename suggestion", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use filename suggestion", exact: true }).click();
  await expect(page.getByLabel("YouTube URL", { exact: true })).toHaveValue(/yslXlV2BP_Y/);
  expect(youtubeRequests).toEqual([]);
  await page.getByLabel("Audio-to-video offset (seconds)", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  await expect(page.getByRole("button", { name: "Watch this sample", exact: true })).toBeEnabled();
  await page.route("https://www.youtube-nocookie.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>fixture</title>" });
  });
  await page.getByRole("button", { name: "Watch this sample", exact: true }).click();
  await expect(page.locator('iframe[title="Reference video"]')).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/yslXlV2BP_Y/);
  await expect(page.locator('iframe[title="Reference video"]')).toHaveAttribute("src", /start=5/);
  await expect(page.locator('iframe[title="Reference video"]')).toHaveAttribute("src", /end=\d+/);
  await expect(page.getByText("Reference video loaded", { exact: true })).toBeVisible();
  const lowerSample = page.locator(".speaker-review-card").nth(1).locator(".speaker-sample").first();
  await lowerSample.scrollIntoViewIfNeeded();
  const iframeBox = await page.locator('iframe[title="Reference video"]').boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(iframeBox).not.toBeNull();
  expect(iframeBox!.y).toBeGreaterThanOrEqual(0);
  expect(iframeBox!.y + iframeBox!.height).toBeLessThanOrEqual(viewportHeight);
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(page.locator('iframe[title="Reference video"]')).toHaveCount(0);
  await page.getByText("Export", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Meeting JSON (no audio)", exact: true }).click();
  const exported = await download;
  const exportedText = await exported.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of exportedText!) chunks.push(Buffer.from(chunk));
  const exportedMeeting = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exportedMeeting.referenceVideo).toEqual({
    youtubeId: "yslXlV2BP_Y",
    offsetSeconds: 5,
  });
  await page.reload();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.getByLabel("Audio-to-video offset (seconds)", { exact: true })).toHaveValue("5");
});

test("speaker review stays usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createFixture(page);
  const stage = page.locator(".speaker-stage");
  const box = await stage.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
  await page.getByLabel("Name for speaker 1", { exact: true }).focus();
  await expect(page.getByLabel("Name for speaker 1", { exact: true })).toBeFocused();
});
