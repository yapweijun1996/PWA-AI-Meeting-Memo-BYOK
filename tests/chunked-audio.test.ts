import { afterEach, describe, expect, it, vi } from "vitest";
import { ChunkedAudio } from "../src/audio/chunked-audio";
import type { LongAudioManifest } from "../src/storage/long-audio-store";

class FakeAudio extends EventTarget {
  currentTime = 0;
  duration = 0;
  paused = true;
  ended = false;
  playbackRate = 1;
  error: MediaError | null = null;
  readyState = 0;
  networkState = 0;
  src = "";
  play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    this.dispatchEvent(new Event("playing"));
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  tick(time: number) {
    this.currentTime = time;
    this.dispatchEvent(new Event("timeupdate"));
  }
}

const manifest: LongAudioManifest = {
  meetingId: "meeting-1",
  format: "mp3",
  mimeType: "audio/mpeg",
  totalSeconds: 20,
  sampleRate: 44100,
  totalBytes: 2,
  createdAt: "2026-11-08T00:00:00.000Z",
  manifestSha256: "a".repeat(64),
  chunks: [
    { index: 0, byteLength: 1, sha256: "b".repeat(64), ownStartSeconds: 0, ownDurationSeconds: 10, leadInSeconds: 0 },
    { index: 1, byteLength: 1, sha256: "c".repeat(64), ownStartSeconds: 10, ownDurationSeconds: 10, leadInSeconds: 2 },
  ],
};

const flush = async () => {
  for (let tick = 0; tick < 8; tick++) await Promise.resolve();
};

afterEach(() => vi.unstubAllGlobals());

describe("ChunkedAudio", () => {
  it("maps absolute time and seeks to the correct chunk lead-in offset", async () => {
    const element = new FakeAudio();
    const loaded: number[] = [];
    const audio = new ChunkedAudio(manifest, {
      createElement: () => element as unknown as HTMLAudioElement,
      loadChunk: async (_id, index) => { loaded.push(index); return new Blob([String(index)]); },
    });
    audio.currentTime = 4;
    await flush();
    expect(loaded).toContain(0);
    element.tick(8);
    expect(audio.currentTime).toBe(8);
    audio.currentTime = 13;
    await flush();
    expect(loaded).toContain(1);
    expect(element.currentTime).toBe(5);
    expect(audio.currentTime).toBe(13);
    audio.dispose();
  });

  it("switches at a boundary, preserves playback rate and ends after the final range", async () => {
    const element = new FakeAudio();
    const createObjectURL = vi.fn(() => `blob:boundary-${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const audio = new ChunkedAudio(manifest, {
      createElement: () => element as unknown as HTMLAudioElement,
      loadChunk: async () => new Blob(["audio"]),
    });
    audio.playbackRate = 1.5;
    audio.currentTime = 9.98;
    await flush();
    await audio.play();
    element.tick(10);
    await flush();
    expect(audio.currentTime).toBe(10);
    expect(element.currentTime).toBe(2);
    expect(element.playbackRate).toBe(1.5);
    expect(audio.paused).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:boundary-1");
    audio.pause();
    expect(audio.paused).toBe(true);
    await audio.play();
    expect(audio.paused).toBe(false);
    element.tick(12);
    expect(audio.currentTime).toBe(20);
    expect(audio.ended).toBe(true);
    expect(audio.paused).toBe(true);
    audio.pause();
    audio.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:boundary-2");
  });

  it("revokes replaced and disposed URLs and emits errors for unavailable chunks", async () => {
    const element = new FakeAudio();
    const createObjectURL = vi.fn(() => `blob:chunk-${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const audio = new ChunkedAudio(manifest, {
      createElement: () => element as unknown as HTMLAudioElement,
      loadChunk: async (_id, index) => {
        if (index === 1) throw new Error("corrupt chunk");
        return new Blob(["audio"]);
      },
    });
    const onError = vi.fn();
    audio.addEventListener("error", onError);
    audio.currentTime = 1;
    await flush();
    const firstUrl = element.src;
    audio.currentTime = 15;
    await flush();
    expect(onError).toHaveBeenCalled();
    expect(element.src).toBe(firstUrl);
    audio.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
});
