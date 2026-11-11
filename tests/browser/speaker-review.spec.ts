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
  await page.locator("main").getByRole("button", { name: /^(New meeting|Create your first meeting)$/ }).click();
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
  await expect(page.locator(".speaker-queue-item")).toHaveCount(meeting.speakers.filter((speaker) => !speaker.confirmed).length);
  await expect(page.locator(".speaker-review-card")).toHaveCount(1);
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

async function seedMemoFixture(page: Page, memo = fixtureMeeting().memos[0]) {
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
  await expect(page.getByText(/Range includes surrounding context; it may contain other voices/).first()).toBeVisible();
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
  const caption = playback.locator(".chat-text").first();
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

test("group chat keeps a persistent speaker stage above chronological bubbles", async ({ page }) => {
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
  expect(desktopTranscript!.y).toBeGreaterThanOrEqual(desktopStage!.y + desktopStage!.height);
  expect(Math.abs(desktopTranscript!.x - desktopStage!.x)).toBeLessThanOrEqual(1);
  const bubbles = playback.locator(".playback-caption-row");
  await expect(playback.locator(".playback-turn").first().locator(".chat-speaker-name")).toHaveText("Speaker 1");
  await expect(playback.locator(".playback-turn").first().locator(".chat-avatars")).toBeVisible();
  const leftEdges = await bubbles.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
  expect(Math.max(...leftEdges) - Math.min(...leftEdges)).toBeLessThanOrEqual(1);
  await stage.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `test-results/group-chat-desktop-${test.info().project.name}.png` });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const mobileStage = await stage.boundingBox();
    const mobileTranscript = await transcript.boundingBox();
    expect(mobileStage).not.toBeNull();
    expect(mobileTranscript).not.toBeNull();
    expect(mobileStage!.x + mobileStage!.width).toBeLessThanOrEqual(width);
    expect(mobileTranscript!.x + mobileTranscript!.width).toBeLessThanOrEqual(width);
    expect(mobileTranscript!.y).toBeGreaterThanOrEqual(mobileStage!.y + mobileStage!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const headerLayout = await playback.locator(".playback-transcript-head").evaluate((header) => {
      const bounds = header.getBoundingClientRect();
      const children = [...header.children].map((element) => element.getBoundingClientRect());
      return {
        fits: header.scrollWidth <= header.clientWidth + 1 && children.every((box) => box.left >= bounds.left - 1 && box.right <= bounds.right + 1),
        separated: children.every((box, index) => children.slice(index + 1).every((other) => box.bottom <= other.top + 1 || other.bottom <= box.top + 1 || box.right <= other.left + 1 || other.right <= box.left + 1)),
      };
    });
    expect(headerLayout).toEqual({ fits: true, separated: true });
    await playback.locator(".playback-transcript-head").evaluate((element) => element.scrollIntoView({ block: "center" }));
    await playback.locator(".playback-transcript-head").screenshot({ path: `test-results/transcript-header-${width}-${test.info().project.name}.png` });
  }
  await page.screenshot({ path: `test-results/group-chat-mobile-${test.info().project.name}.png` });
});

test("current captions show timed attribution without inventing activity in pauses or gaps", async ({ page }) => {
  const meeting = fixtureMeeting();
  const baseSegment = meeting.segments[0];
  meeting.segments = [
    { ...baseSegment, id: firstSegmentId, start: 0.1, end: 0.4, text: "世界", originalText: "世界" },
    { ...baseSegment, id: "90000000-0000-4000-8000-000000000002", start: 0.4, end: 0.7, text: "灾难", originalText: "灾难" },
    { ...baseSegment, id: "90000000-0000-4000-8000-000000000003", start: 0.7, end: 1, text: "。", originalText: "。" },
    { ...baseSegment, id: "90000000-0000-4000-8000-000000000004", start: 0.55, end: 0.65, speakerIds: [speakerIds[1]], text: "Other voice", originalText: "Other voice" },
    { ...baseSegment, id: "90000000-0000-4000-8000-000000000006", start: 0.57, end: 0.64, speakerIds: [], text: "Unknown voice", originalText: "Unknown voice" },
    { ...baseSegment, id: "90000000-0000-4000-8000-000000000005", start: null, end: null, text: "Untimed source", originalText: "Untimed source" },
  ];
  await createFixture(page, "speaker-review.wav", meeting);
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const stage = page.locator(".playback-stage");
  const audio = page.locator("audio");
  const setTime = (time: number) => audio.evaluate((element, next) => {
    const media = element as HTMLMediaElement;
    media.currentTime = next;
    media.dispatchEvent(new Event("seeked"));
  }, time);
  await setTime(0.6);
  await expect(stage.getByRole("region", { name: "Current captions" })).toContainText("世界灾难");
  await expect(stage.getByRole("region", { name: "Current captions" })).toContainText("Other voice");
  await expect(stage.getByRole("region", { name: "Attribution at playback position" })).toContainText("Unknown speaker");
  await expect(stage.locator('[data-speaker-hero="true"]')).toHaveCount(2);
  await expect(stage.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await expect(stage.locator('[data-fragment-active="true"]')).toHaveCount(3);
  await audio.evaluate((element) => element.addEventListener("playing", (event) => {
    if (event.isTrusted) event.stopImmediatePropagation();
  }, true));
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(stage.locator('[data-speaker-active="true"]')).toHaveCount(2);
  await audio.dispatchEvent("waiting");
  await expect(stage.locator('[data-playback-status="buffering"]')).toBeVisible();
  await expect(stage.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await audio.dispatchEvent("playing");
  await setTime(2);
  await expect(stage.getByText("No attributed speaker at this timestamp.")).toBeVisible();
  await expect(stage.getByRole("region", { name: "Current captions" })).toBeEmpty();
  await page.locator(".playback-untimed summary").click();
  await expect(page.locator(".playback-untimed")).toContainText("Untimed source");
  const positions = await page.evaluate(() => [".playback-stage", ".playback-transcript-panel", ".playback-roster"].map(selector => document.querySelector(selector)!.getBoundingClientRect().top));
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
  await expect(page.getByLabel("Caption size")).toBeVisible();
});

test("group chat preserves all identities, untimed evidence and reduced motion", async ({ page }) => {
  const meeting = fixtureMeeting();
  for (let index = 3; index <= 6; index++) meeting.speakers.push({
    ...meeting.speakers[0], id: `00000000-0000-4000-8000-00000000000${index}`, name: `Speaker ${index}`,
  });
  meeting.segments.push({ ...meeting.segments[0], id: "00000000-0000-4000-8000-000000000009", start: null, end: null, text: "Untimed evidence stays available" });
  await createFixture(page, "group-chat.wav", meeting);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  await expect(page.locator(".playback-speaker")).toHaveCount(6);
  await expect(page.locator(".live-caption")).toHaveCount(0);
  await page.locator(".playback-untimed summary").click();
  await expect(page.locator(".playback-untimed")).toContainText("Untimed evidence stays available");
  await expect(page.locator(".playback-untimed [data-caption-id]")).toHaveCount(0);
  const bubble = page.locator(".playback-caption-row").first();
  expect(await bubble.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  await bubble.click();
  await expect(page.locator(".playback-caption-row.is-active [data-fragment-active=true]")).not.toHaveCount(0);
  const list = page.locator(".playback-transcript-list");
  const box = (await list.boundingBox())!;
  await page.mouse.click(box.x + box.width - 2, box.y + 10);
  await expect(page.getByRole("button", { name: "Follow playback", exact: true })).toBeVisible();
});

test("speaker changes refresh without timeupdate and short word gaps retain inactive context", async ({ page }) => {
  const meeting = fixtureMeeting();
  meeting.segments[1].start = 0.85;
  await createFixture(page, "speaker-review.wav", meeting);
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const stage = page.locator(".playback-stage");
  const title = stage.locator("h3");
  await expect(title).toHaveText("Speaker & captions");
  // Remove event delivery and control only the media read value. This proves
  // the foreground sampler reads currentTime instead of predicting elapsed time.
  await page.locator("audio").evaluate((element) => {
    element.addEventListener("timeupdate", (event) => event.stopImmediatePropagation(), true);
    // This fixture already simulates play/pause. Isolate its clock contract
    // from Windows WebKit's unsupported WAV decoder; native audio is probed separately.
    Object.defineProperty(element, "error", { configurable: true, value: null });
    element.addEventListener("error", (event) => event.stopImmediatePropagation(), true);
    Object.defineProperty(element, "currentTime", { configurable: true, value: 0.2 });
  });
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(stage.locator('[data-speaker-hero="true"] strong')).toHaveText("Speaker 1");
  const setTime = async (value: number) => page.locator("audio").evaluate((element, position) => {
    Object.defineProperty(element, "currentTime", { configurable: true, value: position });
  }, value);
  await setTime(0.75);
  await expect(stage.getByText("Between words · context only", { exact: true })).toBeVisible();
  await expect(stage.locator('[data-speaker-hero="true"]')).toHaveCount(0);
  await expect(stage.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await expect(page.locator(".playback-caption-row.is-active")).toHaveCount(0);
  await expect(page.locator(".playback-roster .playback-speaker")).toHaveCount(2);

  await setTime(1.5);
  await expect(stage.locator('[data-speaker-hero="true"] strong')).toHaveText("Speaker 2");
  await expect(page.locator(".playback-caption-row.is-active .chat-text")).toContainText("The second speaker");
  await expect(page.locator(".playback-caption-row.is-active")).toHaveCount(1);
  await setTime(2);
  await expect(stage.locator('[data-speaker-hero="true"]')).toHaveCount(2);
  await setTime(3);
  await expect(stage.locator('[data-speaker-hero="true"]')).toHaveCount(0);
  await expect(title).toHaveText("Speaker & captions");
  await page.getByRole("button", { name: "Pause audio", exact: true }).click();
  await setTime(0.2);
  // No sampling while paused, and no stale clock extrapolation.
  await page.waitForTimeout(150);
  await expect(stage.locator('[data-speaker-hero="true"]')).toHaveCount(0);
  await page.locator("audio").dispatchEvent("seeked");
  await expect(stage.locator('[data-speaker-hero="true"] strong')).toHaveText("Speaker 1");
  await expect(stage.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await expect(title).toHaveText("Speaker & captions");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await page.locator("audio").dispatchEvent("waiting");
  await setTime(1.5);
  await page.waitForTimeout(150);
  await expect(stage.locator('[data-playback-status="buffering"]')).toBeVisible();
  await expect(stage.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await page.locator("audio").dispatchEvent("playing");
  await expect(stage.locator('[data-speaker-hero="true"] strong')).toHaveText("Speaker 2");
});

test("transcript groups preserve fragment review, undo and filtering", async ({ page }) => {
  const fixture = fixtureMeeting();
  const template = fixture.segments[0];
  fixture.segments = ["Hello", ",", "world", "."].map((text, index) => ({
    ...template,
    id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    start: index * 0.2,
    end: (index + 1) * 0.2,
    text,
    originalText: text,
  }));
  fixture.memos = [];
  await createFixture(page, "speaker-review.wav", fixture);
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(page.locator(".transcript-group-summary")).toContainText("Hello, world.");
  await expect(page.locator(".transcript-group-summary")).toContainText("4 source fragments");
  await page.getByLabel("Select group of 4 source fragments").check();
  await expect(page.locator(".bulk-bar")).toContainText("4 passages selected");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByText("View source fragments", { exact: true }).click();
  await expect(page.locator(".passage")).toHaveCount(4);
  await expect(page.getByText("world", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark group reviewed", exact: true }).click();
  await expect(page.locator(".transcript-group-summary")).toContainText("4/4 reviewed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".transcript-group-summary")).toContainText("0/4 reviewed");
  await page.getByLabel("Filter by speaker").selectOption(speakerIds[1]);
  await expect(page.locator(".transcript-group-summary")).toHaveCount(0);
  await page.getByLabel("Filter by speaker").selectOption("");
  await page.reload();
  await expect(page.locator(".transcript-group-summary")).toContainText("Hello, world.");
});

test("long transcript pages and note citations reach the exact source", async ({ page }) => {
  const fixture = longFixtureMeeting();
  fixture.memos[0].items[0].sources = [{ id: fixture.segments[124].id, revision: 1 }];
  await createFixture(page, "speaker-review.wav", fixture);
  await seedMemoFixture(page, fixture.memos[0]);
  await page.reload();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(page.getByRole("navigation", { name: "Transcript pages" })).toContainText("1–40 / 125");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Transcript pages" })).toContainText("41–80 / 125");
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: "Passage 125 · r1" }).click();
  await page.getByRole("button", { name: "View current passage" }).click();
  await expect(page.locator(".passage.highlight")).toContainText("Long caption 120");
  await expect(page.getByRole("navigation", { name: "Transcript pages" })).toContainText("121–125 / 125");
});

test("immersive fallback preserves the player and restores focus", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable"));
  });
  await createFixture(page);
  const before = sourceSnapshot(await storedMeeting(page));
  const player = page.locator("audio");
  await player.evaluate((element) => { (element as HTMLMediaElement).currentTime = 1.5; element.dispatchEvent(new Event("seeked")); });
  await page.getByLabel("Playback speed", { exact: true }).selectOption("1.5");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  const opener = page.getByRole("button", { name: "Immersive playback", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("in-page view");
  await expect(dialog.getByRole("button", { name: "Exit immersive" })).toBeFocused();
  await expect(page.locator("audio")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await expect(dialog.getByLabel("Playback speed")).toHaveValue("1.5");
  await expect.poll(() => player.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBe(1.5);
  await expect(dialog.locator(".immersive-captions")).toContainText("The second speaker");
  await dialog.getByRole("button", { name: "Close transcript" }).click();
  await expect(dialog.getByRole("button", { name: "Reading", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Reading", exact: true }).click();
  await dialog.getByRole("button", { name: "Back 15 seconds" }).click();
  await expect.poll(() => player.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.locator("audio")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Pause audio", exact: true })).toBeVisible();
  await expect(page.getByLabel("Playback speed", { exact: true })).toHaveValue("1.5");
  expect(sourceSnapshot(await storedMeeting(page))).toBe(before);
});

test("immersive view tracks browser-initiated fullscreen exit", async ({ page }) => {
  await page.addInitScript(() => {
    let active: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => active });
    HTMLElement.prototype.requestFullscreen = function () { active = document.querySelector(".immersive"); document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
    document.exitFullscreen = () => { active = null; document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
  });
  await createFixture(page);
  const opener = page.getByRole("button", { name: "Immersive playback", exact: true });
  await opener.click();
  await expect(page.getByRole("dialog", { name: "Immersive playback" })).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("dialog", { name: "Immersive playback" })).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("immersive view enters and exits native Chromium fullscreen", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Native fullscreen support is browser dependent.");
  await createFixture(page);
  await page.locator("audio").evaluate((element) => { (element as HTMLMediaElement).currentTime = 1.5; element.dispatchEvent(new Event("seeked")); });
  await page.getByLabel("Playback speed", { exact: true }).selectOption("1.5");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  const opener = page.getByRole("button", { name: "Immersive playback", exact: true });
  await opener.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("immersive") ?? false)).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await expect(dialog.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await expect(dialog.getByLabel("Playback speed")).toHaveValue("1.5");
  await page.getByRole("button", { name: "Exit immersive" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(opener).toBeFocused();
  await expect(page.getByRole("button", { name: "Pause audio", exact: true })).toBeVisible();
  await expect.poll(() => page.locator("audio").evaluate((element) => (element as HTMLMediaElement).currentTime)).toBe(1.5);
});

test("immersive playback shows overlap and remains accessible on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable"));
  });
  await createFixture(page);
  await page.locator("audio").evaluate((element) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = 2;
    element.dispatchEvent(new Event("seeked"));
  });
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await page.locator("audio").dispatchEvent("playing");
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Reading", exact: true }).click();
  await expect(dialog.locator('.immersive-person[data-active="true"]')).toHaveCount(2);
  await expect(dialog.locator(".immersive-captions")).toContainText("overlap briefly");
  await expect(dialog.getByText("Timing unavailable", { exact: true })).toBeVisible();
  await dialog.locator(".immersive-transcript-list").dispatchEvent("wheel");
  await expect(dialog.getByText("Follow paused")).toBeVisible();
  await dialog.getByRole("button", { name: "Jump to current" }).click();
  await expect(dialog.getByText("Following playback")).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".immersive").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

test("immersive speaker glow follows playback and respects reduced motion", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  await page.locator("audio").evaluate((element) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = 2;
    element.dispatchEvent(new Event("seeked"));
  });
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  const avatar = dialog.locator(".immersive-current-speaker .immersive-avatar").first();
  await expect(avatar).toHaveCSS("animation-name", "none");
  await dialog.getByRole("button", { name: "Play audio" }).click();
  await expect(avatar).toHaveCSS("animation-name", "immersive-speaker-glow");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(avatar).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await dialog.getByRole("button", { name: "Pause audio" }).click();
  await expect(avatar).toHaveCSS("animation-name", "none");
});

test("immersive caption fade does not restart within a group and respects reduced motion", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  const audio = page.locator("audio");
  const seek = async (position: number) => audio.evaluate((element, value) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = value;
    element.dispatchEvent(new Event("seeked"));
  }, position);
  await seek(0.2);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const caption = page.locator(".immersive-caption-content p").first();
  await expect(caption).toHaveCSS("animation-name", "immersive-caption-enter");
  await caption.evaluate((element) => { element.dataset.testRetained = "yes"; });
  await seek(0.8);
  await expect(caption).toHaveAttribute("data-test-retained", "yes");
  await seek(1.5);
  await expect(caption).toContainText("The second speaker");
  await expect(caption).not.toHaveAttribute("data-test-retained", "yes");
  await expect(caption).toHaveCSS("animation-name", "immersive-caption-enter");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(caption).toHaveCSS("animation-name", "none");
});

test("immersive table keeps speaker positions stable and follows source attribution", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  const fixture = fixtureMeeting();
  fixture.segments.push({ ...fixture.segments[2], id: "10000000-0000-4000-8000-000000000006", start: 2.3, end: 2.7, speakerIds: [], text: "An unknown speaker." });
  await createFixture(page, "speaker-review.wav", fixture);
  const before = sourceSnapshot(await storedMeeting(page));
  const audio = page.locator("audio");
  const seek = async (position: number) => audio.evaluate((element, value) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = value;
    element.dispatchEvent(new Event("seeked"));
  }, position);
  await seek(1.5);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Table", exact: true }).click();
  const cards = dialog.locator(".immersive-table-speaker");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Speaker 2" })).toHaveAttribute("data-position", "true");
  await expect(dialog.locator(".immersive-caption-meta")).toContainText("Speaker 2");
  await expect(dialog.locator(".immersive-caption-meta")).toContainText("At this position");
  await expect(dialog.locator('.immersive-table-speaker[data-active="true"]')).toHaveCount(0);
  const positions = await cards.evaluateAll((elements) => elements.map((element) => { const box = element.getBoundingClientRect(); return [box.x, box.y]; }));
  await dialog.getByRole("button", { name: "Play audio" }).click();
  await expect(dialog.locator('.immersive-table-speaker[data-active="true"]')).toHaveCount(1);
  const speakingAvatar = dialog.locator('.immersive-table-speaker[data-active="true"] .immersive-avatar');
  await expect.poll(() => speakingAvatar.evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("immersive-speaker-ring");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => speakingAvatar.evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("none");
  await expect.poll(() => dialog.locator(".immersive-stage").evaluate((element) => getComputedStyle(element, "::before").animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await seek(2);
  await expect(dialog.locator('.immersive-table-speaker[data-active="true"]')).toHaveCount(2);
  await expect(dialog.locator(".immersive-caption-meta")).toContainText("Speaker 1");
  await expect(dialog.locator(".immersive-caption-meta")).toContainText("Speaker 2");
  expect(await cards.evaluateAll((elements) => elements.map((element) => { const box = element.getBoundingClientRect(); return [box.x, box.y]; }))).toEqual(positions);
  await seek(2.4);
  await expect(dialog.getByText("Unknown speaker at this position")).toBeVisible();
  await expect(dialog.locator(".immersive-caption-meta")).toContainText("Unknown speaker");
  await expect(dialog.locator('.immersive-table-speaker[data-active="true"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Pause audio" }).click();
  await expect(dialog.locator('.immersive-table-speaker[data-active="true"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Close transcript" }).click();
  await dialog.getByRole("button", { name: "Single", exact: true }).click();
  await expect(dialog.locator(".immersive-current-speakers")).toBeVisible();
  expect(sourceSnapshot(await storedMeeting(page))).toBe(before);
});

test("immersive table keeps four labels in fixed positions around the table", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  const fixture = fixtureMeeting();
  for (let index = 3; index <= 4; index++) fixture.speakers.push({ ...fixture.speakers[0], id: `20000000-0000-4000-8000-00000000000${index}`, name: `Speaker ${index}` });
  await createFixture(page, "speaker-review.wav", fixture);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Table", exact: true }).click();
  const cards = dialog.locator(".immersive-table-speaker");
  await expect(cards).toHaveCount(4);
  const seats = await cards.evaluateAll((elements) => elements.map((element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y }; }));
  expect(seats[0].y).toBe(seats[1].y);
  expect(seats[2].y).toBe(seats[3].y);
  expect(seats[2].y).toBeGreaterThan(seats[0].y);
  expect(seats[2].x).toBeLessThan(seats[0].x);
  expect(seats[3].x).toBeGreaterThan(seats[1].x);
  await page.locator("audio").evaluate((element) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = 1.5;
    element.dispatchEvent(new Event("seeked"));
  });
  await dialog.getByRole("button", { name: "Play audio" }).click();
  await expect(dialog.locator(".immersive-table-speakers")).toHaveAttribute("data-glow-seat", "1");
  await expect(dialog.locator(".immersive-caption-meta")).toContainText("Speaker 2");
  expect(await cards.evaluateAll((elements) => elements.map((element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y }; }))).toEqual(seats);
  await page.locator("audio").evaluate((element) => { (element as HTMLMediaElement).currentTime = 2; element.dispatchEvent(new Event("seeked")); });
  await expect(dialog.locator('.immersive-table-speaker[data-active="true"]')).toHaveCount(2);
  await expect(dialog.locator(".immersive-table-speakers")).not.toHaveAttribute("data-glow-seat");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("immersive table is available for five labels and not for six", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  const fixture = fixtureMeeting();
  for (let index = 3; index <= 5; index++) fixture.speakers.push({ ...fixture.speakers[0], id: `20000000-0000-4000-8000-00000000000${index}`, name: `Speaker ${index}` });
  await createFixture(page, "speaker-review.wav", fixture);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Table", exact: true }).click();
  await expect(dialog.locator(".immersive-table-speaker")).toHaveCount(5);
  await page.setViewportSize({ width: 924, height: 728 });
  const content = dialog.locator(".immersive-content");
  expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".immersive").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Exit immersive" }).click();
  fixture.speakers.push({ ...fixture.speakers[0], id: "20000000-0000-4000-8000-000000000006", name: "Speaker 6" });
  await createFixture(page, "speaker-review.wav", fixture);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  await expect(page.getByRole("button", { name: "Table", exact: true })).toHaveCount(0);
});

test("immersive fullscreen hides controls while playing and restores them on interaction", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 850 });
  await page.addInitScript(() => {
    let active: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => active });
    HTMLElement.prototype.requestFullscreen = function () { active = document.querySelector(".immersive"); document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
    document.exitFullscreen = () => { active = null; document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
  });
  await createFixture(page);
  await page.locator("audio").evaluate((element) => { Object.defineProperty(element, "error", { configurable: true, get: () => null }); });
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Table", exact: true }).click();
  await dialog.getByRole("button", { name: "Focus", exact: true }).click();
  await dialog.getByRole("button", { name: "Play audio" }).click();
  await page.locator("audio").dispatchEvent("playing");
  await dialog.locator(".immersive-stage").focus();
  const header = dialog.locator(".immersive-header");
  const dock = dialog.locator(".immersive-controls");
  const rosterBar = dialog.locator(".immersive-roster-bar");
  await expect(header).toBeHidden({ timeout: 6000 });
  await expect(dock).toBeHidden();
  await expect(rosterBar).toBeHidden();
  const stage = dialog.locator(".immersive-stage");
  await expect(stage).toHaveAttribute("data-cinematic", "true");
  const layout = await stage.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const speakers = element.querySelector(".immersive-table-speakers")!.getBoundingClientRect();
    const captions = element.querySelector(".immersive-captions")!.getBoundingClientRect();
    return { topSpace: speakers.top - bounds.top, bottomSpace: bounds.bottom - captions.bottom };
  });
  expect(layout.topSpace).toBeGreaterThan(30);
  expect(layout.bottomSpace).toBeGreaterThan(30);
  const beforeSpeakerChange = await dialog.locator(".immersive-table-speakers").boundingBox();
  await page.locator("audio").evaluate((element) => {
    (element as HTMLMediaElement).currentTime = 1.5;
    element.dispatchEvent(new Event("seeked"));
  });
  await expect(dialog.locator('.immersive-table-speaker[data-position="true"]')).toContainText("Speaker 2");
  const afterSpeakerChange = await dialog.locator(".immersive-table-speakers").boundingBox();
  expect(afterSpeakerChange).toEqual(beforeSpeakerChange);
  await page.mouse.move(100, 100);
  await expect(header).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(rosterBar).toBeVisible();
  await page.keyboard.press("Tab");
  await dialog.getByRole("button", { name: "Pause audio" }).focus();
  await page.waitForTimeout(3200);
  await expect(dock).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Pause audio" })).toBeFocused();
  await dialog.getByRole("button", { name: "Pause audio" }).click();
  await page.waitForTimeout(3200);
  await expect(header).toBeVisible();
  await expect(dock).toBeVisible();
});

test("immersive position shows overlapping attribution while paused and keeps labels accessible", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  await page.locator("audio").evaluate((element) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = 2;
    element.dispatchEvent(new Event("seeked"));
  });
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  const current = dialog.locator(".immersive-current-speaker");
  await expect(current).toHaveCount(2);
  await expect(dialog.getByText("Paused at this position")).toHaveClass(/immersive-sr-only/);
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toHaveCount(0);
  await expect(dialog.locator('.immersive-captions [data-current="true"]').first()).toBeVisible();
  await dialog.getByRole("button", { name: "View labels" }).click();
  await expect(dialog.locator(".immersive-roster")).toBeVisible();
  await expect(dialog.locator('.immersive-person[data-position="true"]')).toHaveCount(2);
  await dialog.getByText("Timing unavailable", { exact: true }).click();
  await expect(dialog.locator(".immersive-untimed p").first()).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await dialog.locator(".immersive-current-speakers").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
});

test("immersive transcript pages through long recordings and returns to playback", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable"));
  });
  await createFixture(page, "speaker-review.wav", longFixtureMeeting());
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  const later = dialog.getByRole("button", { name: "Later", exact: true });
  while (await later.isEnabled()) await later.click();
  await expect(dialog.getByText("Long caption 120", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Follow paused")).toBeVisible();
  await dialog.getByRole("button", { name: "Jump to current" }).click();
  await expect(dialog.getByText("Following playback")).toBeVisible();
  await expect(dialog.getByText("Long caption 120", { exact: true })).toHaveCount(0);
});

test("immersive transcript resizes, searches the full meeting and returns to playback", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  const fixture = longFixtureMeeting();
  fixture.segments.push(
    { ...fixture.segments[0], id: "60000000-0000-4000-8000-000000000001", start: 37.1, end: 37.3, speakerIds: [speakerIds[0]], text: "库存", originalText: "库存" },
    { ...fixture.segments[0], id: "60000000-0000-4000-8000-000000000002", start: 37.3, end: 37.5, speakerIds: [speakerIds[0]], text: "流程", originalText: "流程" },
  );
  await createFixture(page, "speaker-review.wav", fixture);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  const panel = dialog.getByRole("complementary", { name: "Transcript" });
  const width = panel.getByRole("slider", { name: "Transcript panel width" });
  const original = await panel.evaluate((element) => element.getBoundingClientRect().width);
  await width.focus();
  await width.press("End");
  await expect(width).toHaveValue("45");
  expect(await panel.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(original);
  await width.press("Home");
  await expect(width).toHaveValue("25");
  const search = panel.getByLabel("Search transcript");
  await search.fill("Long caption 120");
  await expect(panel.getByText("Search results · follow paused")).toBeVisible();
  await expect(panel.getByText("Caption groups 1–1 of 1")).toBeVisible();
  await panel.getByRole("button", { name: /Long caption 120/ }).click();
  await expect.poll(() => page.locator("audio").evaluate((element) => (element as HTMLMediaElement).currentTime)).toBeCloseTo(36.13, 2);
  await expect(dialog.getByRole("button", { name: "Play audio" })).toBeVisible();
  await search.fill("库存流程");
  await expect(panel.getByRole("button", { name: /库存流程/ })).toBeVisible();
  await search.fill("no trustworthy timing");
  await expect(panel.locator(".immersive-untimed p")).toContainText("no trustworthy timing");
  await expect(panel.getByText("Caption groups 0–0 of 0")).toBeVisible();
  const jump = panel.getByRole("button", { name: "Jump to current" });
  await jump.focus();
  await jump.press("Enter");
  await expect(search).toHaveValue("");
  await expect(panel.getByText("Following playback")).toBeVisible();
  await expect(jump).toBeFocused();
});

test("immersive responsive modes and stage shortcuts preserve playback", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  const stage = dialog.getByRole("region", { name: "Speaker and captions" });
  await expect(dialog.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("complementary", { name: "Transcript" })).toHaveCount(0);
  await stage.focus();
  await stage.press("Space");
  await expect(dialog.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await stage.press("ArrowRight");
  await expect.poll(() => page.locator("audio").evaluate((element) => (element as HTMLMediaElement).currentTime)).toBeCloseTo(5, 1);
  await dialog.getByRole("button", { name: "Reading", exact: true }).click();
  const transcriptPanel = dialog.getByRole("complementary", { name: "Transcript" });
  await expect(transcriptPanel).toBeVisible();
  expect(await transcriptPanel.evaluate((element) => getComputedStyle(element).position)).toBe("absolute");
  await expect(transcriptPanel.getByLabel("Transcript panel width")).toBeHidden();
  expect(await transcriptPanel.getByLabel("Search transcript").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await dialog.getByLabel("Playback speed").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await transcriptPanel.locator(".immersive-transcript-list").evaluate((element) => element.clientHeight)).toBeGreaterThan(80);
  expect(await dialog.locator(".immersive-controls").evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight + 1)).toBe(true);
  expect(await dialog.locator(".immersive-controls").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(200);
  await expect(dialog.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("immersive-mobile.png") });
  await dialog.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(transcriptPanel).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 900 });
  await dialog.getByRole("button", { name: "Reading", exact: true }).click();
  const layout = await dialog.evaluate((element) => {
    const stageBox = element.querySelector(".immersive-stage")!.getBoundingClientRect();
    const transcriptBox = element.querySelector(".immersive-transcript")!.getBoundingClientRect();
    return { stageBottom: stageBox.bottom, transcriptTop: transcriptBox.top };
  });
  expect(layout.transcriptTop).toBeGreaterThanOrEqual(layout.stageBottom - 1);
  await page.setViewportSize({ width: 1280, height: 900 });
  const desktop = await dialog.evaluate((element) => {
    const stageBox = element.querySelector(".immersive-stage")!.getBoundingClientRect();
    const transcriptBox = element.querySelector(".immersive-transcript")!.getBoundingClientRect();
    const caption = element.querySelector<HTMLElement>(".immersive-caption-content")!;
    const captionBox = caption.getBoundingClientRect();
    return { stageRight: stageBox.right, transcriptLeft: transcriptBox.left, captionTop: captionBox.top, stageCenter: stageBox.top + stageBox.height / 2, stageHeight: stageBox.height, captionHeight: caption.clientHeight, lineHeight: parseFloat(getComputedStyle(caption).lineHeight), captionWidth: caption.clientWidth, captionScrollWidth: caption.scrollWidth };
  });
  expect(desktop.stageRight).toBeLessThanOrEqual(desktop.transcriptLeft + 1);
  expect(desktop.captionTop).toBeLessThan(desktop.stageCenter + desktop.stageHeight * 0.2);
  expect(desktop.captionHeight).toBeLessThanOrEqual(desktop.lineHeight * 3 + 1);
  expect(desktop.captionScrollWidth).toBeLessThanOrEqual(desktop.captionWidth);
  await page.screenshot({ path: testInfo.outputPath("immersive-desktop.png") });
});

test("immersive speaker labels open the existing editor without restarting audio", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const audio = page.locator("audio");
  await audio.evaluate((element) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = 1.5;
    element.dispatchEvent(new Event("seeked"));
  });
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "View labels" }).click();
  await dialog.getByRole("button", { name: "Edit speakers", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit speakers", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => audio.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBeCloseTo(1.5, 2);
});

test("immersive follow keeps a whole top row and leaves manual scrolling alone", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page, "speaker-review.wav", longFixtureMeeting());
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  const audio = page.locator("audio");
  const list = dialog.locator(".immersive-transcript-list");
  const seek = async (time: number) => audio.evaluate((element, value) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = value;
    element.dispatchEvent(new Event("seeked"));
  }, time);
  await seek(12.15);
  const geometry = () => list.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll<HTMLElement>("[data-immersive-caption]")];
    const first = rows.find((row) => row.getBoundingClientRect().bottom > bounds.top + 1);
    const active = element.querySelector<HTMLElement>(".is-current");
    return { firstTop: first?.getBoundingClientRect().top ?? 0, top: bounds.top, activeBottom: active?.getBoundingClientRect().bottom ?? Infinity, bottom: bounds.bottom };
  });
  await expect.poll(async () => {
    const box = await geometry();
    return box.firstTop >= box.top - 1 && box.activeBottom <= box.bottom + 1;
  }).toBe(true);
  await list.dispatchEvent("wheel");
  await list.evaluate((element) => { element.scrollTop = 30; });
  const manualPosition = await list.evaluate((element) => element.scrollTop);
  await seek(12.42);
  await expect(dialog.getByText("Follow paused")).toBeVisible();
  expect(await list.evaluate((element) => element.scrollTop)).toBe(manualPosition);
  await dialog.getByRole("button", { name: "Jump to current" }).click();
  await expect.poll(async () => {
    const box = await geometry();
    return box.firstTop >= box.top - 1 && box.activeBottom <= box.bottom + 1;
  }).toBe(true);
});

test("immersive playback reports a failed play request", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  await page.locator("audio").evaluate((element) => { (element as HTMLMediaElement).play = () => Promise.reject(new Error("blocked")); });
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Playback could not start.");
});

test("immersive playback labels between-word context while paused", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  const fixture = fixtureMeeting();
  fixture.segments[1].start = 0.8;
  await createFixture(page, "speaker-review.wav", fixture);
  await page.locator("audio").evaluate((element) => { (element as HTMLMediaElement).currentTime = 0.75; element.dispatchEvent(new Event("seeked")); });
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await expect(dialog.getByText("Between words · context only", { exact: true })).toHaveClass(/immersive-sr-only/);
  await expect(dialog.locator('.immersive-person[data-active="true"]')).toHaveCount(0);
  await expect(dialog.locator('.immersive-current-speaker[data-context="true"]')).toContainText("Speaker 1");
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toHaveCount(0);
});

test("immersive retains only inactive speaker context through a short same-speaker gap", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  const fixture = fixtureMeeting();
  fixture.segments[1].start = 0.8;
  fixture.segments[2].start = 1.6;
  await createFixture(page, "speaker-review.wav", fixture);
  const before = sourceSnapshot(await storedMeeting(page));
  const audio = page.locator("audio");
  const seek = async (time: number) => audio.evaluate((element, value) => {
    Object.defineProperty(element, "error", { configurable: true, get: () => null });
    (element as HTMLMediaElement).currentTime = value;
    element.dispatchEvent(new Event("seeked"));
  }, time);
  await seek(0.5);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Play audio" }).click();
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toContainText("Speaker 1");
  const activeHeight = await dialog.locator(".immersive-current-speaker").evaluate((element) => element.getBoundingClientRect().height);
  await seek(0.75);
  const card = dialog.locator('.immersive-current-speaker[data-context="true"]');
  await expect(card).toContainText("Speaker 1");
  await expect(card).toContainText("Context only");
  await expect(dialog.getByText("Between words · context only", { exact: true })).toHaveClass(/immersive-sr-only/);
  await expect(card.locator(".immersive-sr-only")).toHaveText("Context only");
  expect(await card.evaluate((element) => element.getBoundingClientRect().height)).toBe(activeHeight);
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toHaveCount(0);
  await expect(dialog.locator('.immersive-captions [data-current="true"]')).toHaveCount(0);
  await seek(1.0);
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toContainText("Speaker 1");
  await seek(1.5);
  await expect(dialog.locator('.immersive-current-speaker[data-context="true"]')).toContainText("Last caption · not current speech");
  await expect(dialog.locator(".immersive-captions")).toContainText("The opening turn continues");
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toHaveCount(0);
  await expect(dialog.locator('.immersive-captions [data-current="true"]')).toHaveCount(0);
  await seek(1.7);
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toContainText("Speaker 2");
  await seek(2.0);
  await expect(dialog.locator('.immersive-current-speaker[data-active="true"]')).toHaveCount(2);
  await seek(3.0);
  await expect(dialog.locator('.immersive-current-speaker[data-context="true"]')).toHaveCount(2);
  await expect(dialog.locator(".immersive-captions")).toContainText("overlap briefly");
  await dialog.getByRole("button", { name: "Pause audio" }).click();
  await expect(dialog.getByText("Paused at this position")).toHaveClass(/immersive-sr-only/);
  await seek(0);
  await expect(dialog.locator(".immersive-current-speaker")).toHaveCount(0);
  await expect(dialog.locator(".immersive-captions p")).toHaveCount(0);
  expect(sourceSnapshot(await storedMeeting(page))).toBe(before);
});

test("immersive highlights follow the real media clock without timeupdate", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "This native audio clock probe uses Chromium's WAV decoder.");
  await page.addInitScript(() => {
    (window as Window & { nativeFixturePlay?: typeof HTMLMediaElement.prototype.play }).nativeFixturePlay = HTMLMediaElement.prototype.play;
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable"));
  });
  const fixture = fixtureMeeting();
  fixture.segments = Array.from({ length: 16 }, (_, index) => ({
    ...fixture.segments[0],
    id: index === 0 ? firstSegmentId : `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    start: 0.2 + index * 0.2,
    end: 0.2 + (index + 1) * 0.2,
    text: `word${index}`,
    originalText: `word${index}`,
  }));
  await createFixture(page, "clock-fixture.wav", fixture);
  const audio = page.locator("audio");
  await audio.evaluate((element) => {
    const media = element as HTMLMediaElement;
    const nativePlay = (window as Window & { nativeFixturePlay?: typeof media.play }).nativeFixturePlay;
    if (!nativePlay) throw new Error("Native audio play method is unavailable.");
    media.play = nativePlay;
    media.addEventListener("timeupdate", (event) => event.stopImmediatePropagation(), true);
    media.currentTime = 0.2;
    media.dispatchEvent(new Event("seeked"));
  });
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Play audio" }).click();
  const sample = await page.evaluate(async () => {
    const media = document.querySelector<HTMLAudioElement>("audio")!;
    const samples: number[] = [];
    let frames = 0;
    const deadline = performance.now() + 7000;
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        const time = media.currentTime;
        const index = Math.floor((time - 0.2) / 0.2);
        const marked = document.querySelector<HTMLElement>('.immersive-captions [data-current="true"]')?.textContent?.trim();
        if (index >= 1 && index < 14) {
          frames += 1;
          if (marked !== `word${index}`) samples.push(time - (0.2 + index * 0.2));
        }
        if (time >= 3) resolve();
        else if (performance.now() > deadline) reject(new Error("Native audio did not advance."));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    media.pause();
    return { frames, mismatches: samples.length, maxSeconds: Math.max(0, ...samples) };
  });
  console.log(`Native synthetic highlight clock: ${JSON.stringify(sample)}`);
  expect(sample.frames).toBeGreaterThan(20);
  expect(sample.mismatches).toBeLessThan(sample.frames / 2);
  expect(sample.maxSeconds).toBeLessThan(0.12);
});

test("immersive view remains usable offline with a mocked local player", async ({ page, context }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Pause audio", exact: true })).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(1);
});

test("immersive playback stops an explicitly loaded reference video before audio", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page, "The State of Startups [yslXlV2BP_Y].mp3");
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  await page.locator(".playback-reference summary").click();
  await page.getByRole("button", { name: "Use filename suggestion", exact: true }).click();
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "fixture" }));
  await page.getByRole("button", { name: "Watch this sample", exact: true }).click();
  await expect(page.locator('iframe[title="Reference video"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  await page.getByRole("dialog", { name: "Immersive playback" }).getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(page.locator('iframe[title="Reference video"]')).toHaveCount(0);
});

test("immersive controls are available in Simplified Chinese", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page);
  const meetingHash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "已保存在此设备", exact: true })).toBeVisible();
  await page.evaluate((hash) => { location.hash = hash; }, meetingHash);
  await page.getByRole("tab", { name: /说话人/ }).click();
  await page.getByRole("button", { name: "沉浸式播放", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "沉浸式播放" });
  await expect(dialog.getByRole("button", { name: "退出沉浸模式" })).toBeVisible();
  await expect(dialog.getByLabel("播放速度")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "阅读", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("搜索转录")).toBeVisible();
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
  await expect(page.getByText("See the people in the source video", { exact: true })).toHaveCount(0);
  await playbackMode.click();
  await page.locator(".playback-reference summary").click();
  const url = page.getByLabel("YouTube URL", { exact: true });
  const referenceModeNotice = page.locator('.speaker-review-panel > p.notice.sand[role="alert"]');
  await url.fill("https://www.youtube.com/watch?v=yslXlV2BP_Y");
  await expect(page.locator('.reference-video[data-unsaved-edit="true"]')).toHaveCount(1);
  await namingMode.click();
  await expect(namingMode).toHaveAttribute("aria-pressed", "false");
  await expect(playbackMode).toHaveAttribute("aria-pressed", "true");
  await expect(url).toHaveValue("https://www.youtube.com/watch?v=yslXlV2BP_Y");
  await expect(referenceModeNotice).toContainText(
    "Save or reset your video reference draft before switching modes.",
  );
  expect(youtubeRequests).toEqual([]);

  await url.fill("");
  await expect(page.locator('.reference-video[data-unsaved-edit="true"]')).toHaveCount(0);
  await namingMode.click();
  await expect(namingMode).toHaveAttribute("aria-pressed", "true");
  await expect(referenceModeNotice).toHaveCount(0);
  expect(youtubeRequests).toEqual([]);

  await playbackMode.click();
  await page.locator(".playback-reference summary").click();
  await expect(url).toHaveValue("");
  await expect(referenceModeNotice).toHaveCount(0);
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
  await expect(page.locator(".speaker-queue-item")).toHaveCount(2);
  await name.fill(" Alex ");
  await page.getByRole("button", { name: "Confirm name", exact: true }).first().click();
  await expect(page.locator(".speaker-queue-item")).toHaveCount(1);
  await expect(page.getByLabel("Name for speaker 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmed", exact: true }).click();
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
  await expect(page.locator(".speaker-queue-item")).toHaveCount(2);
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
  // The window keeps its place until the playhead is well away from it, but must still contain the nearest caption.
  await expect(list.locator("button").filter({ hasText: "Long caption" })).not.toHaveCount(0);
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
    "data-tooltip",
    "Edit meeting details",
  );
  await expect(page.getByRole("button", { name: "Delete meeting", exact: true })).toHaveAttribute(
    "data-tooltip",
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
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  await page.locator(".playback-reference summary").click();
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
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  await page.locator(".playback-reference summary").click();
  await expect(page.getByLabel("Audio-to-video offset (seconds)", { exact: true })).toHaveValue("5");
});

test("speaker review stays usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createFixture(page);
  const stage = page.locator(".speaker-review-workspace");
  const box = await stage.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const violationDetails = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      html: node.html,
      summary: node.failureSummary,
    })),
  }));
  expect(result.violations.map((violation) => violation.id), JSON.stringify(violationDetails)).toEqual([]);
  const transcript = page.getByRole("region", { name: "Related transcript", exact: true });
  await transcript.focus();
  await expect(transcript).toBeFocused();
  await page.getByLabel("Name for speaker 1", { exact: true }).focus();
  await expect(page.getByLabel("Name for speaker 1", { exact: true })).toBeFocused();
});

test("speaker mode buttons retain readable contrast throughout a mode switch", async ({ page }) => {
  await createFixture(page);
  const result = await page.locator(".speaker-mode-switch").evaluate(async (group) => {
    await Promise.all(group.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    const luminance = (values: number[]) => values.reduce((sum, value, index) => {
      const s = value / 255;
      return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const observed: number[] = [];
    const transitions: string[] = [];
    const animations: string[] = [];
    const buttons = [...group.querySelectorAll("button")];
    const sample = () => {
      for (const button of buttons) {
        const style = getComputedStyle(button);
        transitions.push(style.transitionProperty);
        animations.push(style.animationName);
        const foreground = luminance(rgb(style.color).slice(0, 3));
        const background = rgb(style.backgroundColor);
        const alpha = background[3] ?? 1;
        const behind = rgb(getComputedStyle(group).backgroundColor);
        const blended = background.slice(0, 3).map((value, index) => value * alpha + behind[index] * (1 - alpha));
        const back = luminance(blended);
        observed.push((Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05));
      }
    };
    sample();
    buttons[0].click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    sample();
    await Promise.all(group.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    sample();
    return { observed, transitions, animations };
  });
  // Foreground/background change immediately; if animated colors are introduced,
  // explicitly sample those animations rather than silently losing transition coverage.
  expect(result.transitions.flatMap((value) => value.split(",").map((property) => property.trim()))).not.toEqual(expect.arrayContaining(["all"]));
  expect(result.transitions.flatMap((value) => value.split(",").map((property) => property.trim()))).not.toEqual(expect.arrayContaining(["color"]));
  expect(result.transitions.flatMap((value) => value.split(",").map((property) => property.trim()))).not.toEqual(expect.arrayContaining(["background"]));
  expect(result.transitions.flatMap((value) => value.split(",").map((property) => property.trim()))).not.toEqual(expect.arrayContaining(["background-color"]));
  expect(result.animations.every((value) => value === "none")).toBe(true);
  expect(result.observed).toHaveLength(6);
  expect(Math.min(...result.observed)).toBeGreaterThanOrEqual(4.5);
});

test("playback mode exposes gap jump, direct speaker rename focus, video badge, and WCAG AA compliance", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createFixture(page, "The State of Startups in 2026 [yslXlV2BP_Y].mp3");
  await expect(page.getByText("0 / 2 confirmed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const playback = page.locator(".playback-mode");
  await expect(playback).toBeVisible();
  await expect(playback.locator(".playback-reference-badge")).toHaveText("Video ID suggested");

  // Silent gap at 0.0s offers a quick-jump action to the next speech at 0.1s
  const nextSpeech = playback.getByRole("button", { name: /Next speech/ });
  await expect(nextSpeech).toBeVisible();
  await nextSpeech.click();
  await expect.poll(() => page.locator("audio").evaluate((el) => (el as HTMLMediaElement).paused)).toBe(true);
  await expect
    .poll(() => page.locator("audio").evaluate((el) => (el as HTMLMediaElement).currentTime))
    .toBeGreaterThanOrEqual(0.1);

  await playback.locator(".playback-caption-row").last().click();
  await expect.poll(() => page.locator("audio").evaluate((el) => (el as HTMLMediaElement).paused)).toBe(true);
  await expect(playback.locator('[data-fragment-active="true"]')).not.toHaveCount(0);

  // Verify WCAG 2.1 AA compliance inside Playback mode
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id), JSON.stringify(axe.violations)).toEqual([]);

  // Clicking Speaker 2 card switches to Edit speakers and focuses Speaker 2 input
  await playback.locator(".playback-speaker").nth(1).click();
  await expect(page.getByRole("button", { name: "Edit speakers", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Name for speaker 2", { exact: true })).toBeFocused();
});

test("following playback does not reflow rows or swap the caption window on every caption", async ({ page }) => {
  test.setTimeout(120_000);
  await createFixture(page, "long-fixture.wav", longFixtureMeeting());
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const list = page.locator(".playback-mode .playback-transcript-list");
  await expect(list.locator("button")).toHaveCount(80);
  await expect(page.getByText("Following playback", { exact: true })).toBeVisible();
  const audio = page.locator("audio");
  const heights = new Map<string, number>();
  let heightChanges = 0;
  let windowSwaps = 0;
  let scrollMoves = 0;
  let previousFirst = "";
  let previousTop = -1;
  for (let time = 0.3; time < 38; time += 0.25) {
    await audio.evaluate((element, value) => {
      const media = element as HTMLMediaElement;
      media.currentTime = value;
      media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
    }, time);
    const sample = await list.evaluate((element) => ({
      top: element.scrollTop,
      first: element.querySelector("button")?.getAttribute("data-caption-id") ?? "",
      rows: [...element.querySelectorAll("button")].map((row) => [row.getAttribute("data-caption-id") ?? "", row.getBoundingClientRect().height] as const),
    }));
    if (previousFirst && sample.first !== previousFirst) windowSwaps += 1;
    if (previousTop >= 0 && Math.abs(sample.top - previousTop) > 0.5) scrollMoves += 1;
    previousFirst = sample.first;
    previousTop = sample.top;
    for (const [id, height] of sample.rows) {
      const known = heights.get(id);
      if (known !== undefined && Math.abs(known - height) > 0.5) heightChanges += 1;
      heights.set(id, height);
    }
  }
  console.log(JSON.stringify({ heightChanges, windowSwaps, scrollMoves }));
  expect(heightChanges).toBe(0);
  expect(windowSwaps).toBeLessThanOrEqual(6);
});

test("nothing around the captions moves or resizes while people talk, pause and switch speakers", async ({ page }) => {
  test.setTimeout(120_000);
  await createFixture(page, "long-fixture.wav", longFixtureMeeting());
  await page.getByRole("button", { name: "Playback mode", exact: true }).click();
  const selectors = [
    ".playback-stage", ".playback-stage-heading", ".playback-state", ".playback-gap", ".playback-current-content", ".live-caption-head",
    ".playback-roster", ".playback-stage-footer", ".playback-transcript-panel", ".playback-transcript-head",
    ".playback-transcript-list", ".playback-transcript-paging", ".audio-player", ".audio-player input[type=range]",
    ".audio-player .play-button", ".audio-player select",
  ];
  const speakerCount = await page.locator(".playback-speaker").count();
  const audio = page.locator("audio");
  const baseline = new Map<string, string>();
  const moved: string[] = [];
  const snapshot = () => page.evaluate(({ selectors: list }) => {
    const out: Record<string, string> = { scrollY: String(Math.round(window.scrollY)) };
    for (const selector of list) {
      document.querySelectorAll(selector).forEach((element, index) => {
        const box = element.getBoundingClientRect();
        out[`${selector}#${index}`] = [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10) / 10).join(",");
      });
    }
    document.querySelectorAll(".playback-speaker").forEach((element, index) => {
      const box = element.getBoundingClientRect();
      out[`.playback-speaker#${index}`] = [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10) / 10).join(",");
    });
    return out;
  }, { selectors });
  let step = 0;
  for (let time = 0.1; time < 39; time += 0.2) {
    await audio.evaluate((element, value) => {
      const media = element as HTMLMediaElement;
      media.currentTime = value;
      media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
    }, time);
    if (step % 9 === 0) await audio.evaluate((element) => void (element as HTMLMediaElement).play());
    if (step % 9 === 5) await audio.evaluate((element) => (element as HTMLMediaElement).pause());
    step += 1;
    const sample = await snapshot();
    for (const [key, value] of Object.entries(sample)) {
      if (!baseline.has(key)) baseline.set(key, value);
      else if (baseline.get(key) !== value) moved.push(`${key}: ${baseline.get(key)} -> ${value} at ${time.toFixed(1)}s`);
    }
  }
  expect(speakerCount).toBeGreaterThan(0);
  expect(moved.slice(0, 12)).toEqual([]);
});

// A meeting shaped like a long chunked recording: 19 per-part speakers and captions from 2 to 30 words.
function immersiveLayoutMeeting() {
  const base = fixtureMeeting();
  const parts = [4, 5, 3, 4, 3];
  const ids: string[] = [];
  const speakers = parts.flatMap((count, part) => Array.from({ length: count }, (_, i) => {
    const index = ids.length;
    const id = index < 2 ? speakerIds[index] : `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`;
    ids.push(id);
    return { id, name: `Speaker ${i + 1} (part ${part + 1})`, confirmed: false, sourceLabels: ["fixture"] };
  }));
  const words = ["I", "think", "we're", "seeing", "companies", "try", "many", "different", "things", "during", "the", "batch", "happening?", "Absolutely", "historically", "direction"];
  const order = [0, 7, 13, 18, 2, 9, 16, 5, 11, 1, 14, 6, 17, 3];
  const counts = [4, 22, 7, 30, 3, 16, 9, 26, 5, 18, 2, 12, 28, 6];
  const segments = [...base.segments];
  let time = 3;
  let n = 0;
  order.forEach((speakerIndex, captionIndex) => {
    for (let word = 0; word < counts[captionIndex]; word++) {
      const text = words[(n + word) % words.length];
      segments.push({ id: `40000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, revision: 1, start: time, end: time + 0.14, speakerIds: [ids[speakerIndex]], originalText: text, text, reviewed: false, parents: [] });
      time += 0.14;
    }
    time += 0.4;
  });
  return { meeting: { ...base, speakers, segments }, end: time };
}

test("immersive view keeps its layout while speakers, captions and highlights change", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1550, height: 890 });
  await page.addInitScript(() => {
    let active: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => active });
    HTMLElement.prototype.requestFullscreen = function () { active = document.querySelector(".immersive"); document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
    document.exitFullscreen = () => { active = null; document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
  });
  const { meeting, end } = immersiveLayoutMeeting();
  await createFixture(page, "long-fixture.wav", meeting);
  await page.getByRole("button", { name: "Immersive playback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".immersive-person")).toHaveCount(19);
  const audio = page.locator("audio");
  const measure = () => page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const row = document.querySelector(".immersive-transcript-list button.is-current");
    const fragments = row?.querySelector("span:nth-child(2)")?.children;
    const last = fragments?.[fragments.length - 1];
    const captions = document.querySelector(".immersive-captions");
    const word = captions?.querySelector('[data-current="true"]');
    const area = captions?.getBoundingClientRect();
    const spot = word?.getBoundingClientRect();
    return {
      layout: [box(".immersive-roster-bar")?.top, box(".immersive-current-speakers")?.top, box(".immersive-current-speakers")?.height, box(".immersive-status")?.top, box(".immersive-status")?.height, box(".immersive-captions")?.top, box(".immersive-captions")?.height, box(".immersive-controls")?.top],
      rowId: row?.getAttribute("data-immersive-caption") ?? null,
      lastWordLeft: last && row ? last.getBoundingClientRect().left - row.getBoundingClientRect().left : null,
      wordInCaptionArea: area && spot ? spot.bottom <= area.bottom + 1 && spot.top >= area.top - 1 : null,
    };
  });
  const sweep = async () => {
    const first = (await measure()).layout;
    let layoutMoves = 0;
    let wordJitter = 0;
    let withWord = 0;
    let wordHidden = 0;
    let previous: Awaited<ReturnType<typeof measure>> | null = null;
    for (let time = 3; time < end; time += 0.5) {
      await audio.evaluate((element, value) => { const media = element as HTMLMediaElement; media.currentTime = value; media.dispatchEvent(new Event("timeupdate")); }, time);
      const now = await measure();
      if (now.layout.some((value, index) => Math.abs((value ?? 0) - (first[index] ?? 0)) > 0.5)) layoutMoves++;
      if (previous && now.rowId && previous.rowId === now.rowId && now.lastWordLeft !== null && previous.lastWordLeft !== null && Math.abs(now.lastWordLeft - previous.lastWordLeft) > 0.5) wordJitter++;
      if (now.wordInCaptionArea !== null) { withWord++; if (!now.wordInCaptionArea) wordHidden++; }
      previous = now;
    }
    return { layoutMoves, wordJitter, withWord, wordHidden };
  };
  // The roster, status lines, captions area and controls must stay exactly where they were at the start, whichever
  // speaker is active and however long the caption is; the highlight must not move the words after it; and the word
  // being spoken must stay inside the captions area, which scrolls on its own.
  await dialog.getByRole("button", { name: "Play audio" }).click();
  // Keep the controls visible while this sweep isolates layout changes caused by captions and speaker changes.
  await page.keyboard.press("Tab");
  await dialog.getByRole("button", { name: "Pause audio" }).focus();
  const playing = await sweep();
  expect(playing).toMatchObject({ layoutMoves: 0, wordJitter: 0, wordHidden: 0 });
  expect(playing.withWord).toBeGreaterThan(50);
  await dialog.getByRole("button", { name: "Pause audio" }).click();
  const paused = await sweep();
  expect(paused).toMatchObject({ layoutMoves: 0, wordJitter: 0, wordHidden: 0 });
});

test("speaker queue filters, compares samples, and preserves separate name confirmation", async ({ page }) => {
  await createFixture(page);
  const queue = page.getByRole("region", { name: "Speaker review queue" });
  await expect(queue.locator(".speaker-queue-item")).toHaveCount(2);
  await expect(page.locator(".speaker-review-card")).toHaveCount(1);
  await page.getByLabel("Search speakers").fill(speakerIds[1]);
  await expect(queue.locator(".speaker-queue-item")).toHaveCount(1);
  await queue.locator(".speaker-queue-select").click();
  await expect(page.getByLabel("Name for speaker 2", { exact: true })).toBeVisible();
  await page.getByLabel("Search speakers").fill("");
  await page.getByLabel("Compare with speaker").selectOption(speakerIds[0]);
  await expect(page.locator(".speaker-comparison")).toContainText(speakerIds[0]);
  await expect(page.locator(".speaker-comparison").getByRole("button", { name: "Sample 1" })).toBeEnabled();
  await page.getByLabel("Name for speaker 2", { exact: true }).fill("Casey");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.locator(".speaker-identity")).toContainText("Unconfirmed");
  await page.getByRole("button", { name: "Confirm name", exact: true }).click();
  await expect(page.getByLabel("Name for speaker 1", { exact: true })).toBeVisible();
  await expect(queue.locator(".speaker-queue-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Confirmed", exact: true }).click();
  await expect(queue.locator(".speaker-queue-item")).toContainText("Casey");
});

test("speaker review columns reflow without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createFixture(page);
  const workspace = page.locator(".speaker-review-workspace");
  const queue = workspace.locator(".speaker-review-queue");
  const voice = workspace.locator(".speaker-voice-review");
  const identity = workspace.locator(".speaker-identity");
  const [a, b, c] = await Promise.all([queue.boundingBox(), voice.boundingBox(), identity.boundingBox()]);
  expect(a && b && c).toBeTruthy();
  expect(b!.y).toBeGreaterThan(a!.y);
  expect(c!.y).toBeGreaterThan(b!.y);
  expect(await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await expect(page.getByLabel("Search speakers")).toBeVisible();
});

test("persistent audio player aligns with workspace at desktop and mobile widths", async ({ page }) => {
  await createFixture(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const panel = await page.locator(".speaker-review-panel").boundingBox();
    const player = await page.locator(".audio-player").boundingBox();
    expect(panel && player).toBeTruthy();
    expect(Math.abs(panel!.x - player!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(panel!.x + panel!.width - player!.x - player!.width)).toBeLessThanOrEqual(1);
  }
});

test("immersive table caption card keeps long source text readable on desktop and mobile", async ({ page }) => {
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  const meeting = fixtureMeeting();
  const text = "If you could, you would because it is that powerful. People will say I need this, and then continue with the next point.";
  meeting.segments[0].text = text;
  meeting.segments[0].originalText = text;
  for (let index = 3; index <= 4; index++) meeting.speakers.push({ ...meeting.speakers[0], id: `20000000-0000-4000-8000-00000000000${index}`, name: `Speaker ${index}` });
  await createFixture(page, "speaker-review.wav", meeting);
  await page.getByRole("button", { name: "Immersive playback" }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByRole("button", { name: "Table", exact: true }).click();
  await dialog.getByLabel("Playback position").fill("0.2");
  const caption = dialog.locator(".immersive-caption-content");
  await expect(caption).toContainText(text);
  await expect(dialog.locator(".immersive-caption-meta")).toContainText("Speaker 1");
  await expect.poll(() => caption.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("button", { name: "Close transcript" }).click();
  await expect(caption).toContainText(text);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await caption.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
});

test("immersive captions fit the stage when transcript width and viewport change", async ({ page }) => {
  const meeting = fixtureMeeting();
  const text = "If you could, you would because it is that powerful. People will say I need this, and then continue with the next point.";
  meeting.segments[0].text = text;
  meeting.segments[0].originalText = text;
  await page.addInitScript(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("unavailable")); });
  await createFixture(page, "speaker-review.wav", meeting);
  await page.getByRole("button", { name: "Immersive playback" }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await dialog.getByLabel("Playback position").fill("0.2");
  const caption = dialog.locator(".immersive-caption-content");
  await expect(caption).toContainText("If you could");
  await dialog.getByLabel("Transcript panel width").fill("45");
  await expect.poll(() => caption.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const exitFullscreen = dialog.getByRole("button", { name: "Exit full screen" });
  if (await exitFullscreen.count()) await exitFullscreen.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => caption.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  expect(await caption.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
});

test("immersive fullscreen control returns to the player without stopping playback", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Native fullscreen is verified in Chromium; WebKit falls back when unsupported.");
  await createFixture(page);
  await page.getByRole("button", { name: "Immersive playback" }).click();
  const dialog = page.getByRole("dialog", { name: "Immersive playback" });
  await expect(dialog.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await dialog.getByRole("button", { name: "Exit full screen" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enter full screen" })).toBeVisible();
  await dialog.getByRole("button", { name: "Enter full screen" }).click();
  await expect(dialog.getByRole("button", { name: "Exit full screen" })).toBeVisible();
});

test("speaker avatar is local, survives reload and full backup restore", async ({ page }, info) => {
  await createFixture(page);
  const identity = page.getByRole("region", { name: "Speaker identity" });
  await expect(identity.locator(".speaker-avatar svg")).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 20;
    const context = canvas.getContext("2d")!; context.fillStyle = "#397a50"; context.fillRect(0, 0, 20, 20);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Upload speaker avatar").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(identity.locator(".speaker-avatar img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await expect(page.locator(".toast-layer")).toContainText("Speaker avatar saved locally.");
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.locator(".toast-layer")).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
  await expect(identity.locator(".speaker-avatar img")).toBeVisible();
  await page.getByText("Export", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Full backup with audio" }).click();
  const file = await download; const path = info.outputPath("avatar-backup.zip"); await file.saveAs(path);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".nav-file input").setInputFiles(path);
  await expect(page.getByRole("heading", { name: "Speaker UI fixture (restored)" })).toBeVisible();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
  await expect(page.getByRole("region", { name: "Speaker identity" }).locator(".speaker-avatar img")).toBeVisible();
});

test("dark speaker workspace preserves readable controls and content", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("meeting-memo:theme", "dark"); localStorage.setItem("meeting-memo:palette", "forest"); });
  await createFixture(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);
});

test("persistent player skips without changing the playback state", async ({ page }) => {
  await createFixture(page);
  const player = page.locator(".audio-player");
  const audio = page.locator("audio");
  await player.getByRole("button", { name: "Forward 15 seconds" }).click();
  await expect.poll(() => audio.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBe(15);
  await player.getByRole("button", { name: "Back 15 seconds" }).click();
  await expect.poll(() => audio.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBe(0);
  await expect(player.getByRole("button", { name: "Play audio" })).toBeVisible();
});

test("Chinese transcript filter keeps its checkbox and label on one line", async ({ page }) => {
  await createFixture(page);
  await page.getByLabel("Display language", { exact: true }).selectOption("zh-CN");
  await page.getByRole("tab", { name: /转录/ }).click();
  const filter = page.getByRole("checkbox", { name: "需要审阅" });
  await expect(filter).toBeVisible();
  const label = filter.locator("..");
  const dimensions = await label.evaluate((element) => ({ height: element.getBoundingClientRect().height, style: getComputedStyle(element).whiteSpace }));
  expect(dimensions.style).toBe("nowrap");
  expect(dimensions.height).toBeLessThan(50);
});
