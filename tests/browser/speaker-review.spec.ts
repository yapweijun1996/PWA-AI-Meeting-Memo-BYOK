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

function longFixtureMeeting() {
  const baseMeeting = fixtureMeeting();
  const longSegments = Array.from({ length: 120 }, (_, index) => {
    const start = 4 + index * 0.27;
    return {
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      revision: 1,
      start,
      end: start + 0.2,
      speakerIds: [speakerIds[index % 2]],
      originalText: `Long caption ${index + 1}`,
      text: `Long caption ${index + 1}`,
      reviewed: false,
      parents: [],
    };
  });
  return { ...baseMeeting, segments: [...baseMeeting.segments, ...longSegments] };
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

async function createFixture(
  page: Page,
  audioName = "speaker-review.wav",
  meeting = fixtureMeeting(),
) {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      Object.defineProperty(this, "ended", { configurable: true, value: false });
      this.dataset.testPlaying = "true";
      this.dataset.testPaused = "false";
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
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
  await dialog.getByLabel("Transcript", { exact: true }).fill(JSON.stringify(meeting));
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
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
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
  await expect(page.locator('.speaker-stage-card[data-speaker-active="true"]')).toHaveCount(0);
  await expect(page.getByText("At playback position: Speaker 1 + Speaker 2", { exact: true })).toBeVisible();
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 2.6;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(page.locator('.speaker-stage-card[data-speaker-active="true"]')).toHaveCount(0);
  await expect(page.getByText("No attributed speaker at this position", { exact: true })).toBeVisible();
  await expect(page.getByText(/Some passages have no time/)).toBeVisible();
});

test("playback mode keeps speaker, caption, and transcript state on one audio clock", async ({ page }, testInfo) => {
  await createFixture(page);
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const audio = page.locator("audio");
  const playback = page.locator(".playback-mode");
  await expect(playback).toBeVisible();
  const caption = playback.locator(".live-caption p");
  const normalCaptionSize = await caption.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  await page.getByLabel("Caption size", { exact: true }).selectOption("large");
  await expect.poll(() => caption.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(normalCaptionSize);
  const largeCaptionSize = await caption.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  await page.getByLabel("Caption size", { exact: true }).selectOption("xlarge");
  await expect.poll(() => caption.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(largeCaptionSize);
  await page.getByLabel("Caption size", { exact: true }).selectOption("normal");
  const speed = page.getByLabel("Playback speed", { exact: true });
  await speed.selectOption("1.5");
  await expect(speed).toHaveValue("1.5");
  const seekControl = page.getByLabel("Playback position", { exact: true });
  await seekControl.press("Home");
  for (let index = 0; index < 16; index++) await seekControl.press("ArrowRight");
  await expect.poll(() => audio.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBeCloseTo(1.6, 2);
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 0.2;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(playback.locator('[data-speaker-hero="true"]')).toHaveCount(1);
  await expect(playback.locator('.playback-caption-row.is-active')).toHaveCount(1);
  await expect(playback.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  if (await audio.evaluate((element) => Boolean((element as HTMLMediaElement).error))) {
    testInfo.annotations.push({
      type: "unsupported",
      description: "WebKit on Windows rejected the synthetic WAV fixture; playback UI exposed the media error.",
    });
    await expect(page.getByText("This browser cannot play the recording. The provider may still support it; verify before sending.", { exact: true })).toBeVisible();
    return;
  }
  await expect(playback.locator('[data-playback-status="playing"]')).toBeVisible();
  await expect(playback.locator('[data-speaker-active="true"]')).toHaveCount(1);
  await expect(playback.getByText("Playing", { exact: true })).toBeVisible();
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 2;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(playback.locator('[data-speaker-active="true"]')).toHaveCount(2);
  await expect(playback.locator('[data-speaker-hero="true"]')).toHaveCount(2);
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 2.6;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(playback.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await expect(playback.locator('[data-speaker-hero="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Pause audio", exact: true }).click();
  await expect(playback.getByText("Paused", { exact: true })).toBeVisible();
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 1.5;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(playback.locator('[data-speaker-hero="true"]')).toHaveCount(1);
  await expect(playback.locator('[data-speaker-active="true"]')).toHaveCount(0);
});

test("playback stage and transcript use responsive columns", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createFixture(page);
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const playback = page.locator(".playback-mode");
  const stage = playback.locator(".playback-stage");
  const transcript = playback.locator(".playback-transcript-panel");
  await expect(stage).toBeVisible();
  await expect(transcript).toBeVisible();
  const desktopStage = await stage.boundingBox();
  const desktopTranscript = await transcript.boundingBox();
  expect(desktopStage).not.toBeNull();
  expect(desktopTranscript).not.toBeNull();
  expect(Math.abs(desktopStage!.y - desktopTranscript!.y)).toBeLessThanOrEqual(1);
  expect(desktopTranscript!.x - (desktopStage!.x + desktopStage!.width)).toBeGreaterThanOrEqual(16);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const mobileStage = await stage.boundingBox();
    const mobileTranscript = await transcript.boundingBox();
    expect(mobileStage).not.toBeNull();
    expect(mobileTranscript).not.toBeNull();
    expect(mobileTranscript!.y).toBeGreaterThanOrEqual(mobileStage!.y + mobileStage!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("unsaved speaker drafts stay guarded across playback mode", async ({ page }) => {
  await createFixture(page);
  const name = page.getByLabel("Name for speaker 1", { exact: true });
  await name.fill("Draft speaker");
  await expect(page.locator('.speaker-review-dirty-sentinel[data-unsaved-edit="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  await expect(page.locator('.speaker-review-dirty-sentinel[data-unsaved-edit="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
  await expect(name).toHaveValue("Draft speaker");
  await page.getByRole("button", { name: "Save name", exact: true }).first().click();
  await expect(page.locator('.speaker-review-dirty-sentinel[data-unsaved-edit="true"]')).toHaveCount(0);
});

test("unsaved reference drafts stay guarded across playback mode", async ({ page }) => {
  const youtubeRequests: string[] = [];
  page.on("request", (request) => {
    if (/youtube(?:-nocookie)?\.com|youtu\.be/i.test(request.url())) youtubeRequests.push(request.url());
  });
  await createFixture(page);
  const playbackMode = page.getByRole("button", { name: "Playback mode", exact: true });
  const namingMode = page.getByRole("button", { name: "Edit speakers", exact: true });
  const url = page.getByLabel("YouTube URL", { exact: true });
  await url.fill("https://www.youtube.com/watch?v=yslXlV2BP_Y");
  await expect(page.locator('.reference-video[data-unsaved-edit="true"]')).toHaveCount(1);
  await playbackMode.click();
  await expect(namingMode).toHaveAttribute("aria-pressed", "true");
  await expect(playbackMode).toHaveAttribute("aria-pressed", "false");
  await expect(url).toHaveValue("https://www.youtube.com/watch?v=yslXlV2BP_Y");
  await expect(page.getByRole("alert")).toContainText(
    "Save or reset your video reference draft before switching modes.",
  );
  expect(youtubeRequests).toEqual([]);

  await url.fill("");
  await expect(page.locator('.reference-video[data-unsaved-edit="true"]')).toHaveCount(0);
  await playbackMode.click();
  await expect(page.locator(".playback-mode")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(youtubeRequests).toEqual([]);

  await namingMode.click();
  await expect(namingMode).toHaveAttribute("aria-pressed", "true");
  await expect(url).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("sample playback and name confirmation keep the identity review explicit", async ({ page }) => {
  await createFixture(page);
  await seedMemoFixture(page);
  await page.reload();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
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
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
  await expect(page.getByLabel("Name for speaker 1", { exact: true })).toHaveValue("Speaker 1");
  await expect(page.getByText("Needs a name", { exact: true })).toHaveCount(2);
  await page.reload();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
  await expect(page.getByLabel("Name for speaker 1", { exact: true })).toHaveValue("Speaker 1");
});

test("long playback lists keep manual paging and nearest gap/end anchors", async ({ page }) => {
  await createFixture(page, "long-fixture.wav", longFixtureMeeting());
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const playback = page.locator(".playback-mode");
  const list = playback.locator(".playback-transcript-list");
  await expect(list.locator("button")).toHaveCount(80);
  await page.getByRole("button", { name: "Load later", exact: true }).click();
  const pagedFirst = await list.locator("button").first().textContent();
  expect(pagedFirst).toContain("Long caption");
  await list.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true }));
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "Follow playback", exact: true })).toBeVisible();
  await expect(list.locator("button").first()).toHaveText(pagedFirst!);
  await page.getByRole("button", { name: "Follow playback", exact: true }).click();
  await expect(list.locator("button").first()).toContainText("The first speaker");
  const audio = page.locator("audio");
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 20.435;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(list.locator(".is-active")).toHaveCount(0);
  await expect(list.locator("button").first()).toContainText("Long caption");
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    media.currentTime = 39;
    media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await expect(list.locator(".is-active")).toHaveCount(0);
  await expect(list.locator("button").last()).toContainText("Long caption 120");
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
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
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
