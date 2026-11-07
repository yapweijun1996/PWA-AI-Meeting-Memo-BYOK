import { describe, expect, it } from "vitest";
import { Mp3SplitError, splitMp3 } from "../src/audio/mp3-split";

interface FrameSpec {
  version?: 1 | 2 | 25;
  bitrateIndex?: number;
  sampleRateIndex?: number;
  padding?: number;
  mainDataBegin?: number;
  marker?: "Xing" | "Info" | "VBRI";
  mono?: boolean;
}

function makeFrame(spec: FrameSpec = {}): Uint8Array {
  const version = spec.version ?? 1;
  const bitrateIndex = spec.bitrateIndex ?? (version === 1 ? 9 : 8);
  const sampleRateIndex = spec.sampleRateIndex ?? 0;
  const padding = spec.padding ?? 0;
  const versionBits = version === 1 ? 3 : version === 2 ? 2 : 0;
  const rates = [44100, 48000, 32000];
  const sampleRate = (rates[sampleRateIndex] ?? 44100) / (version === 1 ? 1 : version === 2 ? 2 : 4);
  const bitrates = version === 1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const length = Math.floor((version === 1 ? 144 : 72) * (bitrates[bitrateIndex] ?? 128) * 1000 / sampleRate) + padding;
  const frame = new Uint8Array(length);
  frame[0] = 0xff;
  frame[1] = 0xe0 | (versionBits << 3) | 0x03;
  frame[2] = (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding << 1);
  frame[3] = spec.mono === true ? 0xc0 : 0;
  if (spec.mainDataBegin !== undefined) {
    frame[4] = version === 1 ? (spec.mainDataBegin >> 1) & 0xff : spec.mainDataBegin & 0xff;
    if (version === 1) frame[5] = (spec.mainDataBegin & 1) << 7;
  }
  if (spec.marker !== undefined) {
    const sideInfoBytes = version === 1 ? (spec.mono === true ? 17 : 32) : (spec.mono === true ? 9 : 17);
    const markerOffset = spec.marker === "VBRI" ? 36 : 4 + sideInfoBytes;
    for (let i = 0; i < spec.marker.length; i += 1) frame[markerOffset + i] = spec.marker.charCodeAt(i);
  }
  return frame;
}

function stream(frames: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
  let at = 0;
  for (const frame of frames) {
    result.set(frame, at);
    at += frame.length;
  }
  return result;
}

function id3Tag(footer: boolean): Uint8Array {
  const payload = new Uint8Array(6);
  const tag = new Uint8Array(10 + payload.length + (footer ? 10 : 0));
  tag.set([0x49, 0x44, 0x33, 4, 0, footer ? 0x10 : 0, 0, 0, 0, payload.length]);
  tag.set(payload, 10);
  if (footer) tag.set([0x33, 0x44, 0x49], 16);
  return tag;
}

describe("splitMp3", () => {
  it("splits CBR MPEG1 frames on frame boundaries with exact duration and coverage", () => {
    const frames = Array.from({ length: 300 }, (_, i) => makeFrame({ padding: i % 2 }));
    const data = stream(frames);
    const result = splitMp3(data, { targetSeconds: 5, maxBytes: 100000 });
    expect(result.totalSeconds).toBeCloseTo(300 * 1152 / 44100, 9);
    expect(result.chunks.map((chunk) => chunk.ownDurationSeconds).reduce((a, b) => a + b, 0)).toBeCloseTo(result.totalSeconds, 12);
    expect(result.chunks[0]?.leadInFrames).toBe(0);
    for (const chunk of result.chunks) expect(chunk.bytes.buffer).toBe(data.buffer);
    for (const chunk of result.chunks) expect([0xff, 0xe0]).toEqual([chunk.bytes[0], chunk.bytes[1] & 0xe0]);
    for (let i = 1; i < result.chunks.length; i += 1) {
      const previous = result.chunks[i - 1];
      const current = result.chunks[i];
      if (previous !== undefined && current !== undefined) {
        expect(current.ownStartSeconds).toBe(previous.ownStartSeconds + previous.ownDurationSeconds);
      }
    }
  });

  it("uses MPEG2 duration and VBR frame durations", () => {
    const mpeg2 = splitMp3(stream(Array.from({ length: 40 }, () => makeFrame({ version: 2 }))), { targetSeconds: 5, maxBytes: 100000 });
    expect(mpeg2.totalSeconds).toBeCloseTo(40 * 576 / 22050, 12);
    const vbrFrames = [makeFrame({ bitrateIndex: 8 }), makeFrame({ bitrateIndex: 10 }), makeFrame({ bitrateIndex: 7 })];
    const vbr = splitMp3(stream(vbrFrames), { targetSeconds: 5, maxBytes: 100000 });
    expect(vbr.totalSeconds).toBeCloseTo(3 * 1152 / 44100, 12);
  });

  it("skips ID3 tags, Xing/Info metadata frame, and ID3v1", () => {
    const audio = stream([makeFrame({ marker: "Xing" }), ...Array.from({ length: 20 }, () => makeFrame())]);
    const withV1 = new Uint8Array(audio.length + 128);
    withV1.set(audio);
    withV1.set([0x54, 0x41, 0x47], audio.length);
    for (const footer of [false, true]) {
      const tagged = new Uint8Array(id3Tag(footer).length + withV1.length);
      tagged.set(id3Tag(footer));
      tagged.set(withV1, id3Tag(footer).length);
      const result = splitMp3(tagged, { targetSeconds: 5, maxBytes: 100000 });
      expect(result.totalSeconds).toBeCloseTo(20 * 1152 / 44100, 12);
    }
  });

  it("excludes Info and VBRI metadata frames", () => {
    for (const marker of ["Info", "VBRI"] as const) {
      const result = splitMp3(stream([makeFrame({ marker }), makeFrame(), makeFrame()]), { targetSeconds: 5, maxBytes: 100000 });
      expect(result.totalSeconds).toBeCloseTo(2 * 1152 / 44100, 12);
    }
  });

  it("rejects unsupported headers and inputs without audio", () => {
    for (const frame of [makeFrame({ bitrateIndex: 0 }), makeFrame({ bitrateIndex: 15 }), makeFrame({ sampleRateIndex: 3 })]) {
      expect(() => splitMp3(frame, { targetSeconds: 5, maxBytes: 100000 })).toThrow(Mp3SplitError);
    }
    expect(() => splitMp3(new Uint8Array(), { targetSeconds: 5, maxBytes: 100000 })).toThrow(Mp3SplitError);
    expect(() => splitMp3(new Uint8Array(500).fill(0x41), { targetSeconds: 5, maxBytes: 100000 })).toThrow(Mp3SplitError);
  });

  it("resynchronizes after garbage and emits one summarized warning", () => {
    const first = makeFrame();
    const broken = new Uint8Array(first.length + 5 + first.length * 2);
    broken.set(first);
    broken.fill(0x55, first.length, first.length + 5);
    broken.set(first, first.length + 5);
    broken.set(first, first.length * 2 + 5);
    const result = splitMp3(broken, { targetSeconds: 5, maxBytes: 100000 });
    expect(result.totalSeconds).toBeCloseTo(3 * 1152 / 44100, 12);
    expect(result.warnings).toEqual(["Resynchronized after skipping 5 bytes."]);
  });

  it("prefers reservoir-safe cuts and adds a 511-byte lead-in if needed", () => {
    const safeFrames = Array.from({ length: 280 }, (_, index) => makeFrame({ mainDataBegin: index === 200 ? 0 : 1 }));
    const safe = splitMp3(stream(safeFrames), { targetSeconds: 5, maxBytes: 100000 });
    expect(safe.chunks[1]?.ownStartSeconds).toBeCloseTo(200 * 1152 / 44100, 12);
    expect(safe.chunks[1]?.leadInFrames).toBe(0);
    const unsafeFrames = Array.from({ length: 280 }, () => makeFrame({ mainDataBegin: 1 }));
    const unsafe = splitMp3(stream(unsafeFrames), { targetSeconds: 5, maxBytes: 100000 });
    const unsafeChunk = unsafe.chunks[1];
    expect(unsafeChunk?.leadInFrames).toBeGreaterThan(0);
    if (unsafeChunk !== undefined) expect(unsafeChunk.leadInFrames * 417).toBeGreaterThanOrEqual(511);
  });
  it("uses payload bytes for reservoir lead-in on small MPEG2 mono frames", () => {
    const frame = makeFrame({ version: 2, bitrateIndex: 4, mainDataBegin: 1, mono: true });
    const frames = Array.from({ length: 280 }, () => frame);
    const result = splitMp3(stream(frames), { targetSeconds: 5, maxBytes: 100000 });
    const naiveWholeFrameLeadIn = Math.ceil(511 / frame.length);
    const nextChunk = result.chunks[1];
    expect(nextChunk?.leadInFrames).toBeGreaterThan(naiveWholeFrameLeadIn);
    expect(nextChunk?.leadInFrames).toBeGreaterThanOrEqual(Math.ceil(1022 / (frame.length - 4 - 9)));
  });

  it("accepts a final frame after resynchronization without a following header", () => {
    const lastFrame = makeFrame();
    const data = new Uint8Array(7 + lastFrame.length);
    data.fill(0x55, 0, 7);
    data.set(lastFrame, 7);
    const result = splitMp3(data, { targetSeconds: 5, maxBytes: 100000 });
    expect(result.totalSeconds).toBeCloseTo(1152 / 44100, 12);
    expect(result.warnings).toEqual(["Resynchronized after skipping 7 bytes."]);
  });

  it("scales linearly across a 20-hour-equivalent 32 kbps MPEG2 mono stream", () => {
    const frame = makeFrame({ version: 2, bitrateIndex: 4, mono: true });
    const frameCount = Math.floor((20 * 60 * 60 * 22050) / 576 / 60);
    // 20 minutes is 1/60 of the target duration; at 32 kbps, 20 hours would require about 288 MB.
    const data = new Uint8Array(frame.length * frameCount);
    for (let offset = 0; offset < data.length; offset += frame.length) data.set(frame, offset);
    const started = Date.now();
    const result = splitMp3(data, { targetSeconds: 300, maxBytes: 24000000 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5000);
    expect(result.chunks).toHaveLength(Math.ceil(frameCount * 576 / 22050 / 300));
    expect(result.chunks.reduce((sum, chunk) => sum + Math.round(chunk.ownDurationSeconds * 22050 / 576), 0)).toBe(frameCount);
    for (let index = 1; index < result.chunks.length; index += 1) {
      const previous = result.chunks[index - 1];
      const current = result.chunks[index];
      if (previous !== undefined && current !== undefined) {
        expect(current.ownStartSeconds).toBeCloseTo(previous.ownStartSeconds + previous.ownDurationSeconds, 12);
      }
    }
  });

  it("honors byte and time limits, single chunk, and deterministic views", () => {
    const data = stream(Array.from({ length: 500 }, () => makeFrame()));
    const byteLimited = splitMp3(data, { targetSeconds: 3600, maxBytes: 100000 });
    expect(byteLimited.chunks.length).toBeGreaterThan(1);
    expect(byteLimited.chunks.every((chunk) => chunk.bytes.length <= 100000)).toBe(true);
    const timeLimited = splitMp3(data, { targetSeconds: 5, maxBytes: 24000000 });
    expect(timeLimited.chunks.length).toBeGreaterThan(1);
    expect(timeLimited.chunks[0]?.ownDurationSeconds).toBeLessThanOrEqual(5 + 1152 / 44100);
    const single = splitMp3(stream(Array.from({ length: 20 }, () => makeFrame())), { targetSeconds: 30, maxBytes: 100000 });
    expect(single.chunks).toHaveLength(1);
    expect(splitMp3(data, { targetSeconds: 3600, maxBytes: 100000 })).toEqual(byteLimited);
  });

  it("adds a minimum lead-in while keeping own frame ranges contiguous", () => {
    const data = stream(Array.from({ length: 1600 }, () => makeFrame({ mainDataBegin: 1 })));
    const defaults = splitMp3(data, { targetSeconds: 5, maxBytes: 1000000 });
    const explicitDefault = splitMp3(data, { targetSeconds: 5, maxBytes: 1000000, minLeadInSeconds: 0 });
    expect(explicitDefault).toEqual(defaults);
    const result = splitMp3(data, { targetSeconds: 5, maxBytes: 1000000, minLeadInSeconds: 10 });
    expect(result.chunks.length).toBeGreaterThan(1);
    for (let index = 1; index < result.chunks.length; index += 1) {
      const previous = result.chunks[index - 1];
      const current = result.chunks[index];
      if (previous !== undefined && current !== undefined) {
        expect(current.leadInSeconds).toBeGreaterThanOrEqual(Math.min(10, current.ownStartSeconds));
        expect(current.ownStartSeconds).toBeCloseTo(previous.ownStartSeconds + previous.ownDurationSeconds, 12);
        expect(current.leadInFrames * (417 - 4 - 32)).toBeGreaterThanOrEqual(1022);
      }
    }
    expect(result.chunks.reduce((sum, chunk) => sum + chunk.ownDurationSeconds, 0)).toBeCloseTo(result.totalSeconds, 12);
  });

  it("reduces oversized lead-ins to fit maxBytes and warns once", () => {
    const data = stream(Array.from({ length: 1000 }, () => makeFrame()));
    const result = splitMp3(data, { targetSeconds: 5, maxBytes: 100000, minLeadInSeconds: 10 });
    expect(result.chunks.every((chunk) => chunk.bytes.length <= 100000)).toBe(true);
    expect(result.warnings.filter((warning) => warning.includes("Reduced lead-in"))).toHaveLength(1);
  });

  it("validates option ranges", () => {
    expect(() => splitMp3(stream([makeFrame()]), { targetSeconds: 4, maxBytes: 100000 })).toThrow(RangeError);
    expect(() => splitMp3(stream([makeFrame()]), { targetSeconds: 5, maxBytes: 99999 })).toThrow(RangeError);
    for (const minLeadInSeconds of [-0.1, 60.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => splitMp3(stream([makeFrame()]), { targetSeconds: 5, maxBytes: 100000, minLeadInSeconds })).toThrow(RangeError);
    }
  });
});
