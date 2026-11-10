import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

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

function installDeterministicLocalEmbedding(page: Page) {
  return page.addInitScript(() => {
    class DeterministicWorker extends EventTarget {
      postMessage(message: {
        type: string;
        requestId: number;
        samples?: Float32Array;
      }) {
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
          values[mean > 1.5 ? 1 : 0] = 1;
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
            seconds >= 5 && seconds < 19
              ? 1
              : seconds >= 25 && seconds < 39
                ? 2
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
  });
}

async function seedOldRun(page: Page, fixture: OldRunFixture) {
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
  await expect(page.getByRole("heading", { name: "Your meetings.", exact: true })).toBeVisible();

  const fixture = oldRunFixture();
  await seedOldRun(page, fixture);
  await expect.poll(() => readOldStoreCounts(page)).toEqual({
    chunks: 2,
    chunkSpeech: 0,
    transcriptPages: 0,
  });
  await page.reload();
  await page.evaluate((id) => {
    location.hash = `#/meetings/${id}`;
  }, meetingId);
  await expect(page.getByRole("heading", { name: "Old completed chunked run", exact: true })).toBeVisible();
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
  await expect(page.locator(".speaker-review-card")).toHaveCount(2);
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
