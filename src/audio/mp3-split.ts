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

export function splitMp3(data: Uint8Array, options: Mp3SplitOptions): Mp3SplitResult {
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

  let end = data.length;
  if (end >= 128 && hasMarker(data, end - 128, "TAG")) end -= 128;
  let start = 0;
  if (data.length >= 10 && hasMarker(data, 0, "ID3")) {
    const tagSize = readSyncsafeSize(data);
    const footerBytes = (data[5] & 0x10) !== 0 ? 10 : 0;
    start = 10 + tagSize + footerBytes;
    if (start > end) throw new Mp3SplitError();
  }

  const offsets: number[] = [];
  const lengths: number[] = [];
  const payloadSizes: number[] = [];
  const rates: number[] = [];
  const samplesPerFrame: number[] = [];
  const reservoir: number[] = [];
  const warnings: string[] = [];
  let leadInReduced = false;
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

    if (!(metadataAllowed && isMetadataFrame(data, cursor, parsed))) {
      offsets.push(cursor);
      lengths.push(parsed.length);
      payloadSizes.push(parsed.length - 4 - parsed.crcBytes - parsed.sideInfoBytes);
      rates.push(parsed.sampleRate);
      samplesPerFrame.push(parsed.samples);
      reservoir.push(mainDataBegin(data, cursor, parsed));
    }
    metadataAllowed = false;
    cursor += parsed.length;
  }
  if (offsets.length === 0) throw new Mp3SplitError();
  if (skippedBytes > 0) warnings.push(`Resynchronized after skipping ${skippedBytes} bytes.`);
  if (rates.some((rate) => rate !== rates[0])) warnings.push("MP3 contains mixed sample rates.");

  const durations: number[] = new Array(offsets.length);
  const timeline: number[] = new Array(offsets.length + 1);
  timeline[0] = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    durations[i] = samplesPerFrame[i] / rates[i];
    timeline[i + 1] = timeline[i] + durations[i];
  }
  const totalSeconds = timeline[offsets.length];
  const chunks: Mp3Chunk[] = [];
  let ownStart = 0;
  while (ownStart < offsets.length) {
    let ownEnd: number;
    let leadStart = ownStart;
    let leadFrames = 0;
    if (ownStart > 0 && reservoir[ownStart] !== 0) {
      let leadPayloadBytes = 0;
      while (leadStart > 0 && leadPayloadBytes < 1022) {
        leadStart -= 1;
        leadPayloadBytes += payloadSizes[leadStart];
        leadFrames += 1;
      }
    }
    if (minLeadInSeconds > 0 && ownStart > 0) {
      while (leadStart > 0 && timeline[ownStart] - timeline[leadStart] < minLeadInSeconds) {
        leadStart -= 1;
        leadFrames += 1;
      }
      const availableLeadBytes = options.maxBytes - lengths[ownStart];
      let leadBytes = offsets[ownStart] - offsets[leadStart];
      while (leadStart < ownStart && leadBytes > availableLeadBytes) {
        leadBytes -= lengths[leadStart];
        leadStart += 1;
        leadFrames -= 1;
        leadInReduced = true;
      }
    }
    let byteLimitEnd = ownStart;
    const firstByte = offsets[leadStart];
    while (byteLimitEnd < offsets.length && offsets[byteLimitEnd] + lengths[byteLimitEnd] - firstByte <= options.maxBytes) {
      byteLimitEnd += 1;
    }
    const targetTime = timeline[ownStart] + options.targetSeconds;
    let targetEnd = ownStart + 1;
    while (targetEnd < offsets.length && timeline[targetEnd] < targetTime) targetEnd += 1;
    ownEnd = Math.min(byteLimitEnd, targetEnd);
    if (ownEnd <= ownStart) ownEnd = ownStart + 1;

    if (ownEnd < offsets.length && ownEnd === targetEnd) {
      const searchEndTime = timeline[ownEnd] + 5;
      let preferred = ownEnd;
      while (
        preferred < offsets.length
        && preferred < byteLimitEnd
        && timeline[preferred] <= searchEndTime
        && reservoir[preferred] !== 0
      ) preferred += 1;
      if (
        preferred < offsets.length
        && preferred < byteLimitEnd
        && timeline[preferred] <= searchEndTime
      ) ownEnd = preferred;
    }

    const byteOffset = offsets[leadStart];
    const endOffset = offsets[ownEnd - 1] + lengths[ownEnd - 1];
    const ownDurationSeconds = timeline[ownEnd] - timeline[ownStart];
    const leadInSeconds = timeline[ownStart] - timeline[leadStart];
    chunks.push({
      index: chunks.length,
      bytes: data.subarray(byteOffset, endOffset),
      byteOffset,
      frameCount: ownEnd - leadStart,
      leadInFrames: leadFrames,
      leadInSeconds,
      ownStartSeconds: timeline[ownStart],
      ownDurationSeconds,
    });
    ownStart = ownEnd;
  }
  if (leadInReduced) warnings.push("Reduced lead-in on one or more chunks to fit maxBytes.");
  return { chunks, totalSeconds, sampleRate: rates[0], warnings };
}

// Absolute provider time for a chunk timestamp t is ownStartSeconds - leadInSeconds + t.
