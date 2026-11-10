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

  it("resumes inside the loaded window without a new source, decode, or object URL", async () => {
    const element = new FakeAudio();
    const createObjectURL = vi.fn(() => `blob:resume-${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const decodeWindow = vi.fn(async () => new Blob(["wav"]));
    const audio = new ChunkedAudio(manifest, optionsFor(element, async (_id, index) => new Blob([String(index)]), decodeWindow));
    audio.currentTime = 1;
    await flush();
    await audio.play();
    // Playing near the end of a window prefetches the next one; that is not a reload of the current window.
    element.tick(2);
    await flush();
    const source = element.src;
    const decodes = decodeWindow.mock.calls.length;
    audio.pause();
    await audio.play();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(decodeWindow.mock.calls.length).toBe(decodes);
    expect(element.src).toBe(source);
    expect(element.currentTime).toBe(2);
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(audio.paused).toBe(false);
    // Outside the loaded window it must still load the right one.
    audio.pause();
    audio.currentTime = 13;
    await flush();
    await audio.play();
    expect(createObjectURL.mock.calls.length).toBeGreaterThan(1);
    expect(audio.currentTime).toBe(13);
    audio.dispose();
  });

  it("plays from the requested position when a seek is still loading", async () => {
    const element = new FakeAudio();
    const audio = new ChunkedAudio(manifest, optionsFor(element, async (_id, index) => new Blob([String(index)])));
    audio.currentTime = 1;
    await flush();
    audio.pause();
    // No flush: the element still reports the old position.
    audio.currentTime = 8;
    await audio.play();
    expect(audio.currentTime).toBe(8);
    expect(element.currentTime).toBe(3);
    audio.dispose();
  });

  it("keeps only a few chunk plans, reloads a trimmed one, and never trims the playing chunk", async () => {
    const element = new FakeAudio();
    const chunks = Array.from({ length: 6 }, (_, index) => ({
      index, byteLength: 1, sha256: "d".repeat(64), ownStartSeconds: index * 10, ownDurationSeconds: 10, leadInSeconds: 0,
    }));
    const many: LongAudioManifest = { ...manifest, totalSeconds: 60, chunks };
    const loads: number[] = [];
    const audio = new ChunkedAudio(many, {
      ...optionsFor(element, async (_id, index) => { loads.push(index); return new Blob([String(index)]); }),
      planWindows: (bytes) => [{ byteOffset: 0, bytes, leadInSeconds: 0, ownStartSeconds: 0, ownDurationSeconds: 10 }],
    });
    for (const second of [5, 15, 25, 35, 45]) {
      audio.currentTime = second;
      await flush();
    }
    expect(loads).toEqual([0, 1, 2, 3, 4]);
    // Chunk 4 is playing and recent chunks stay cached: no reads for these.
    audio.currentTime = 46;
    await flush();
    audio.currentTime = 35;
    await flush();
    expect(loads).toEqual([0, 1, 2, 3, 4]);
    // Chunk 0 was trimmed, so going back to it reads it again.
    audio.currentTime = 5;
    await flush();
    expect(loads).toEqual([0, 1, 2, 3, 4, 0]);
    expect(audio.currentTime).toBe(5);
    audio.dispose();
  });

  it("reads a chunk once when a seek and a prefetch ask for it at the same time", async () => {
    const element = new FakeAudio();
    const loads: number[] = [];
    const audio = new ChunkedAudio(manifest, optionsFor(element, async (_id, index) => { loads.push(index); return new Blob([String(index)]); }));
    audio.currentTime = 1;
    audio.currentTime = 7;
    await flush();
    expect(loads).toEqual([0]);
    expect(audio.currentTime).toBe(7);
    audio.dispose();
  });

  it("keeps the chosen playback speed through starts, seeks, window switches and the spare handoff", async () => {
    // Like a real element: assigning src runs the load algorithm, which resets playbackRate to defaultPlaybackRate.
    class ResettingAudio extends FakeAudio {
      defaultPlaybackRate = 1;
      constructor() {
        super();
        let source = "";
        Object.defineProperty(this, "src", {
          configurable: true,
          get: () => source,
          set: (value: string) => { source = value; this.playbackRate = this.defaultPlaybackRate; },
        });
      }
    }
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => `blob:rate-${Math.random()}`), revokeObjectURL: vi.fn() });
    const primary = new ResettingAudio();
    const spare = new ResettingAudio();
    let created = 0;
    const audio = new ChunkedAudio(manifest, {
      ...optionsFor(primary, async (_id, index) => new Blob([String(index)])),
      createElement: () => (created++ === 0 ? primary : spare) as unknown as HTMLAudioElement,
    });
    audio.playbackRate = 2;
    await audio.play();
    expect(primary.playbackRate).toBe(2);
    expect(audio.playbackRate).toBe(2);
    audio.currentTime = 8;
    await flush();
    expect(primary.playbackRate).toBe(2);
    primary.tick(4);
    await flush();
    await flush();
    expect(spare.playbackRate).toBe(2);
    spare.readyState = 4;
    primary.tick(5);
    await flush();
    expect(spare.play).toHaveBeenCalled();
    expect(spare.playbackRate).toBe(2);
    expect(audio.playbackRate).toBe(2);
    audio.dispose();
  });

  describe("window boundary with a preloaded spare element", () => {
    // Plays chunk 0's first 5 s window on `primary` until the next window is preloaded into `spare`.
    async function playUntilSpareIsLoaded() {
      const createObjectURL = vi.fn(() => `blob:spare-${createObjectURL.mock.calls.length}`);
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
      const primary = new FakeAudio();
      const spare = new FakeAudio();
      let created = 0;
      const createElement = () => (created++ === 0 ? primary : spare) as unknown as HTMLAudioElement;
      const audio = new ChunkedAudio(manifest, {
        ...optionsFor(primary, async (_id, index) => new Blob([String(index)])),
        createElement,
      });
      audio.currentTime = 1;
      await flush();
      await audio.play();
      primary.tick(1);
      await flush();
      await flush();
      return { audio, primary, spare, createObjectURL, revokeObjectURL, primarySrc: primary.src };
    }

    it("preloads the next window into the spare and starts it at the boundary without touching the primary", async () => {
      const { audio, primary, spare, revokeObjectURL, primarySrc } = await playUntilSpareIsLoaded();
      expect(spare.src).toMatch(/^blob:spare-/);
      audio.playbackRate = 1.5;
      expect(spare.playbackRate).toBe(1.5);
      spare.readyState = 4;
      primary.tick(5);
      await flush();
      expect(spare.play).toHaveBeenCalledTimes(1);
      expect(primary.pause).toHaveBeenCalled();
      expect(primary.src).toBe(primarySrc);
      expect(revokeObjectURL).toHaveBeenCalledWith(primarySrc);
      expect(audio.currentTime).toBe(5);
      expect(audio.paused).toBe(false);
      spare.tick(2);
      expect(audio.currentTime).toBe(7);
      // The retired element's late events must not look like playback ending or trigger another switch.
      primary.dispatchEvent(new Event("ended"));
      primary.dispatchEvent(new Event("pause"));
      expect(audio.ended).toBe(false);
      expect(audio.paused).toBe(false);
      expect(spare.play).toHaveBeenCalledTimes(1);
      audio.pause();
      expect(spare.pause).toHaveBeenCalled();
      audio.dispose();
    });

    it("uses the single-element path when the spare has not buffered the next window", async () => {
      const { audio, primary, spare, primarySrc } = await playUntilSpareIsLoaded();
      spare.readyState = 0;
      primary.tick(5);
      await flush();
      expect(spare.play).not.toHaveBeenCalled();
      expect(primary.src).not.toBe(primarySrc);
      expect(primary.play).toHaveBeenCalledTimes(2);
      expect(audio.currentTime).toBe(5);
      audio.dispose();
    });

    it("falls back to the original element and stops using the spare when the browser refuses it", async () => {
      const { audio, primary, spare, createObjectURL } = await playUntilSpareIsLoaded();
      const spareSource = spare.src;
      spare.readyState = 4;
      spare.play = vi.fn(async () => { throw new DOMException("blocked", "NotAllowedError"); });
      primary.tick(5);
      await flush();
      expect(primary.src).toBe(spareSource);
      expect(primary.play).toHaveBeenCalledTimes(2);
      expect(audio.currentTime).toBe(5);
      expect(audio.paused).toBe(false);
      // Later boundaries do not preload the spare again.
      const urls = createObjectURL.mock.calls.length;
      primary.tick(1);
      await flush();
      await flush();
      expect(createObjectURL.mock.calls.length).toBe(urls);
      audio.dispose();
    });

    it("does not restart playback when the spare's play() is aborted by a pause", async () => {
      const { audio, primary, spare, primarySrc } = await playUntilSpareIsLoaded();
      spare.readyState = 4;
      spare.play = vi.fn(async () => { throw new DOMException("interrupted", "AbortError"); });
      primary.tick(5);
      audio.pause();
      await flush();
      expect(primary.src).toBe(primarySrc);
      expect(primary.play).toHaveBeenCalledTimes(1);
      expect(audio.paused).toBe(true);
      audio.dispose();
    });
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
