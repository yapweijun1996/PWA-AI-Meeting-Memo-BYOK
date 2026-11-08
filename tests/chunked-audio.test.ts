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
  private source = "";
  get src() { return this.source; }
  set src(value: string) {
    this.source = value;
    // A real element reports metadata shortly after a source is set.
    this.readyState = value ? 1 : 0;
  }
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
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
};
// Window times are relative to the chunk blob. Chunk 0 is 10 s; chunk 1 is 12 s because it starts with a 2 s lead-in overlap.
const fakeWindows = (bytes: Uint8Array) => {
  const length = bytes[0] === 49 ? 6 : 5;
  return [0, 1].map((index) => ({
    byteOffset: 0,
    bytes,
    leadInSeconds: index ? 1 : 0,
    ownStartSeconds: index * length,
    ownDurationSeconds: length,
  }));
};
const optionsFor = (element: FakeAudio, loadChunk: (id: string, index: number) => Promise<Blob>, decodeWindow = vi.fn(async () => new Blob(["wav"]))) => ({
  createElement: () => element as unknown as HTMLAudioElement,
  loadChunk,
  planWindows: fakeWindows,
  decodeWindow,
});

afterEach(() => vi.unstubAllGlobals());

describe("ChunkedAudio", () => {
  it("maps absolute time through windows and seeks inside the selected window", async () => {
    const element = new FakeAudio();
    const loaded: number[] = [];
    const audio = new ChunkedAudio(manifest, optionsFor(element, async (_id, index) => {
      loaded.push(index);
      return new Blob([String(index)]);
    }));
    audio.currentTime = 8;
    await flush();
    expect(loaded).toContain(0);
    expect(element.currentTime).toBe(3);
    element.tick(4);
    expect(audio.currentTime).toBe(9);
    audio.currentTime = 13;
    await flush();
    expect(loaded).toContain(1);
    // Chunk 1's blob starts at 8 s (10 - 2 s lead-in), so 13 s is 5 s into its first window.
    expect(element.currentTime).toBe(5);
    expect(audio.currentTime).toBe(13);
    audio.dispose();
  });

  it("switches windows and chunks with playback rate preserved, then ends", async () => {
    const element = new FakeAudio();
    const createObjectURL = vi.fn(() => `blob:boundary-${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const audio = new ChunkedAudio(manifest, optionsFor(element, async (_id, index) => new Blob([String(index)])));
    audio.playbackRate = 1.5;
    audio.currentTime = 9.98;
    await flush();
    await audio.play();
    element.tick(5);
    await flush();
    // Entering chunk 1 skips its 2 s lead-in, which the listener already heard at the end of chunk 0.
    expect(audio.currentTime).toBe(10);
    expect(element.currentTime).toBe(2);
    expect(element.playbackRate).toBe(1.5);
    expect(audio.paused).toBe(false);
    element.tick(6);
    await flush();
    expect(audio.currentTime).toBe(14);
    expect(element.currentTime).toBe(0);
    element.tick(6);
    await flush();
    expect(audio.currentTime).toBe(20);
    expect(audio.ended).toBe(true);
    expect(audio.paused).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalled();
    audio.dispose();
  });

  it("prefetches the next window and revokes active URLs on replacement and dispose", async () => {
    const element = new FakeAudio();
    const createObjectURL = vi.fn(() => `blob:window-${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const decoded: string[] = [];
    const audio = new ChunkedAudio(manifest, {
      ...optionsFor(element, async (_id, index) => new Blob([String(index)])),
      decodeWindow: async (bytes) => { decoded.push(String.fromCharCode(...bytes)); return new Blob(["wav"]); },
    });
    audio.currentTime = 1;
    await flush();
    element.tick(1);
    await flush();
    expect(decoded.length).toBeGreaterThan(1);
    const firstUrl = element.src;
    audio.currentTime = 8;
    await flush();
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    const activeUrl = element.src;
    audio.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith(activeUrl);
  });

  it("keeps MP4 playback on the existing element-based chunk path", async () => {
    const element = new FakeAudio();
    const loadChunk = vi.fn(async () => new Blob(["mp4"]));
    const planWindows = vi.fn(() => { throw new Error("MP4 must not be split into windows"); });
    const audio = new ChunkedAudio({ ...manifest, format: "mp4" }, {
      ...optionsFor(element, loadChunk),
      planWindows,
    });
    audio.currentTime = 8;
    await flush();
    expect(element.currentTime).toBe(8);
    expect(audio.currentTime).toBe(8);
    element.tick(12);
    await flush();
    expect(element.currentTime).toBe(2);
    expect(audio.currentTime).toBe(10);
    expect(planWindows).not.toHaveBeenCalled();
    audio.dispose();
  });

  it("emits decode failures and does not fall back to inaccurate MP3 playback", async () => {
    const element = new FakeAudio();
    const audio = new ChunkedAudio(manifest, {
      ...optionsFor(element, async (_id, index) => new Blob([String(index)])),
      decodeWindow: async () => { throw new Error("unsupported MP3"); },
    });
    const onError = vi.fn();
    audio.addEventListener("error", onError);
    audio.currentTime = 1;
    await flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(element.src).toBe("");
    audio.dispose();
  });
});
