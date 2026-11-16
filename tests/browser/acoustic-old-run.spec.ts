import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { ACOUSTIC_POLICY } from "../../src/domain/acoustic-speaker";

/**
 * Pending integration in feat/browser-speaker-continuity. This browser test
 * deliberately models the old completed-run shape: the provider run and
 * meeting transcript remain, while chunkSpeech and transcriptPages are gone.
 * It must be copied into that app worktree after the old-run fallback is wired.
 */
test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 180_000 });

const base = "/PWA-AI-Meeting-Memo-BYOK/";
const meetingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const memoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const segmentIds = [
  "part-0:a-1",
  "part-0:a-2",
  "part-0:b-1",
  "part-0:b-2",
  "part-1:a-1",
  "part-1:a-2",
  "part-1:b-1",
  "part-1:b-2",
] as const;

type Chunk = {
  index: number;
  byteLength: number;
  sha256: string;
  ownStartSeconds: number;
  ownDurationSeconds: number;
  leadInSeconds: number;
};

type OldRunFixture = {
  meeting: Record<string, unknown>;
  manifest: Record<string, unknown>;
  chunkBytes: number[][];
};

function sha256(value: Uint8Array | Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function syntheticMp3(marker: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const bytes = Buffer.alloc(2_000 * frame.length);
  for (let offset = 0; offset < bytes.length; offset += frame.length) {
    frame[4] = marker;
    frame.copy(bytes, offset);
  }
  return bytes;
}

function segment(
  id: string,
  start: number,
  end: number,
  speakerId: string,
  text: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    revision: 1,
    start,
    end,
    speakerIds: [speakerId],
    originalText: text,
    text,
    reviewed: false,
    parents: [],
    ...overrides,
  };
}

function oldRunFixture(): OldRunFixture {
  const now = "2026-11-10T00:00:00.000Z";
  const speakers = [
    { id: "part-0:voice-a", name: "Speaker A (part 1)", confirmed: false, sourceLabels: ["part-0:A"] },
    { id: "part-0:voice-b", name: "Speaker B (part 1)", confirmed: false, sourceLabels: ["part-0:B"] },
    { id: "part-1:voice-a", name: "Speaker A (part 2)", confirmed: false, sourceLabels: ["part-1:A"] },
    { id: "part-1:voice-b", name: "Speaker B (part 2)", confirmed: false, sourceLabels: ["part-1:B"] },
  ];
  const originalSegments = [
    segment(segmentIds[0], 5, 9, "part-0:voice-a", "A part one first turn."),
    segment(segmentIds[1], 15, 19, "part-0:voice-a", "A part one second turn."),
    segment(segmentIds[2], 25, 29, "part-0:voice-b", "B part one first turn."),
    segment(segmentIds[3], 35, 39, "part-0:voice-b", "B part one second turn."),
    segment(segmentIds[4], 55, 59, "part-1:voice-a", "A part two first turn."),
    segment(segmentIds[5], 65, 69, "part-1:voice-a", "A part two second turn."),
    segment(segmentIds[6], 75, 79, "part-1:voice-b", "B part two first turn."),
    segment(segmentIds[7], 85, 89, "part-1:voice-b", "B part two second turn."),
  ];
  // Keep one human edit in the current projection. The provider run remains
  // the unedited original and must survive local acoustic re-projection.
  const currentSegments = originalSegments.map((value) =>
    value.id === segmentIds[6]
      ? {
          ...value,
          text: "Human-edited B part two first turn.",
          reviewed: true,
        }
      : value,
  );
  const chunkBuffers = [syntheticMp3(0x11), syntheticMp3(0x22)];
  const chunks: Chunk[] = chunkBuffers.map((bytes, index) => ({
    index,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    ownStartSeconds: index * 50,
    ownDurationSeconds: 50,
    leadInSeconds: 0,
  }));
  const unsignedManifest = {
    meetingId,
    format: "mp3" as const,
    mimeType: "audio/mpeg",
    totalSeconds: 100,
    sampleRate: 44_100,
    totalBytes: chunkBuffers.reduce((total, bytes) => total + bytes.byteLength, 0),
    createdAt: now,
    chunks,
  };
  const manifestSha256 = sha256(
    JSON.stringify({
      meetingId: unsignedManifest.meetingId,
      format: unsignedManifest.format,
      mimeType: unsignedManifest.mimeType,
      totalSeconds: unsignedManifest.totalSeconds,
      sampleRate: unsignedManifest.sampleRate,
      totalBytes: unsignedManifest.totalBytes,
      createdAt: unsignedManifest.createdAt,
      chunks: unsignedManifest.chunks,
    }),
  );
  const manifest = { ...unsignedManifest, manifestSha256 };
  const meeting = {
    schemaVersion: 1,
    version: 0,
    id: meetingId,
    title: "Old completed chunked run",
    date: "2026-11-10",
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
    speakers,
    segments: currentSegments,
    history: [],
    undo: [],
    memos: [
      {
        id: memoId,
        createdAt: now,
        sourceRevision: 1,
        model: "fixture-model",
        items: [
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            type: "summary",
            text: "Existing reviewed memo",
            ownerId: null,
            dueDate: null,
            dueOriginal: null,
            sources: [{ id: segmentIds[0], revision: 1 }],
            review: "accepted",
            reviewedRevision: 1,
          },
        ],
        originalItems: [
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            type: "summary",
            text: "Original memo wording",
            ownerId: null,
            dueDate: null,
            dueOriginal: null,
            sources: [{ id: segmentIds[0], revision: 1 }],
            review: "accepted",
            reviewedRevision: 1,
          },
        ],
      },
    ],
    jobs: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        stage: "speech",
        state: "completed",
        billing: "provider_reported",
        createdAt: now,
        updatedAt: now,
        requestId: "old-openrouter-run",
        usage: {
          inputTokens: null,
          outputTokens: null,
          seconds: 100,
          cachedInputTokens: null,
          cacheWriteTokens: null,
          totalTokens: null,
        },
        estimateUsd: null,
        estimateDetails: null,
        provider: "openrouter",
        model: "openai/whisper-1",
        reportedCostUsd: 0,
        message: "Completed before local speaker analysis.",
        inputRevision: 1,
        chunk: { index: 1, total: 2 },
      },
    ],
    audio: {
      name: "old-completed-run.mp3",
      type: "audio/mpeg",
      size: unsignedManifest.totalBytes,
      duration: unsignedManifest.totalSeconds,
      hash: manifestSha256,
      present: true,
      chunked: {
        format: "mp3",
        chunkCount: chunks.length,
        totalSeconds: unsignedManifest.totalSeconds,
        manifestSha256,
      },
    },
    runs: [
      {
        id: runId,
        provider: "openrouter",
        model: "openai/whisper-1",
        createdAt: now,
        speakers,
        originalSegments,
      },
    ],
  };
  return {
    meeting,
    manifest,
    chunkBytes: chunkBuffers.map((bytes) => [...bytes]),
  };
}

const readySpeakerManifest = {
  schemaVersion: 1,
  status: "ready",
  deferred: true,
  precache: false,
  appBasePath: base,
  basePath: `${base}speaker-assets/`,
  model: {
    id: "Xenova/wavlm-base-plus-sv",
    revision: "e61029603001bd11295c36d878698708bf59190f",
    dtype: "q8",
    dimensions: 512,
  },
  runtime: {
    package: "onnxruntime-web",
    version: "1.31.0-dev.20260914-8d85527a0",
    backend: "wasm",
    numThreads: 1,
  },
  assets: [
    ["model/wavlm-base-plus-sv/config.json", 58_609, "75efe37fb015f22d82af367dcef974c39119fa4c6505d16a82d86f604a431f4e"],
    ["model/wavlm-base-plus-sv/preprocessor_config.json", 215, "99272fe8ccfab114b68b478681ea47ee3a1ce62bb788cb92dd6e4f69fb1f1da2"],
    ["model/wavlm-base-plus-sv/quantize_config.json", 1_154, "b073ca6f0ade094cfa676150989f20dc15e1a5b40826f6f0aac85fa99626dbea"],
    ["model/wavlm-base-plus-sv/onnx/model_quantized.onnx", 101_683_453, "576bf6017796bdd179824d801b3a355a1dda2451559c6a398562175e33589f68"],
    ["runtime/ort-wasm-simd-threaded.asyncify.mjs", 53_057, "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611"],
    ["runtime/ort-wasm-simd-threaded.asyncify.wasm", 26_861_777, "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082"],
  ].map(([file, bytes, sha256]) => ({
    path: `speaker-assets/${file}`,
    bytes,
    sha256,
  })),
};

function installDeterministicLocalEmbedding(page: Page, holdModel = false) {
  return page.addInitScript((hold) => {
    class DeterministicWorker extends EventTarget {
      postMessage(message: {
        type: string;
        requestId: number;
        samples?: Float32Array;
      }) {
        if (hold && message.type === "load") return;
        queueMicrotask(() => {
          if (message.type === "load") {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  type: "ready",
                  requestId: message.requestId,
                  modelId: "Xenova/wavlm-base-plus-sv",
                  modelRevision: "e61029603001bd11295c36d878698708bf59190f",
                  transformersVersion: "4.3.2",
                },
              }),
            );
            return;
          }
          if (message.type !== "embed" || !message.samples) return;
          const mean = message.samples.reduce((sum, value) => sum + value, 0) / message.samples.length;
          const values = new Float32Array(512);
          values[mean > 0.4 ? 1 : 0] = 1;
          this.dispatchEvent(
            new MessageEvent("message", {
              data: { type: "embedding", requestId: message.requestId, values },
            }),
          );
        });
      }

      terminate() {}
    }
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: DeterministicWorker,
    });

    class DeterministicAudioContext {
      async decodeAudioData() {
        const sampleRate = 16_000;
        const values = new Float32Array(sampleRate * 60);
        for (let index = 0; index < values.length; index += 1) {
          const seconds = index / sampleRate;
          values[index] =
            // Two steady levels stand in for two voices. They stay well inside full scale:
            // a window at or beyond it is rejected as clipped, like silence.
            seconds >= 5 && seconds < 19
              ? 0.2
              : seconds >= 25 && seconds < 39
                ? 0.6
                : 0;
        }
        return {
          numberOfChannels: 1,
          sampleRate,
          length: values.length,
          getChannelData: () => values,
        } as unknown as AudioBuffer;
      }

      close() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      writable: true,
      value: DeterministicAudioContext,
    });
  }, holdModel);
}

async function seedOldRun(page: Page, fixture: OldRunFixture) {
  await expect(page.getByRole("heading", { name: "Your meetings.", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator(".loading-library")).toHaveCount(0);
  await page.evaluate(
    ({ meeting, manifest, chunkBytes }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("meeting-memo-byok-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const id = meeting.id as string;
          const transaction = database.transaction(
            ["meetings", "audio", "audioChunks", "audioManifests", "chunkSpeech", "transcriptPages"],
            "readwrite",
          );
          transaction.objectStore("meetings").put(meeting);
          transaction.objectStore("audio").delete(id);
          transaction.objectStore("audioManifests").put(manifest, id);
          const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
          transaction.objectStore("audioChunks").delete(range);
          transaction.objectStore("chunkSpeech").delete(range);
          const pageRange = IDBKeyRange.bound([id, "", 0], [id, "\uffff", Infinity]);
          transaction.objectStore("transcriptPages").delete(pageRange);
          chunkBytes.forEach((bytes, index) =>
            transaction.objectStore("audioChunks").put(new Uint8Array(bytes).buffer, [id, index]),
          );
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    fixture,
  );
}

async function readMeeting(page: Page) {
  return page.evaluate(
    (id) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = indexedDB.open("meeting-memo-byok-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const get = database.transaction("meetings", "readonly").objectStore("meetings").get(id);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            database.close();
            resolve(get.result as Record<string, unknown>);
          };
        };
      }),
    meetingId,
  );
}

async function readCheckpointState(page: Page) {
  return page.evaluate((id) => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const get = database.transaction("acousticCheckpoints", "readonly").objectStore("acousticCheckpoints").get(id);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => { database.close(); resolve(get.result?.state ?? null); };
    };
  }), meetingId);
}

async function readOldStoreCounts(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ chunks: number; chunkSpeech: number; transcriptPages: number }>((resolve, reject) => {
        const request = indexedDB.open("meeting-memo-byok-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["audioChunks", "chunkSpeech", "transcriptPages"],
            "readonly",
          );
          const counts = {
            chunks: transaction.objectStore("audioChunks").count(),
            chunkSpeech: transaction.objectStore("chunkSpeech").count(),
            transcriptPages: transaction.objectStore("transcriptPages").count(),
          };
          transaction.oncomplete = () => {
            database.close();
            resolve({
              chunks: counts.chunks.result,
              chunkSpeech: counts.chunkSpeech.result,
              transcriptPages: counts.transcriptPages.result,
            });
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
}

function transcriptSnapshot(meeting: Record<string, unknown>) {
  return (meeting.segments as Record<string, unknown>[]).map((segment) => ({
    id: segment.id,
    text: segment.text,
    originalText: segment.originalText,
    speakerIds: segment.speakerIds,
  }));
}

test("re-analyzes an old completed chunked run without provider traffic or data loss", async ({ page }) => {
  const outgoing: string[] = [];
  await page.route("https://**/*", (route) => route.abort());
  await page.route("**/speaker-assets/manifest.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readySpeakerManifest),
    }),
  );
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1") && !request.url().startsWith("http://localhost")) {
      outgoing.push(request.url());
    }
  });
  await installDeterministicLocalEmbedding(page);
  await page.goto(base);

  const fixture = oldRunFixture();
  await seedOldRun(page, fixture);
  await expect.poll(() => readOldStoreCounts(page)).toEqual({
    chunks: 2,
    chunkSpeech: 0,
    transcriptPages: 0,
  });
  await page.evaluate((id) => {
    location.hash = `#/meetings/${id}`;
  }, meetingId);
  // Set the initial route before reloading; a startup hashchange listener may not be attached yet.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Old completed chunked run", exact: true, level: 1 })).toBeVisible();
  const before = await readMeeting(page);
  expect(before.runs).toHaveLength(1);
  expect(before.segments).toHaveLength(8);

  const analyze = page.getByRole("button", { name: "Auto-match voices", exact: true });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await page.getByRole("dialog").getByRole("button", { name: "Download and analyze locally", exact: true }).click();
  await expect(
    page.getByText(/Anonymous voice continuity was updated locally\./),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".speaker-queue-item")).toHaveCount(2);
  expect(outgoing).toEqual([]);

  const after = await readMeeting(page);
  expect(transcriptSnapshot(after).map(({ id, text, originalText }) => ({ id, text, originalText }))).toEqual(
    transcriptSnapshot(before).map(({ id, text, originalText }) => ({ id, text, originalText })),
  );
  expect((after.runs as Record<string, unknown>[])[0]).toEqual((before.runs as Record<string, unknown>[])[0]);
  expect(after.runs).toHaveLength(1);
  expect((after.history as unknown[]).length).toBeGreaterThanOrEqual(8);
  expect(after.undo).toHaveLength(1);
  expect(new Set((after.segments as Record<string, unknown>[]).flatMap((segment) => segment.speakerIds as string[])).size).toBe(2);

  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const undone = await readMeeting(page);
  expect(transcriptSnapshot(undone)).toEqual(transcriptSnapshot(before));
  expect(undone.runs).toHaveLength(1);
});

test("prevents concurrent analysis and allows recovery after the owning tab closes", async ({ page, context }) => {
  await context.route("https://**/*", (route) => route.abort());
  await context.route("**/speaker-assets/manifest.json", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(readySpeakerManifest),
  }));
  await installDeterministicLocalEmbedding(page, true);
  await page.goto(base);
  test.skip(!(await page.evaluate(() => Boolean(navigator.locks))), "Web Locks unavailable in this browser");
  await seedOldRun(page, oldRunFixture());
  await page.evaluate((id) => { location.hash = `#/meetings/${id}`; }, meetingId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Old completed chunked run", exact: true, level: 1 })).toBeVisible();
  const before = await readMeeting(page);

  const other = await context.newPage();
  await installDeterministicLocalEmbedding(other);
  await other.goto(`${base}#/meetings/${meetingId}`);
  await expect(other.getByRole("heading", { name: "Old completed chunked run", exact: true, level: 1 })).toBeVisible();
  const start = async (target: Page) => {
    const analyze = target.getByRole("button", { name: "Auto-match voices", exact: true });
    await expect(analyze).toBeEnabled();
    await analyze.click();
    await target.getByRole("dialog").getByRole("button", { name: "Download and analyze locally", exact: true }).click();
  };
  await start(page);
  await expect.poll(() => other.evaluate(async (id) =>
    (await navigator.locks.query()).held?.some((lock) => lock.name === `meeting-memo-job:${id}`), meetingId)).toBe(true);
  await expect.poll(() => readCheckpointState(other)).toBe("running");
  await start(other);
  await expect(other.getByText("Another tab is processing this meeting.")).toBeVisible();
  expect(await readMeeting(other)).toEqual(before);
  expect(await readCheckpointState(other)).toBe("running");

  await page.close();
  await expect.poll(() => other.evaluate(async (id) =>
    (await navigator.locks.query()).held?.some((lock) => lock.name === `meeting-memo-job:${id}`) ?? false, meetingId)).toBe(false);
  await start(other);
  await expect(other.getByText(/Anonymous voice continuity was updated locally\./)).toBeVisible({ timeout: 90_000 });
  expect(await readCheckpointState(other)).toBe("completed");
  const after = await readMeeting(other);
  expect((after.runs as unknown[])[0]).toEqual((before.runs as unknown[])[0]);
  expect(transcriptSnapshot(after).map(({ id, text, originalText }) => ({ id, text, originalText }))).toEqual(
    transcriptSnapshot(before).map(({ id, text, originalText }) => ({ id, text, originalText })),
  );
  expect(after.undo).toHaveLength(1);
});

test("refuses local voice analysis when cross-tab locks are unavailable", async ({ page }) => {
  await installDeterministicLocalEmbedding(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }));
  await page.goto(base);
  await seedOldRun(page, oldRunFixture());
  await page.evaluate((id) => { location.hash = `#/meetings/${id}`; }, meetingId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Old completed chunked run", exact: true, level: 1 })).toBeVisible();
  const before = await readMeeting(page);
  const analyze = page.getByRole("button", { name: "Auto-match voices", exact: true });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await page.getByRole("dialog").getByRole("button", { name: "Download and analyze locally", exact: true }).click();
  await expect(page.getByText("Local voice analysis requires browser support for cross-tab locking. Use a supported browser or continue without voice analysis.")).toBeVisible();
  expect(await readMeeting(page)).toEqual(before);
  expect(await readCheckpointState(page)).toBeNull();
});

test("suggests the most similar voice in speaker review and merges it reversibly", async ({ page, browserName }) => {
  await page.route("https://**/*", (route) => route.abort());
  await page.route("**/speaker-assets/manifest.json", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(readySpeakerManifest) }),
  );
  await installDeterministicLocalEmbedding(page);
  await page.goto(base);
  await seedOldRun(page, oldRunFixture());
  await page.reload();
  // Wait for the app to mount so the hash change is not lost.
  await expect(page.getByRole("heading", { name: "Your meetings.", exact: true })).toBeVisible();
  await page.evaluate((id) => { location.hash = `#/meetings/${id}`; }, meetingId);
  await expect(page.getByRole("heading", { name: "Old completed chunked run", exact: true })).toBeVisible();

  // No local analysis has run yet: there is nothing to compare, so no hint panel.
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.locator(".speaker-queue-item")).toHaveCount(4);
  const hints = page.getByRole("region", { name: "Most similar voices", exact: true });
  await expect(hints).toHaveCount(0);

  await page.getByRole("button", { name: "Auto-match voices", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Download and analyze locally", exact: true }).click();
  await expect(page.getByText(/Anonymous voice continuity was updated locally\./)).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".speaker-queue-item")).toHaveCount(2);
  // The two remaining voices are unlike each other.
  await expect(hints.getByText("No other speaker sounds similar. This may be a separate person.")).toBeVisible();

  // Undo the automatic grouping; the saved vectors still describe the four labels.
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("tab", { name: /Speakers/ }).click();
  await expect(page.locator(".speaker-queue-item")).toHaveCount(4);

  await page.locator(".speaker-queue-select", { hasText: "Speaker B (part 1)" }).click();
  const suggestion = hints.locator(".voice-suggestion");
  await expect(suggestion).toHaveCount(1);
  await expect(suggestion).toContainText("Speaker B (part 2)");
  await expect(suggestion).toContainText("Similarity: High");
  await suggestion.getByRole("button", { name: "Not the same", exact: true }).click();
  await expect(suggestion).toHaveCount(0);
  // The judgement is saved with the meeting, so it survives a reload and constrains later matching.
  await expect.poll(async () => ((await readMeeting(page)).voiceDecisions as unknown[] | undefined)?.length ?? 0).toBe(1);
  await expect(hints.getByText(/Marked as not the same as 1 other speaker/)).toBeVisible();
  expect((await readMeeting(page)).speakers).toHaveLength(4);

  await page.locator(".speaker-queue-select", { hasText: "Speaker A (part 1)" }).click();
  await expect(suggestion).toContainText("Speaker A (part 2)");
  // Both clean samples play back to back: this speaker's (5-9 s), then the candidate's (55-59 s).
  // The synthetic MP3 does not advance in Playwright's WebKit build, so playback is checked in Chromium only.
  if (browserName === "chromium") {
    const position = async () => Number(await page.getByRole("slider", { name: "Playback position", exact: true }).inputValue());
    await suggestion.getByRole("button", { name: "Play both", exact: true }).click();
    await expect.poll(position).toBeGreaterThanOrEqual(5);
    expect(await position()).toBeLessThan(10);
    await expect.poll(position, { timeout: 20_000 }).toBeGreaterThanOrEqual(55);
    await expect.poll(position, { timeout: 20_000 }).toBeGreaterThanOrEqual(58.5);
    await page.waitForTimeout(1_500);
    expect(await position()).toBeLessThan(60.5);
  }
  const beforeMerge = await readMeeting(page);
  await suggestion.getByRole("button", { name: "Same person", exact: true }).click();
  await expect(page.getByText("Merged into Speaker A (part 1). Use Undo to restore.")).toBeVisible();
  await expect(page.locator(".speaker-queue-item")).toHaveCount(3);
  const merged = await readMeeting(page);
  expect((merged.speakers as { id: string }[]).map((speaker) => speaker.id)).toEqual(["part-0:voice-a", "part-0:voice-b", "part-1:voice-b"]);
  expect(transcriptSnapshot(merged).filter((segment) => (segment.speakerIds as string[])[0] === "part-0:voice-a")).toHaveLength(4);
  expect(transcriptSnapshot(merged).map(({ id, text, originalText }) => ({ id, text, originalText }))).toEqual(
    transcriptSnapshot(beforeMerge).map(({ id, text, originalText }) => ({ id, text, originalText })),
  );
  expect((merged.runs as unknown[])[0]).toEqual((beforeMerge.runs as unknown[])[0]);
  expect((merged.undo as unknown[]).length).toBe((beforeMerge.undo as unknown[]).length + 1);

  // The evaluation export downloads the saved vectors with pseudonyms only: no names, no transcript text.
  const downloading = page.waitForEvent("download");
  await hints.getByRole("button", { name: "Export voice evaluation data", exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/-voice-evaluation\.json$/);
  const exportedText = await readFile(await file.path(), "utf8");
  const exported = JSON.parse(exportedText) as { kind: string; samples: { values: number[]; reference: string | null }[] };
  expect(exported.kind).toBe("voice-evaluation-export");
  expect(exported.samples.length).toBeGreaterThan(0);
  expect(exported.samples.every((sample) => sample.values.length === 512)).toBe(true);
  expect(exportedText).not.toContain("Speaker A");
  for (const segment of transcriptSnapshot(merged)) expect(exportedText).not.toContain(String(segment.text));
  await expect(page.getByText(/Exported \d+ voice samples/)).toBeVisible();

  // The head-count shortcut opens the existing local analysis dialog.
  await hints.getByRole("button", { name: "Regroup with a head count", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("How many people spoke? (optional)")).toBeVisible();
});

for (const language of ["en", "zh-CN"] as const) {
  test(`discloses model licence sources and activates them by keyboard without model or API requests (${language})`, async ({ page, context, browserName }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const chinese = language === "zh-CN";
    const label = (english: string, translated: string) => chinese ? translated : english;
    const reviewedConversion = "https://huggingface.co/Xenova/wavlm-base-plus-sv/blob/e61029603001bd11295c36d878698708bf59190f/README.md";
    // Legal evidence stays pinned: a model change must trigger a new licence review.
    expect(reviewedConversion).toBe(`https://huggingface.co/${ACOUSTIC_POLICY.modelId}/blob/${ACOUSTIC_POLICY.modelRevision}/README.md`);
    const windowsWebKit = browserName === "webkit" && process.platform === "win32";
    if (windowsWebKit) {
      test.info().annotations.push({ type: "coverage-gap", description: "Windows WebKit: focused-anchor Enter activation only; sequential Tab reachability remains unverified. Prior failed navigation traces are retained in the REL03 evidence." });
    }
    const outgoing: string[] = [];
    const activations: { url: string; referrer: string | null }[] = [];
    let expectedSource: string | null = null;
    await context.route("https://**/*", (route) => {
      const request = route.request();
      if (request.url() === expectedSource) {
        activations.push({ url: request.url(), referrer: request.headers().referer ?? null });
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><link rel="icon" href="data:,"><title>Mock model source</title><h1>Mock model source</h1>' });
      }
      outgoing.push(request.url());
      return route.abort();
    });
    await installDeterministicLocalEmbedding(page);
    await page.goto(base);
    await seedOldRun(page, oldRunFixture());
    await page.evaluate((id) => { location.hash = `#/meetings/${id}`; }, meetingId);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Old completed chunked run", exact: true, level: 1 })).toBeVisible();
    await page.locator(".topbar-language select").selectOption(language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    const before = await readMeeting(page);

    for (const consentContext of ["local-analysis", "transcription"] as const) {
      const local = consentContext === "local-analysis";
      const previousActivations = activations.length;
      const opener = page.getByRole("button", { name: local ? label("Auto-match voices", "自动关联声音") : label("Transcribe", "转录"), exact: true });
      await expect(opener).toBeEnabled();
      await opener.focus();
      await expect(opener).toBeFocused();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      for (const disclosure of ["102 MB", "huggingface.co", "SHA-256", "CC BY-SA 3.0", label("browser details", "浏览器信息"), label("deleted in Settings", "在设置中删除")]) {
        await expect(dialog).toContainText(disclosure);
      }
      await expect(dialog.getByText(label("Microsoft’s upstream model card links CC BY-SA 3.0. Review of the ONNX conversion’s attribution and licence notices is still open.", "Microsoft 上游模型卡链接至 CC BY-SA 3.0。ONNX 转换版本的署名与许可证声明仍待核查。"), { exact: true })).toBeVisible();
      await expect(dialog).not.toContainText(/has not declared a licence|未声明许可证/);
      await expect(dialog).toContainText(local
        ? label("no audio, transcript, vector or key is sent anywhere", "不会发送录音、转录、向量或密钥")
        : label("not sent with the transcription request", "不会随转录请求发送"));
      if (local) {
        await expect(dialog.getByRole("checkbox")).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: label("Download and analyze locally", "下载并在本地分析"), exact: true })).toBeEnabled();
      } else {
        const continuity = dialog.getByRole("checkbox");
        await expect(continuity).toHaveCount(1);
        await expect(continuity).not.toBeChecked();
        await continuity.check();
        await expect(continuity).toBeChecked();
        await expect(dialog.getByRole("button", { name: label("Confirm and send 2 requests", "确认并发送 2 次请求"), exact: true })).toBeDisabled();
        await expect(dialog).not.toContainText(label("no audio, transcript, vector or key is sent anywhere", "不会发送录音、转录、向量或密钥"));
      }

      const summary = dialog.locator("summary").filter({ hasText: label("Model sources and licence", "模型来源与许可证") });
      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(summary.locator("..")).toHaveAttribute("open", "");
      expect(activations).toHaveLength(previousActivations);
      expect(outgoing).toEqual([]);
      for (const [name, href] of [
        [label("Microsoft model card", "Microsoft 模型卡"), "https://huggingface.co/microsoft/wavlm-base-plus-sv/blob/feb593a6c23c1cc3d9510425c29b0a14d2b07b1e/README.md"],
        [label("Upstream licence (CC BY-SA 3.0)", "上游许可证（CC BY-SA 3.0）"), "https://github.com/microsoft/UniSpeech/blob/8f8cbd22d352fc59dfd5bf19de979b05bb5c7938/LICENSE"],
        [label("Xenova ONNX model card", "Xenova ONNX 模型卡"), reviewedConversion],
      ]) {
        const link = dialog.getByRole("link", { name, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", href);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        // Explicit focus proves activation only in Windows WebKit, never sequential Tab reachability.
        if (windowsWebKit) await link.focus();
        else await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        const beforeActivation = activations.length;
        expectedSource = href;
        const popupPromise = context.waitForEvent("page");
        await page.keyboard.press("Enter");
        const popup = await popupPromise;
        await expect(popup).toHaveURL(href);
        await expect(popup.getByRole("heading", { name: "Mock model source", exact: true })).toBeVisible();
        expect(await popup.evaluate(() => window.opener === null)).toBe(true);
        expect(activations).toHaveLength(beforeActivation + 1);
        expect(activations.at(-1)).toEqual({ url: href, referrer: null });
        await popup.close();
        expectedSource = null;
        await page.bringToFront();
        await expect(link).toBeFocused();
      }
      if (local) {
        await page.keyboard.press("Tab");
        await expect(dialog.getByRole("spinbutton")).toBeFocused();
      }
      await page.keyboard.press("Tab");
      const cancel = dialog.getByRole("button", { name: label("Cancel", "取消"), exact: true });
      await expect(cancel).toBeFocused();
      await expect(cancel).toBeInViewport({ ratio: 1 });
      const confirmation = dialog.getByRole("button", { name: local ? label("Download and analyze locally", "下载并在本地分析") : label("Confirm and send 2 requests", "确认并发送 2 次请求"), exact: true });
      await expect(confirmation).toBeInViewport({ ratio: 1 });
      if (local) {
        await page.keyboard.press("Tab");
        await expect(confirmation).toBeFocused();
      }
      expect(outgoing).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(await readMeeting(page)).toEqual(before);
      expect(await readCheckpointState(page)).toBeNull();
      expect(outgoing).toEqual([]);
      expect(activations).toHaveLength(previousActivations + 3);
    }
  });
}
