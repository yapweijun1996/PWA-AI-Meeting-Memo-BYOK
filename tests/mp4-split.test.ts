import { describe, expect, it } from "vitest";
import { boxes, joinBytes, makeBox } from "../src/audio/iso-bmff";
import { Mp4SplitError, planMp4Split, readMp4Chunk } from "../src/audio/mp4-split";

const timescale = 48000;
const maxBytes = 100000;
// Fixture non-null assertions rely on loops bounded by the matching source arrays.

// Big-endian 32-bit writer used to assemble synthetic box payloads.
function u32(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value));
  return out;
}

function fullBox(type: string, payload: Uint8Array): Uint8Array {
  return makeBox(type, joinBytes([new Uint8Array(4), payload]));
}

function header(type: string, scale: number, version: 0 | 1, trackId = 1, duration = 1): Uint8Array {
  const payload = new Uint8Array(version === 1 ? 112 : 100);
  const view = new DataView(payload.buffer);
  payload[0] = version;
  const versionOffset = version === 1 ? 20 : 12;
  if (type === "tkhd") {
    view.setUint32(versionOffset, trackId);
    payload[3] = 3;
  } else {
    view.setUint32(versionOffset, scale);
  }
  if (type === "mvhd" || type === "mdhd" || type === "tkhd") {
    const durationOffset = type === "tkhd" ? (version === 1 ? 28 : 20) : (version === 1 ? 24 : 16);
    if (version === 1) view.setBigUint64(durationOffset, BigInt(duration));
    else view.setUint32(durationOffset, duration);
  }
  return makeBox(type, payload);
}

function audioTrack(options: {
  sizes: number[];
  durations: number[];
  chunkOffsets: number[];
  samplesPerChunk: number[];
  fixedSize?: number;
  codec?: string;
  version?: 0 | 1;
  editMediaTime?: number;
  useStz2?: boolean;
  co64?: boolean;
}): Uint8Array {
  const { sizes, durations, chunkOffsets, samplesPerChunk } = options;
  const version = options.version ?? 0;
  const entryPayload = new Uint8Array(28);
  new DataView(entryPayload.buffer).setUint32(24, 44100 * 65536);
  const entry = makeBox(options.codec ?? "mp4a", entryPayload);
  const stsd = fullBox("stsd", joinBytes([u32(1), entry]));
  const durationRuns: number[] = [];
  for (let sample = 0; sample < durations.length;) {
    let count = 1;
    while (sample + count < durations.length && durations[sample + count] === durations[sample]) count += 1;
    durationRuns.push(count, durations[sample]!);
    sample += count;
  }
  const stts = fullBox("stts", joinBytes([u32(durationRuns.length / 2), u32(...durationRuns)]));
  const sizePayload = options.useStz2
    ? fullBox("stz2", joinBytes([u32(0, sizes.length), new Uint8Array(sizes.length)]))
    : fullBox("stsz", options.fixedSize
      ? u32(options.fixedSize, sizes.length)
      : joinBytes([u32(0, sizes.length), u32(...sizes)]));
  const stscEntries: number[] = [];
  let previous = 0;
  let sample = 0;
  for (let chunk = 0; chunk < samplesPerChunk.length; chunk += 1) {
    const amount = samplesPerChunk[chunk]!;
    if (amount !== previous) {
      stscEntries.push(chunk + 1, amount, 1);
      previous = amount;
    }
    sample += amount;
  }
  if (sample !== sizes.length) throw new Error("Fixture chunk map does not cover its samples.");
  const stsc = fullBox("stsc", joinBytes([u32(stscEntries.length / 3), u32(...stscEntries)]));
  const offsetPayload = new Uint8Array(4 + chunkOffsets.length * (options.co64 ? 8 : 4));
  const offsetView = new DataView(offsetPayload.buffer);
  offsetView.setUint32(0, chunkOffsets.length);
  for (let index = 0; index < chunkOffsets.length; index += 1) {
    if (options.co64) offsetView.setBigUint64(4 + index * 8, BigInt(chunkOffsets[index]!));
    else offsetView.setUint32(4 + index * 4, chunkOffsets[index]!);
  }
  const offsets = fullBox(options.co64 ? "co64" : "stco", offsetPayload);
  const mdia = makeBox("mdia", joinBytes([
    header("mdhd", timescale, version, 1, durations.reduce((total, value) => total + value, 0)),
    fullBox("hdlr", joinBytes([u32(0), new Uint8Array([115, 111, 117, 110]), new Uint8Array(12)])),
    makeBox("minf", joinBytes([
      fullBox("smhd", u32(0)),
      makeBox("dinf", fullBox("dref", joinBytes([u32(1), fullBox("url ", new Uint8Array(0))]))),
      makeBox("stbl", joinBytes([stsd, stts, sizePayload, stsc, offsets])),
    ])),
  ]));
  const trackChildren = [header("tkhd", timescale, version), mdia];
  if (options.editMediaTime !== undefined) {
    const elst = fullBox("elst", joinBytes([u32(1), u32(1000), u32(options.editMediaTime), new Uint8Array([0, 1, 0, 0])]));
    trackChildren.push(makeBox("edts", elst));
  }
  return makeBox("trak", joinBytes(trackChildren));
}

interface FixtureOptions {
  samples: Uint8Array[];
  durations?: number[];
  fixedSize?: boolean;
  samplesPerChunk?: number[];
  afterMdat?: boolean;
  interleavedVideo?: boolean;
  largeMoov?: boolean;
  co64?: boolean;
  version?: 0 | 1;
  editMediaTime?: number;
  codec?: string;
  stz2?: boolean;
  fragmented?: boolean;
  noAudio?: boolean;
}

function largeBox(type: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(payload.length + 16);
  const view = new DataView(result.buffer);
  view.setUint32(0, 1);
  result.set(new TextEncoder().encode(type), 4);
  view.setBigUint64(8, BigInt(result.length));
  result.set(payload, 16);
  return result;
}

function fileType(): Uint8Array {
  return makeBox("ftyp", new Uint8Array([105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 105, 115, 111, 50, 109, 112, 52, 49, 77, 52, 65, 32]));
}

function makeFixture(options: FixtureOptions): Blob {
  const sizes = options.samples.map((sample) => sample.length);
  const durations = options.durations ?? sizes.map(() => timescale);
  const grouping: number[] = [];
  const pattern = options.samplesPerChunk ?? [sizes.length];
  let remaining = sizes.length;
  for (let cursor = 0; remaining > 0; cursor += 1) {
    const amount = Math.min(pattern[cursor % pattern.length]!, remaining);
    grouping.push(amount);
    remaining -= amount;
  }
  const mdatParts: Uint8Array[] = [];
  const relativeOffsets: number[] = [];
  let sampleIndex = 0;
  let payloadLength = 0;
  for (const count of grouping) {
    relativeOffsets.push(payloadLength);
    for (let item = 0; item < count; item += 1) {
      mdatParts.push(options.samples[sampleIndex]!);
      payloadLength += options.samples[sampleIndex]!.length;
      sampleIndex += 1;
    }
    if (options.interleavedVideo) {
      const video = new Uint8Array([250, 251, 252, 253]);
      mdatParts.push(video);
      payloadLength += video.length;
    }
  }
  const mediaPayload = joinBytes(mdatParts);
  const ftyp = fileType();
  const moovFor = (offsets: number[]): Uint8Array => {
    const track = audioTrack({
      sizes, durations, chunkOffsets: offsets, samplesPerChunk: grouping,
      fixedSize: options.fixedSize ? sizes[0] : undefined,
      codec: options.codec, version: options.version, editMediaTime: options.editMediaTime, useStz2: options.stz2, co64: options.co64,
    });
    const tracks = options.noAudio ? [] : [track];
    if (options.interleavedVideo || options.noAudio) {
      const videoHandler = fullBox("hdlr", joinBytes([u32(0), new Uint8Array([118, 105, 100, 101]), new Uint8Array(12)]));
      tracks.unshift(makeBox("trak", makeBox("mdia", videoHandler)));
    }
    const children = [header("mvhd", timescale, options.version ?? 0), ...tracks];
    if (options.fragmented) children.push(makeBox("mvex", new Uint8Array()));
    const moov = makeBox("moov", joinBytes(children));
    return options.largeMoov ? largeBox("moov", moov.slice(8)) : moov;
  };
  const initial = moovFor(new Array<number>(relativeOffsets.length).fill(0));
  const mdatStart = options.afterMdat ? ftyp.length : ftyp.length + initial.length;
  const chunkOffsets = relativeOffsets.map((offset) => mdatStart + 8 + offset);
  const moov = moovFor(chunkOffsets);
  const mdat = makeBox("mdat", mediaPayload);
  const parts = options.afterMdat ? [ftyp, mdat, moov] : [ftyp, moov, mdat];
  if (options.fragmented) parts.unshift(makeBox("moof", new Uint8Array()));
  return new Blob(parts.map((part) => new Uint8Array(part)));
}

function samples(count: number, size = 3): Uint8Array[] {
  return Array.from({ length: count }, (_, index) => new Uint8Array(size).fill(index & 255));
}

async function mdatPayload(blob: Blob): Promise<Uint8Array> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const top = boxes(bytes, 0, bytes.length);
  const mdat = top.find((box) => box.type === "mdat");
  if (!mdat) throw new Error("Missing mdat in generated chunk.");
  return bytes.slice(mdat.payloadStart, mdat.end);
}

describe("MP4 splitter", () => {
  it("plans audio-only files with moov before and after mdat, covering every sample", async () => {
    for (const afterMdat of [false, true]) {
      const source = makeFixture({ samples: samples(14), afterMdat });
      const plan = await planMp4Split(source, { targetSeconds: 5, maxBytes });
      expect(plan.totalSeconds).toBe(14);
      expect(plan.chunks[0]?.ownSampleStart).toBe(0);
      expect(plan.chunks.at(-1)?.ownSampleEnd).toBe(14);
      expect(plan.chunks.reduce((total, chunk) => total + chunk.ownSampleEnd - chunk.ownSampleStart, 0)).toBe(14);
      for (let index = 1; index < plan.chunks.length; index += 1) {
        expect(plan.chunks[index]?.ownSampleStart).toBe(plan.chunks[index - 1]?.ownSampleEnd);
      }
    }
  });

  it("ignores interleaved video and coalesces only adjacent audio reads", async () => {
    const source = makeFixture({ samples: samples(8, 2), samplesPerChunk: [1], interleavedVideo: true });
    const plan = await planMp4Split(source, { targetSeconds: 3600, maxBytes });
    const chunk = await readMp4Chunk(source, plan, 0);
    expect(await mdatPayload(chunk)).toEqual(joinBytes(samples(8, 2)));
    let reads = 0;
    class ReadCountSlice extends Blob {
      constructor(private readonly value: Blob) { super(); }
      override get size(): number { return this.value.size; }
      override async arrayBuffer(): Promise<ArrayBuffer> {
        reads += 1;
        return this.value.arrayBuffer();
      }
    }
    class ReadCountBlob extends Blob {
      constructor(value: Blob) { super([value]); }
      override slice(start?: number, end?: number, type?: string): Blob {
        return new ReadCountSlice(super.slice(start, end, type));
      }
    }
    const contiguousSource = new ReadCountBlob(makeFixture({ samples: samples(8, 2) }));
    const contiguousPlan = await planMp4Split(contiguousSource, { targetSeconds: 5, maxBytes });
    reads = 0;
    await readMp4Chunk(contiguousSource, contiguousPlan, 0);
    expect(reads).toBe(1);
  });

  it("parses largesize boxes, co64 offsets, and version-1 headers", async () => {
    const source = makeFixture({ samples: samples(8), largeMoov: true, co64: true, version: 1 });
    const plan = await planMp4Split(source, { targetSeconds: 5, maxBytes });
    expect(plan.totalSeconds).toBe(8);
    expect(plan.sampleRate).toBe(44100);
    expect(plan.chunks.length).toBeGreaterThan(0);
  });

  it("supports fixed and table stsz, multiple stsc entries, and multiple stts runs", async () => {
    const fixture = makeFixture({ samples: samples(12, 4), fixedSize: true, samplesPerChunk: [2, 3], durations: Array.from({ length: 12 }, (_, i) => i < 6 ? timescale : timescale * 2) });
    const plan = await planMp4Split(fixture, { targetSeconds: 5, maxBytes });
    expect(plan.totalSeconds).toBe(18);
    const tablePlan = await planMp4Split(makeFixture({ samples: samples(8, 3) }), { targetSeconds: 5, maxBytes });
    expect(tablePlan.totalSeconds).toBe(8);
  });

  it("round-trips each generated chunk with exact sample payload and duration", async () => {
    const sourceSamples = samples(17, 5);
    const source = makeFixture({ samples: sourceSamples, durations: sourceSamples.map((_, i) => i < 9 ? timescale : timescale * 2) });
    const plan = await planMp4Split(source, { targetSeconds: 5, maxBytes });
    for (const chunk of plan.chunks) {
      const output = await readMp4Chunk(source, plan, chunk.index);
      const parsed = await planMp4Split(output, { targetSeconds: 3600, maxBytes });
      expect(parsed.chunks).toHaveLength(1);
      expect(parsed.chunks[0]!.ownSampleEnd).toBe(chunk.ownSampleEnd - chunk.ownSampleStart + chunk.leadInSampleCount);
      expect(parsed.totalSeconds).toBeCloseTo(chunk.ownDurationSeconds + chunk.leadInSeconds);
      const first = chunk.ownSampleStart - chunk.leadInSampleCount;
      const expected = joinBytes(sourceSamples.slice(first, chunk.ownSampleEnd));
      expect(await mdatPayload(output)).toEqual(expected);
    }
  });

  it("keeps at least two lead-in samples and warns once when byte limits reduce lead-in", async () => {
    const source = makeFixture({ samples: samples(40, 20000) });
    const plan = await planMp4Split(source, { targetSeconds: 5, maxBytes, minLeadInSeconds: 60 });
    expect(plan.chunks[0]?.leadInSampleCount).toBe(0);
    expect(plan.chunks.slice(1).every((chunk) => chunk.leadInSampleCount >= 2)).toBe(true);
    expect(plan.warnings.filter((warning) => warning.includes("Reduced lead-in"))).toHaveLength(1);
    expect(plan.chunks.every((chunk) => chunk.estimatedBytes <= maxBytes)).toBe(true);
    const minLeadPlan = await planMp4Split(makeFixture({ samples: samples(20) }), { targetSeconds: 5, maxBytes, minLeadInSeconds: 3 });
    expect(minLeadPlan.chunks.slice(1).every((chunk) => chunk.leadInSeconds >= 3)).toBe(true);
    expect(plan.chunks[0]!.ownDurationSeconds).toBeLessThan(5);
  });

  it("warns for unusual edit lists and unverified codecs", async () => {
    const source = makeFixture({ samples: samples(8), editMediaTime: 3000, codec: "alac" });
    const plan = await planMp4Split(source, { targetSeconds: 5, maxBytes });
    expect(plan.warnings).toContain("Codec alac was not verified");
    expect(plan.warnings.some((warning) => warning.includes("edit-list"))).toBe(true);
    const priming = await planMp4Split(makeFixture({ samples: samples(8), editMediaTime: 1024 }), { targetSeconds: 5, maxBytes });
    expect(priming.warnings.some((warning) => warning.includes("edit-list"))).toBe(false);
  });

  it("rejects unsupported and malformed inputs with fixed messages", async () => {
    const fragmented = makeFixture({ samples: samples(5), fragmented: true });
    await expect(planMp4Split(fragmented, { targetSeconds: 5, maxBytes })).rejects.toThrow("Fragmented MP4 is not supported.");
    const noAudio = makeFixture({ samples: samples(5), noAudio: true });
    await expect(planMp4Split(noAudio, { targetSeconds: 5, maxBytes })).rejects.toThrow("No audio track was found.");
    const valid = makeFixture({ samples: samples(5) });
    const bytes = new Uint8Array(await valid.arrayBuffer());
    await expect(planMp4Split(new Blob([bytes.slice(0, -2)]), { targetSeconds: 5, maxBytes })).rejects.toBeInstanceOf(Mp4SplitError);
    await expect(planMp4Split(new Blob([new Uint8Array(fileType())]), { targetSeconds: 5, maxBytes })).rejects.toBeInstanceOf(Mp4SplitError);
    await expect(planMp4Split(makeFixture({ samples: samples(5), stz2: true }), { targetSeconds: 5, maxBytes })).rejects.toThrow("Compact sample sizes are not supported.");
    await expect(planMp4Split(new Blob([new Uint8Array([0, 1, 2])]), { targetSeconds: 5, maxBytes })).rejects.toThrow("Unable to parse MP4 audio.");
    await expect(readMp4Chunk(valid, { chunks: [], totalSeconds: 0, sampleRate: 0, timescale: 0, codec: "", warnings: [] }, 0)).rejects.toBeInstanceOf(Mp4SplitError);
    await expect(planMp4Split(valid, { targetSeconds: 4, maxBytes })).rejects.toBeInstanceOf(RangeError);
    await expect(planMp4Split(valid, { targetSeconds: 5, maxBytes: 99999 })).rejects.toBeInstanceOf(RangeError);
    await expect(planMp4Split(valid, { targetSeconds: 5, maxBytes, minLeadInSeconds: 61 })).rejects.toBeInstanceOf(RangeError);
    await expect(planMp4Split(valid, { targetSeconds: 3601, maxBytes })).rejects.toBeInstanceOf(RangeError);
    await expect(planMp4Split(valid, { targetSeconds: 5, maxBytes: 24000001 })).rejects.toBeInstanceOf(RangeError);
    await expect(planMp4Split(valid, { targetSeconds: 5, maxBytes: 100000.5 })).rejects.toBeInstanceOf(RangeError);
    await expect(planMp4Split(valid, { targetSeconds: 5, maxBytes, minLeadInSeconds: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    expect(new Mp4SplitError("Fixed message").message).toBe("Fixed message");
  });

  it("does not read mdat payload while planning a large file", async () => {
    let readVolume = 0;
    class CountedSlice extends Blob {
      constructor(private readonly wrapped: Blob, private readonly count: (size: number) => void) { super(); }
      override get size(): number { return this.wrapped.size; }
      override async arrayBuffer(): Promise<ArrayBuffer> {
        this.count(this.size);
        return this.wrapped.arrayBuffer();
      }
    }
    class CountedBlob extends Blob {
      constructor(parts: BlobPart[], private readonly count: (size: number) => void) { super(parts); }
      override slice(start?: number, end?: number, contentType?: string): Blob {
        return new CountedSlice(super.slice(start, end, contentType), this.count);
      }
    }
    const bytes = new Uint8Array(2 * 1024 * 1024);
    const fixture = makeFixture({ samples: [bytes] });
    const source = new CountedBlob([fixture], (size) => { readVolume += size; });
    await planMp4Split(source, { targetSeconds: 5, maxBytes });
    expect(readVolume).toBeLessThan(source.size / 10);
  });

  it("plans a virtual 20-hour recording in under five seconds with 20 chunks", async () => {
    const sampleCount = 3_375_000;
    const ftyp = fileType();
    const duration = 1024;
    const entryPayload = new Uint8Array(28);
    const entry = makeBox("mp4a", entryPayload);
    const stsd = fullBox("stsd", joinBytes([u32(1), entry]));
    const scaleHeader = (type: string, scale: number, mediaDuration = 1): Uint8Array => header(type, scale, 0, 1, mediaDuration);
    const tables = makeBox("stbl", joinBytes([
      stsd,
      fullBox("stts", u32(1, sampleCount, duration)),
      fullBox("stsz", u32(1, sampleCount)),
      fullBox("stsc", u32(1, 1, sampleCount, 1)),
      fullBox("stco", u32(1, 0)),
    ]));
    const media = makeBox("minf", joinBytes([
      fullBox("smhd", u32(0)),
      makeBox("dinf", fullBox("dref", joinBytes([u32(1), fullBox("url ", new Uint8Array(0))]))),
      tables,
    ]));
    const mdia = makeBox("mdia", joinBytes([
      scaleHeader("mdhd", timescale, sampleCount * duration),
      fullBox("hdlr", joinBytes([u32(0), new Uint8Array([115, 111, 117, 110]), new Uint8Array(12)])),
      media,
    ]));
    const track = makeBox("trak", joinBytes([scaleHeader("tkhd", timescale), mdia]));
    const builtMoov = makeBox("moov", joinBytes([scaleHeader("mvhd", timescale), track]));
    const actualOffset = ftyp.length + builtMoov.length + 8;
    const correctedStco = fullBox("stco", u32(1, actualOffset));
    const fixedTables = makeBox("stbl", joinBytes([
      stsd, fullBox("stts", u32(1, sampleCount, duration)), fullBox("stsz", u32(1, sampleCount)),
      fullBox("stsc", u32(1, 1, sampleCount, 1)), correctedStco,
    ]));
    const fixedMedia = makeBox("minf", joinBytes([
      fullBox("smhd", u32(0)), makeBox("dinf", fullBox("dref", joinBytes([u32(1), fullBox("url ", new Uint8Array(0))]))), fixedTables,
    ]));
    const fixedMdia = makeBox("mdia", joinBytes([
      scaleHeader("mdhd", timescale, sampleCount * duration),
      fullBox("hdlr", joinBytes([u32(0), new Uint8Array([115, 111, 117, 110]), new Uint8Array(12)])), fixedMedia,
    ]));
    const finalMoov = makeBox("moov", joinBytes([scaleHeader("mvhd", timescale), makeBox("trak", joinBytes([scaleHeader("tkhd", timescale), fixedMdia]))]));
    const virtualSize = actualOffset + sampleCount;
    const virtualMdatHeader = new Uint8Array(8);
    new DataView(virtualMdatHeader.buffer).setUint32(0, sampleCount + virtualMdatHeader.length);
    virtualMdatHeader.set([109, 100, 97, 116], 4);
    class VirtualSlice extends Blob {
      constructor(private readonly length: number, private readonly fill: () => ArrayBuffer) { super(); }
      override get size(): number { return this.length; }
      override async arrayBuffer(): Promise<ArrayBuffer> { return this.fill(); }
    }
    class VirtualBlob extends Blob {
      constructor() { super(); }
      override get size(): number { return virtualSize; }
      override slice(start = 0, end = this.size): Blob {
        const from = Math.max(0, start);
        const to = Math.min(this.size, end);
        return new VirtualSlice(Math.max(0, to - from), () => {
          const result = new Uint8Array(Math.max(0, to - from));
          const segments = [{ start: 0, data: ftyp }, { start: ftyp.length, data: finalMoov }, { start: actualOffset - 8, data: virtualMdatHeader }];
          for (const segment of segments) {
            const left = Math.max(from, segment.start);
            const right = Math.min(to, segment.start + segment.data.length);
            if (right > left) result.set(segment.data.slice(left - segment.start, right - segment.start), left - from);
          }
          return result.buffer;
        });
      }
    }
    const started = performance.now();
    const plan = await planMp4Split(new VirtualBlob(), { targetSeconds: 3600, maxBytes: 24000000 });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(plan.chunks).toHaveLength(20);
    expect(plan.totalSeconds).toBe(72000);
  });
});
