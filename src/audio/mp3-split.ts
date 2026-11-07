export class Mp3SplitError extends Error {
  constructor() {
    super("Unable to parse MP3 audio frames.");
    this.name = "Mp3SplitError";
  }
}

export interface Mp3Chunk {
  index: number;
  bytes: Uint8Array;
  byteOffset: number;
  frameCount: number;
  leadInFrames: number;
  leadInSeconds: number;
  ownStartSeconds: number;
  ownDurationSeconds: number;
}

export interface Mp3SplitResult {
  chunks: Mp3Chunk[];
  totalSeconds: number;
  sampleRate: number;
  warnings: string[];
}

export interface Mp3SplitOptions {
  targetSeconds: number;
  maxBytes: number;
  minLeadInSeconds?: number;
}


interface Header {
  length: number;
  sampleRate: number;
  samples: number;
  crcBytes: number;
  sideInfoBytes: number;
  version: number;
}

const BITRATES: Record<number, readonly number[]> = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const BASE_SAMPLE_RATES = [44100, 48000, 32000] as const;

function parseHeader(data: Uint8Array, offset: number, end: number): Header | null {
  if (offset + 4 > end || data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) return null;
  const b1 = data[offset + 1];
  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  const bitrateIndex = data[offset + 2] >> 4;
  const sampleRateIndex = (data[offset + 2] >> 2) & 3;
  const padding = (data[offset + 2] >> 1) & 1;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
  const bitrate = BITRATES[version === 1 ? 1 : 2]?.[bitrateIndex];
  const baseRate = BASE_SAMPLE_RATES[sampleRateIndex];
  if (bitrate === undefined || baseRate === undefined) return null;
  const sampleRate = version === 1 ? baseRate : version === 2 ? baseRate / 2 : baseRate / 4;
  const length = Math.floor((version === 1 ? 144 : 72) * bitrate * 1000 / sampleRate) + padding;
  if (offset + length > end) return null;
  const mono = (data[offset + 3] >> 6) === 3;
  return {
    length,
    sampleRate,
    samples: version === 1 ? 1152 : 576,
    crcBytes: (b1 & 1) === 0 ? 2 : 0,
    sideInfoBytes: version === 1 ? (mono ? 17 : 32) : (mono ? 9 : 17),
    version,
  };
}

function readSyncsafeSize(data: Uint8Array): number {
  if ((data[6] & 0x80) !== 0 || (data[7] & 0x80) !== 0 || (data[8] & 0x80) !== 0 || (data[9] & 0x80) !== 0) {
    throw new Mp3SplitError();
  }
  return (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9];
}

function hasMarker(data: Uint8Array, offset: number, marker: string): boolean {
  if (offset + marker.length > data.length) return false;
  for (let i = 0; i < marker.length; i += 1) if (data[offset + i] !== marker.charCodeAt(i)) return false;
  return true;
}

function isMetadataFrame(data: Uint8Array, offset: number, header: Header): boolean {
  const xingOffset = offset + 4 + header.crcBytes + header.sideInfoBytes;
  return hasMarker(data, xingOffset, "Xing") || hasMarker(data, xingOffset, "Info") || hasMarker(data, offset + 36, "VBRI");
}

function mainDataBegin(data: Uint8Array, offset: number, header: Header): number {
  const side = offset + 4 + header.crcBytes;
  if (header.version === 1) return (data[side] << 1) | (data[side + 1] >> 7);
  return data[side];
}

function findNextFrame(data: Uint8Array, from: number, end: number): number {
  for (let at = from; at + 4 <= end; at += 1) {
    const header = parseHeader(data, at, end);
    if (header === null) continue;
    if (at + header.length === end) return at;
    const next = parseHeader(data, at + header.length, end);
    if (next !== null) return at;
  }
  return -1;
}

export interface Mp3ChunkPlan {
  index: number;
  byteOffset: number;
  byteLength: number;
  frameCount: number;
  leadInFrames: number;
  leadInSeconds: number;
  ownStartSeconds: number;
  ownDurationSeconds: number;
}

export interface Mp3PlanResult {
  chunks: Mp3ChunkPlan[];
  totalSeconds: number;
  sampleRate: number;
  warnings: string[];
}

export interface Mp3WindowOptions extends Mp3SplitOptions {
  windowBytes?: number;
  signal?: AbortSignal;
}

interface FrameIndex {
  offsets: Float64Array;
  lengths: Uint16Array;
  payloadSizes: Uint16Array;
  rates: Float64Array;
  samples: Uint16Array;
  reservoir: Uint16Array;
  count: number;
}

function createIndex(): FrameIndex {
  return {
    offsets: new Float64Array(1024),
    lengths: new Uint16Array(1024),
    payloadSizes: new Uint16Array(1024),
    rates: new Float64Array(1024),
    samples: new Uint16Array(1024),
    reservoir: new Uint16Array(1024),
    count: 0,
  };
}

function appendFrame(
  index: FrameIndex,
  offset: number,
  header: Header,
  data: Uint8Array,
  localOffset: number,
  reservoirValue?: number,
): void {
  if (index.count === index.offsets.length) {
    const capacity = index.offsets.length * 2;
    const offsets = new Float64Array(capacity);
    const lengths = new Uint16Array(capacity);
    const payloadSizes = new Uint16Array(capacity);
    const rates = new Float64Array(capacity);
    const samples = new Uint16Array(capacity);
    const reservoir = new Uint16Array(capacity);
    offsets.set(index.offsets);
    lengths.set(index.lengths);
    payloadSizes.set(index.payloadSizes);
    rates.set(index.rates);
    samples.set(index.samples);
    reservoir.set(index.reservoir);
    index.offsets = offsets;
    index.lengths = lengths;
    index.payloadSizes = payloadSizes;
    index.rates = rates;
    index.samples = samples;
    index.reservoir = reservoir;
  }
  const at = index.count++;
  index.offsets[at] = offset;
  index.lengths[at] = header.length;
  index.payloadSizes[at] = header.length - 4 - header.crcBytes - header.sideInfoBytes;
  index.rates[at] = header.sampleRate;
  index.samples[at] = header.samples;
  index.reservoir[at] = reservoirValue ?? mainDataBegin(data, localOffset, header);
}

function validateOptions(options: Mp3SplitOptions): number {
  if (!Number.isFinite(options.targetSeconds) || options.targetSeconds < 5 || options.targetSeconds > 3600) {
    throw new RangeError("targetSeconds must be between 5 and 3600.");
  }
  if (!Number.isInteger(options.maxBytes) || options.maxBytes < 100000 || options.maxBytes > 24000000) {
    throw new RangeError("maxBytes must be between 100000 and 24000000.");
  }
  const minLeadInSeconds = options.minLeadInSeconds ?? 0;
  if (!Number.isFinite(minLeadInSeconds) || minLeadInSeconds < 0 || minLeadInSeconds > 60) {
    throw new RangeError("minLeadInSeconds must be between 0 and 60.");
  }
  return minLeadInSeconds;
}

interface Selection {
  plans: Mp3ChunkPlan[];
  totalSeconds: number;
  sampleRate: number;
  warnings: string[];
}

function selectChunks(index: FrameIndex, skippedBytes: number, minLeadInSeconds: number, maxBytes: number, targetSeconds: number): Selection {
  if (index.count === 0) throw new Mp3SplitError();
  const warnings: string[] = [];
  let leadInReduced = false;
  if (skippedBytes > 0) warnings.push(`Resynchronized after skipping ${skippedBytes} bytes.`);
  const rates = index.rates.subarray(0, index.count);
  const sampleRate = rates[0] ?? 0;
  for (let i = 1; i < index.count; i += 1) {
    if (rates[i] !== sampleRate) {
      warnings.push("MP3 contains mixed sample rates.");
      break;
    }
  }
  const timeline = new Float64Array(index.count + 1);
  for (let i = 0; i < index.count; i += 1) {
    timeline[i + 1] = (timeline[i] ?? 0) + (index.samples[i] ?? 0) / (rates[i] ?? 1);
  }
  const totalSeconds = timeline[index.count] ?? 0;
  const plans: Mp3ChunkPlan[] = [];
  let ownStart = 0;
  while (ownStart < index.count) {
    let leadStart = ownStart;
    let leadFrames = 0;
    if (ownStart > 0 && index.reservoir[ownStart] !== 0) {
      let leadPayloadBytes = 0;
      while (leadStart > 0 && leadPayloadBytes < 1022) {
        leadStart -= 1;
        leadPayloadBytes += index.payloadSizes[leadStart] ?? 0;
        leadFrames += 1;
      }
    }
    if (minLeadInSeconds > 0 && ownStart > 0) {
      while (leadStart > 0 && (timeline[ownStart] ?? 0) - (timeline[leadStart] ?? 0) < minLeadInSeconds) {
        leadStart -= 1;
        leadFrames += 1;
      }
      const availableLeadBytes = maxBytes - (index.lengths[ownStart] ?? 0);
      let leadBytes = (index.offsets[ownStart] ?? 0) - (index.offsets[leadStart] ?? 0);
      while (leadStart < ownStart && leadBytes > availableLeadBytes) {
        leadBytes -= index.lengths[leadStart] ?? 0;
        leadStart += 1;
        leadFrames -= 1;
        leadInReduced = true;
      }
    }
    const firstByte = index.offsets[leadStart] ?? 0;
    let byteLimitEnd = ownStart;
    while (
      byteLimitEnd < index.count
      && (index.offsets[byteLimitEnd] ?? 0) + (index.lengths[byteLimitEnd] ?? 0) - firstByte <= maxBytes
    ) byteLimitEnd += 1;
    const targetTime = (timeline[ownStart] ?? 0) + targetSeconds;
    let targetEnd = ownStart + 1;
    while (targetEnd < index.count && (timeline[targetEnd] ?? 0) < targetTime) targetEnd += 1;
    let ownEnd = Math.min(byteLimitEnd, targetEnd);
    if (ownEnd <= ownStart) ownEnd = ownStart + 1;
    if (ownEnd < index.count && ownEnd === targetEnd) {
      const searchEndTime = (timeline[ownEnd] ?? 0) + 5;
      let preferred = ownEnd;
      while (
        preferred < index.count && preferred < byteLimitEnd
        && (timeline[preferred] ?? 0) <= searchEndTime && index.reservoir[preferred] !== 0
      ) preferred += 1;
      if (preferred < index.count && preferred < byteLimitEnd && (timeline[preferred] ?? 0) <= searchEndTime) ownEnd = preferred;
    }
    const byteOffset = index.offsets[leadStart] ?? 0;
    const endOffset = (index.offsets[ownEnd - 1] ?? 0) + (index.lengths[ownEnd - 1] ?? 0);
    plans.push({
      index: plans.length,
      byteOffset,
      byteLength: endOffset - byteOffset,
      frameCount: ownEnd - leadStart,
      leadInFrames: leadFrames,
      leadInSeconds: (timeline[ownStart] ?? 0) - (timeline[leadStart] ?? 0),
      ownStartSeconds: timeline[ownStart] ?? 0,
      ownDurationSeconds: (timeline[ownEnd] ?? 0) - (timeline[ownStart] ?? 0),
    });
    ownStart = ownEnd;
  }
  if (leadInReduced) warnings.push("Reduced lead-in on one or more chunks to fit maxBytes.");
  return { plans, totalSeconds, sampleRate, warnings };
}

export function splitMp3(data: Uint8Array, options: Mp3SplitOptions): Mp3SplitResult {
  const minLeadInSeconds = validateOptions(options);
  let end = data.length;
  if (end >= 128 && hasMarker(data, end - 128, "TAG")) end -= 128;
  let start = 0;
  if (data.length >= 10 && hasMarker(data, 0, "ID3")) {
    const tagSize = readSyncsafeSize(data);
    const footerBytes = (data[5] & 0x10) !== 0 ? 10 : 0;
    start = 10 + tagSize + footerBytes;
    if (start > end) throw new Mp3SplitError();
  }
  const index = createIndex();
  let skippedBytes = 0;
  let cursor = start;
  let metadataAllowed = true;
  while (cursor + 4 <= end) {
    const header = parseHeader(data, cursor, end);
    if (header === null) {
      const next = findNextFrame(data, cursor + 1, end);
      if (next < 0) break;
      skippedBytes += next - cursor;
      cursor = next;
    }
    const parsed = parseHeader(data, cursor, end);
    if (parsed === null) break;
    if (!(metadataAllowed && isMetadataFrame(data, cursor, parsed))) appendFrame(index, cursor, parsed, data, cursor);
    metadataAllowed = false;
    cursor += parsed.length;
  }
  const selected = selectChunks(index, skippedBytes, minLeadInSeconds, options.maxBytes, options.targetSeconds);
  return {
    chunks: selected.plans.map((plan) => ({
      index: plan.index,
      bytes: data.subarray(plan.byteOffset, plan.byteOffset + plan.byteLength),
      byteOffset: plan.byteOffset,
      frameCount: plan.frameCount,
      leadInFrames: plan.leadInFrames,
      leadInSeconds: plan.leadInSeconds,
      ownStartSeconds: plan.ownStartSeconds,
      ownDurationSeconds: plan.ownDurationSeconds,
    })),
    totalSeconds: selected.totalSeconds,
    sampleRate: selected.sampleRate,
    warnings: selected.warnings,
  };
}

export async function planMp3Split(source: Blob, options: Mp3WindowOptions): Promise<Mp3PlanResult> {
  const minLeadInSeconds = validateOptions(options);
  const windowBytes = options.windowBytes ?? 4 * 1024 * 1024;
  if (!Number.isInteger(windowBytes) || windowBytes < 64 * 1024) throw new RangeError("windowBytes must be at least 65536.");
  const signal = options.signal;
  const checkAbort = (): void => {
    if (signal?.aborted === true) throw new DOMException("The operation was aborted.", "AbortError");
  };
  let window = new Uint8Array(0);
  let windowStart = 0;
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    checkAbort();
    if (offset < windowStart || offset + length > windowStart + window.length) {
      window = new Uint8Array(0);
      windowStart = offset;
      const end = Math.min(source.size, offset + windowBytes);
      const buffer = await source.slice(offset, end).arrayBuffer();
      checkAbort();
      window = new Uint8Array(buffer);
    }
    const localOffset = offset - windowStart;
    if (localOffset + length > window.length) return read(offset, length);
    return window.subarray(localOffset, localOffset + length);
  };
  const marker = async (offset: number, value: string): Promise<boolean> => {
    if (offset < 0 || offset + value.length > source.size) return false;
    const bytes = await read(offset, value.length);
    for (let i = 0; i < value.length; i += 1) if (bytes[i] !== value.charCodeAt(i)) return false;
    return true;
  };
  let end = source.size;
  if (end >= 128 && await marker(end - 128, "TAG")) end -= 128;
  let start = 0;
  if (source.size >= 10 && await marker(0, "ID3")) {
    const tag = await read(0, 10);
    if ((tag[6]! & 0x80) !== 0 || (tag[7]! & 0x80) !== 0 || (tag[8]! & 0x80) !== 0 || (tag[9]! & 0x80) !== 0) throw new Mp3SplitError();
    const tagSize = (tag[6]! << 21) | (tag[7]! << 14) | (tag[8]! << 7) | tag[9]!;
    start = 10 + tagSize + ((tag[5]! & 0x10) !== 0 ? 10 : 0);
    if (start > end) throw new Mp3SplitError();
  }
  const parse = async (offset: number): Promise<Header | null> => {
    if (offset + 4 > end) return null;
    const bytes = await read(offset, 4);
    const first = bytes[0] ?? 0;
    const b1 = bytes[1] ?? 0;
    const b2 = bytes[2] ?? 0;
    const b3 = bytes[3] ?? 0;
    const versionBits = (b1 >> 3) & 3;
    const layerBits = (b1 >> 1) & 3;
    const bitrateIndex = b2 >> 4;
    const sampleRateIndex = (b2 >> 2) & 3;
    const padding = (b2 >> 1) & 1;
    if (first !== 0xff || (b1 & 0xe0) !== 0xe0 || versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
    const bitrate = BITRATES[version === 1 ? 1 : 2]?.[bitrateIndex];
    const baseRate = BASE_SAMPLE_RATES[sampleRateIndex];
    if (bitrate === undefined || baseRate === undefined) return null;
    const sampleRate = version === 1 ? baseRate : version === 2 ? baseRate / 2 : baseRate / 4;
    const length = Math.floor((version === 1 ? 144 : 72) * bitrate * 1000 / sampleRate) + padding;
    if (offset + length > end) return null;
    const mono = (b3 >> 6) === 3;
    return { length, sampleRate, samples: version === 1 ? 1152 : 576, crcBytes: (b1 & 1) === 0 ? 2 : 0, sideInfoBytes: version === 1 ? (mono ? 17 : 32) : (mono ? 9 : 17), version };
  };
  const findNext = async (from: number): Promise<number> => {
    for (let at = from; at + 4 <= end; at += 1) {
      const header = await parse(at);
      if (header === null) continue;
      if (at + header.length === end || await parse(at + header.length) !== null) return at;
    }
    return -1;
  };
  const index = createIndex();
  let skippedBytes = 0;
  let cursor = start;
  let metadataAllowed = true;
  while (cursor + 4 <= end) {
    let header = await parse(cursor);
    if (header === null) {
      const next = await findNext(cursor + 1);
      if (next < 0) break;
      skippedBytes += next - cursor;
      cursor = next;
      header = await parse(cursor);
    }
    if (header === null) break;
    let metadata = false;
    if (metadataAllowed) {
      const xingOffset = cursor + 4 + header.crcBytes + header.sideInfoBytes;
      metadata = await marker(xingOffset, "Xing") || await marker(xingOffset, "Info") || await marker(cursor + 36, "VBRI");
    }
    if (!metadata) {
      const side = cursor + 4 + header.crcBytes;
      const sideBytes = await read(side, header.version === 1 ? 2 : 1);
      const reservoir = header.version === 1 ? (((sideBytes[0] ?? 0) << 1) | ((sideBytes[1] ?? 0) >> 7)) : sideBytes[0] ?? 0;
      appendFrame(index, cursor, header, sideBytes, 0, reservoir);
    }
    metadataAllowed = false;
    cursor += header.length;
  }
  const selected = selectChunks(index, skippedBytes, minLeadInSeconds, options.maxBytes, options.targetSeconds);
  return { chunks: selected.plans, totalSeconds: selected.totalSeconds, sampleRate: selected.sampleRate, warnings: selected.warnings };
}

export function readMp3Chunk(source: Blob, plan: Mp3ChunkPlan): Blob {
  return source.slice(plan.byteOffset, plan.byteOffset + plan.byteLength, "audio/mpeg");
}

// Absolute provider time for a chunk timestamp t is ownStartSeconds - leadInSeconds + t.
