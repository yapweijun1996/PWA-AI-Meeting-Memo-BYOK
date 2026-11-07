import { describe, expect, it } from "vitest";
import {
  Mp3SplitError,
  planMp3Split,
  readMp3Chunk,
  splitMp3,
  type Mp3ChunkPlan,
} from "../src/audio/mp3-split";

interface FrameSpec {
  bitrateIndex?: number;
  marker?: "Xing" | "Info";
  mainDataBegin?: number;
  mono?: boolean;
}

function makeFrame(spec: FrameSpec = {}): Uint8Array {
  const bitrateIndex = spec.bitrateIndex ?? 9;
  const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex] ?? 128;
  const length = Math.floor(144 * bitrate * 1000 / 44100);
  const frame = new Uint8Array(length);
  frame.set([0xff, 0xfb, bitrateIndex << 4, spec.mono === true ? 0xc0 : 0]);
  if (spec.mainDataBegin !== undefined) {
    frame[4] = (spec.mainDataBegin >> 1) & 0xff;
    frame[5] = (spec.mainDataBegin & 1) << 7;
  }
  if (spec.marker !== undefined) {
    const at = 4 + (spec.mono === true ? 17 : 32);
    for (let i = 0; i < spec.marker.length; i += 1) frame[at + i] = spec.marker.charCodeAt(i);
  }
  return frame;
}

function stream(frames: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
  let offset = 0;
  for (const frame of frames) {
    result.set(frame, offset);
    offset += frame.length;
  }
  return result;
}

function id3(): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0]);
}
function blobOf(data: Uint8Array): Blob {
  return new Blob([data.slice().buffer as ArrayBuffer]);
}


function planFields(plan: Mp3ChunkPlan) {
  return {
    index: plan.index,
    byteOffset: plan.byteOffset,
    frameCount: plan.frameCount,
    leadInFrames: plan.leadInFrames,
    leadInSeconds: plan.leadInSeconds,
    ownStartSeconds: plan.ownStartSeconds,
    ownDurationSeconds: plan.ownDurationSeconds,
  };
}

describe("windowed MP3 planner", () => {
  it("matches splitMp3 boundaries with tags, metadata, resynchronization, and minimum lead-in across window sizes", async () => {
    const audio = stream([
      makeFrame({ marker: "Xing" }),
      ...Array.from({ length: 1800 }, (_, index) => makeFrame({ mainDataBegin: index % 11 === 0 ? 0 : 1 })),
    ]);
    const tagged = new Uint8Array(id3().length + audio.length + 128);
    tagged.set(id3());
    tagged.set(audio, id3().length);
    tagged.set([0x54, 0x41, 0x47], tagged.length - 128);
    // Insert five resynchronization bytes after a complete frame without changing any subsequent frame bytes.
    const garbageAt = id3().length + makeFrame({ marker: "Xing" }).length * 20;
    const withGarbage = new Uint8Array(tagged.length + 5);
    withGarbage.set(tagged.subarray(0, garbageAt));
    withGarbage.fill(0x55, garbageAt, garbageAt + 5);
    withGarbage.set(tagged.subarray(garbageAt), garbageAt + 5);
    const options = { targetSeconds: 5, maxBytes: 1_000_000, minLeadInSeconds: 0.4 };
    const expected = splitMp3(withGarbage, options);
    const blob = blobOf(withGarbage);
    for (const windowBytes of [64 * 1024, 128 * 1024, 1024 * 1024]) {
      const result = await planMp3Split(blob, { ...options, windowBytes });
      expect(result.chunks.map(planFields)).toEqual(expected.chunks.map((chunk) => ({
        index: chunk.index,
        byteOffset: chunk.byteOffset,
        frameCount: chunk.frameCount,
        leadInFrames: chunk.leadInFrames,
        leadInSeconds: chunk.leadInSeconds,
        ownStartSeconds: chunk.ownStartSeconds,
        ownDurationSeconds: chunk.ownDurationSeconds,
      })));
      expect(result.chunks.map(({ byteLength }) => byteLength)).toEqual(expected.chunks.map((chunk) => chunk.bytes.length));
      expect(result.totalSeconds).toBe(expected.totalSeconds);
      expect(result.sampleRate).toBe(expected.sampleRate);
      expect(result.warnings).toEqual(expected.warnings);
    }
  });

  it("returns lazy audio/mpeg Blob slices matching each planned byte range", async () => {
    const data = stream(Array.from({ length: 350 }, () => makeFrame()));
    const source = blobOf(data);
    const result = await planMp3Split(source, { targetSeconds: 5, maxBytes: 100_000, windowBytes: 64 * 1024 });
    const first = result.chunks[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const chunk = readMp3Chunk(source, first);
    expect(chunk.type).toBe("audio/mpeg");
    expect(new Uint8Array(await chunk.arrayBuffer())).toEqual(data.subarray(first.byteOffset, first.byteOffset + first.byteLength));
  });

  it("honors shared option validation and aborts Blob reads", async () => {
    const source = blobOf(makeFrame());
    await expect(planMp3Split(source, { targetSeconds: 4, maxBytes: 100_000 })).rejects.toThrow(RangeError);
    await expect(planMp3Split(source, { targetSeconds: 5, maxBytes: 100_000, windowBytes: 1024 })).rejects.toThrow(RangeError);
    const controller = new AbortController();
    controller.abort();
    await expect(planMp3Split(source, { targetSeconds: 5, maxBytes: 100_000, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(planMp3Split(blobOf(new Uint8Array()), { targetSeconds: 5, maxBytes: 100_000 })).rejects.toBeInstanceOf(Mp3SplitError);
  });

  it("plans a scaled long MPEG2 mono stream with a bounded index", async () => {
    const frame = new Uint8Array(144);
    frame.set([0xff, 0xf3, 0x64, 0xc0]); // MPEG2, 48 kbps, 24 kHz, mono.
    const frameCount = 50_000; // 20-minute scale; 1/60 of the requested 20-hour example.
    const data = new Uint8Array(frame.length * frameCount);
    for (let offset = 0; offset < data.length; offset += frame.length) data.set(frame, offset);
    const options = { targetSeconds: 300, maxBytes: 24_000_000, windowBytes: 4 * 1024 * 1024 };
    const expected = splitMp3(data, options);
    const started = performance.now();
    const result = await planMp3Split(blobOf(data), options);
    const elapsedMs = performance.now() - started;
    expect(result.totalSeconds).toBeCloseTo(frameCount * 576 / 24_000, 6);
    expect(result.totalSeconds).toBe(expected.totalSeconds);
    expect(result.chunks.map((chunk) => [chunk.byteOffset, chunk.byteLength, chunk.frameCount]))
      .toEqual(expected.chunks.map((chunk) => [chunk.byteOffset, chunk.bytes.length, chunk.frameCount]));
    expect(result.chunks.reduce((sum, chunk) => sum + chunk.frameCount, 0)).toBe(frameCount);
    expect(result.chunks.reduce((sum, chunk) => sum + chunk.frameCount, 0))
      .toBe(expected.chunks.reduce((sum, chunk) => sum + chunk.frameCount, 0));
    // The planner's 50k-frame typed index and timeline occupy about 1.9 MiB; this is a 20-minute run (1/60 scale), not a 20-hour heap benchmark.
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
