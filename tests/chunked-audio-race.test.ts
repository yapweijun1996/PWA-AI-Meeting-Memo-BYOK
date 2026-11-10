import { afterEach, expect, it, vi } from "vitest";
import { ChunkedAudio } from "../src/audio/chunked-audio";
import type { LongAudioManifest } from "../src/storage/long-audio-store";

class FakeAudio extends EventTarget {
  currentTime = 0; duration = 0; paused = true; ended = false; playbackRate = 1;
  defaultPlaybackRate = 1; error: MediaError | null = null; readyState = 0; networkState = 0; src = "";
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event("play")); });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event("pause")); });
  tick(time: number) { this.currentTime = time; this.dispatchEvent(new Event("timeupdate")); }
}
const manifest: LongAudioManifest = {
  meetingId: "race", format: "mp3", mimeType: "audio/mpeg", totalSeconds: 20, sampleRate: 44100,
  totalBytes: 2, createdAt: "2026-11-10T00:00:00.000Z", manifestSha256: "a".repeat(64), chunks: [
    { index: 0, byteLength: 1, sha256: "b".repeat(64), ownStartSeconds: 0, ownDurationSeconds: 10, leadInSeconds: 0 },
    { index: 1, byteLength: 1, sha256: "c".repeat(64), ownStartSeconds: 10, ownDurationSeconds: 10, leadInSeconds: 0 },
  ],
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture() {
  const el = new FakeAudio();
  const next = deferred<Blob>();
  let urls = 0;
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => `blob:${++urls}`), revokeObjectURL: vi.fn() });
  const audio = new ChunkedAudio(manifest, {
    createElement: () => el as unknown as HTMLAudioElement,
    loadChunk: async (_id, index) => new Blob([String(index)]),
    planWindows: (bytes) => [0, 1].map((index) => ({ byteOffset: 0, bytes, leadInSeconds: index, ownStartSeconds: index * 5, ownDurationSeconds: 5 })),
    decodeWindow: async (bytes, leadIn) => bytes[0] === 48 && leadIn === 1 ? next.promise : new Blob(["wav"]),
  });
  return { el, audio, next };
}
afterEach(() => vi.unstubAllGlobals());

it("does not restart after a pause during a boundary decode", async () => {
  const { el, audio, next } = fixture();
  await audio.play();
  el.tick(5);
  await flush();
  audio.pause();
  next.resolve(new Blob(["next"]));
  await flush();
  expect(audio.paused).toBe(true);
  expect(el.play).toHaveBeenCalledTimes(1);
  expect(audio.currentTime).toBe(5);
  await audio.play();
  expect(audio.paused).toBe(false);
  audio.dispose();
});

it("does not let a stale boundary decode override a newer seek", async () => {
  const { el, audio, next } = fixture();
  await audio.play();
  el.tick(5);
  await flush();
  audio.currentTime = 13;
  await flush();
  expect(audio.currentTime).toBe(13);
  const source = el.src;
  next.resolve(new Blob(["next"]));
  await flush();
  expect(audio.currentTime).toBe(13);
  expect(el.src).toBe(source);
  expect(audio.paused).toBe(false);
  audio.dispose();
});

it("does not play after pause or disposal during the initial load", async () => {
  for (const action of ["pause", "dispose"] as const) {
    const el = new FakeAudio();
    const load = deferred<Blob>();
    const audio = new ChunkedAudio({ ...manifest, format: "mp4" }, {
      createElement: () => el as unknown as HTMLAudioElement,
      loadChunk: () => load.promise,
    });
    const starting = audio.play();
    audio[action]();
    load.resolve(new Blob(["mp4"]));
    await starting;
    expect(el.play).not.toHaveBeenCalled();
    expect(audio.paused).toBe(true);
    audio.dispose();
  }
});

it("allows a new boundary switch while an obsolete decode is still pending", async () => {
  const { el, audio, next } = fixture();
  await audio.play();
  el.tick(5);
  await flush();
  audio.currentTime = 13;
  await flush();
  el.tick(5);
  await flush();
  expect(audio.currentTime).toBe(15);
  next.resolve(new Blob(["old"]));
  await flush();
  expect(audio.currentTime).toBe(15);
  expect(audio.paused).toBe(false);
  audio.dispose();
});

it("does not resume a pending MP4 seek after a pause", async () => {
  const el = new FakeAudio();
  const second = deferred<Blob>();
  const audio = new ChunkedAudio({ ...manifest, format: "mp4" }, {
    createElement: () => el as unknown as HTMLAudioElement,
    loadChunk: async (_id, index) => index === 0 ? new Blob(["first"]) : second.promise,
  });
  await audio.play();
  audio.currentTime = 13;
  audio.pause();
  second.resolve(new Blob(["second"]));
  await flush();
  expect(audio.currentTime).toBe(13);
  expect(audio.paused).toBe(true);
  expect(el.play).toHaveBeenCalledTimes(1);
  audio.dispose();
});

it("keeps an MP4 seek in the current chunk when an old boundary load completes", async () => {
  const el = new FakeAudio();
  const second = deferred<Blob>();
  const audio = new ChunkedAudio({ ...manifest, format: "mp4" }, {
    createElement: () => el as unknown as HTMLAudioElement,
    loadChunk: async (_id, index) => index === 0 ? new Blob(["first"]) : second.promise,
  });
  await audio.play();
  el.tick(10);
  audio.currentTime = 2;
  second.resolve(new Blob(["second"]));
  await flush();
  expect(audio.currentTime).toBe(2);
  expect(el.play).toHaveBeenCalledTimes(1);
  audio.dispose();
});

it("ignores a late play event after the user pauses", async () => {
  const el = new FakeAudio();
  const started = deferred<void>();
  el.play = vi.fn(() => started.promise);
  const audio = new ChunkedAudio({ ...manifest, format: "mp4" }, {
    createElement: () => el as unknown as HTMLAudioElement,
    loadChunk: async () => new Blob(["mp4"]),
  });
  const playing = audio.play();
  await flush();
  expect(el.play).toHaveBeenCalledTimes(1);
  audio.pause();
  el.paused = false;
  el.dispatchEvent(new Event("play"));
  started.resolve();
  await playing;
  expect(audio.paused).toBe(true);
  expect(el.paused).toBe(true);
  audio.dispose();
});

it("does not emit a playback error when a seek's play is aborted by pause", async () => {
  const el = new FakeAudio();
  const pending = deferred<void>();
  el.play = vi.fn()
    .mockImplementationOnce(async () => { el.paused = false; el.dispatchEvent(new Event("play")); })
    .mockImplementationOnce(() => pending.promise);
  const audio = new ChunkedAudio({ ...manifest, format: "mp4" }, {
    createElement: () => el as unknown as HTMLAudioElement,
    loadChunk: async () => new Blob(["mp4"]),
  });
  const onError = vi.fn();
  audio.addEventListener("error", onError);
  await audio.play();
  audio.currentTime = 13;
  await flush();
  expect(el.play).toHaveBeenCalledTimes(2);
  audio.pause();
  pending.reject(new DOMException("Interrupted", "AbortError"));
  await flush();
  expect(onError).not.toHaveBeenCalled();
  expect(audio.paused).toBe(true);
  audio.dispose();
});
