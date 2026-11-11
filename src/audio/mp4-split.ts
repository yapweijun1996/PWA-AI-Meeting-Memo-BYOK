import { readFragmentSamples } from "./mp4-fragments";
import { boxAt, boxes, i32, joinBytes, makeBox, u32, u64, type IsoBox } from "./iso-bmff";

export class Mp4SplitError extends Error {
  constructor(message = "Unable to parse MP4 audio.") {
    super(message);
    this.name = "Mp4SplitError";
  }
}

export interface Mp4ChunkPlan {
  index: number;
  leadInSampleCount: number;
  ownSampleStart: number;
  ownSampleEnd: number;
  ownStartSeconds: number;
  ownDurationSeconds: number;
  leadInSeconds: number;
  estimatedBytes: number;
}

export interface Mp4SplitPlan {
  chunks: Mp4ChunkPlan[];
  totalSeconds: number;
  sampleRate: number;
  timescale: number;
  codec: string;
  warnings: string[];
}

export interface Mp4SplitOptions {
  targetSeconds: number;
  maxBytes: number;
  minLeadInSeconds?: number;
}

interface Parsed {
  offsets: Float64Array;
  sizes: Uint32Array;
  durations: Uint32Array;
  starts: Float64Array;
  stsdBox: Uint8Array;
  mdhd: Uint8Array;
  hdlr: Uint8Array;
  tkhd: Uint8Array;
  mvhd: Uint8Array;
  smhd: Uint8Array;
  dinf: Uint8Array;
  timescale: number;
  sampleRate: number;
  sourceSize: number;
  maxBytes: number;
  movieTimescale: number;
}

const parsedPlans = new WeakMap<Mp4SplitPlan, Parsed>();

function findChild(data: Uint8Array, parent: IsoBox | null, type: string): IsoBox | null {
  if (parent === null) return null;
  return boxes(data, parent.payloadStart, parent.end).find((box) => box.type === type) ?? null;
}

function copyBox(data: Uint8Array, box: IsoBox): Uint8Array {
  return data.slice(box.start, box.end);
}

function checkedBoxCount(data: Uint8Array, box: IsoBox, entrySize: number): number {
  if (box.payloadStart + 8 > box.end) throw new Mp4SplitError();
  const count = u32(data, box.payloadStart + 4);
  if (count > Math.floor((box.end - box.payloadStart - 8) / entrySize)) throw new Mp4SplitError();
  return count;
}

// Absolute provider time for a chunk timestamp t is ownStartSeconds - leadInSeconds + t.
// Indexed byte/sample reads below are bounded by validated box sizes and table counts.
export async function planMp4Split(source: Blob, options: Mp4SplitOptions): Promise<Mp4SplitPlan> {
  if (!Number.isFinite(options.targetSeconds) || options.targetSeconds < 5 || options.targetSeconds > 3600) throw new RangeError("targetSeconds must be between 5 and 3600.");
  if (!Number.isInteger(options.maxBytes) || options.maxBytes < 100000 || options.maxBytes > 24000000) throw new RangeError("maxBytes must be between 100000 and 24000000.");
  const minLead = options.minLeadInSeconds ?? 0;
  if (!Number.isFinite(minLead) || minLead < 0 || minLead > 60) throw new RangeError("minLeadInSeconds must be between 0 and 60.");

  try {
    const top: { type: string; offset: number; size: number; headerSize: number }[] = [];
    for (let cursor = 0; cursor < source.size;) {
      const header = new Uint8Array(await source.slice(cursor, Math.min(cursor + 16, source.size)).arrayBuffer());
      if (header.length < 8) throw new Mp4SplitError();
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const size32 = view.getUint32(0);
      const type = String.fromCharCode(header[4]!, header[5]!, header[6]!, header[7]!);
      let size = size32;
      let headerSize = 8;
      if (size32 === 1) {
        if (header.length < 16) throw new Mp4SplitError();
        size = u64(header, 8);
        headerSize = 16;
      } else if (size32 === 0) size = source.size - cursor;
      if (size < headerSize || cursor + size > source.size) throw new Mp4SplitError();
      top.push({ type, offset: cursor, size, headerSize });
      cursor += size;
    }
    const fragmented = top.some((box) => box.type === "moof");
    if (!top.some((box) => box.type === "ftyp")) throw new Mp4SplitError();
    const moovTop = top.find((box) => box.type === "moov");
    if (!moovTop) throw new Mp4SplitError();
    if (moovTop.size > 128 * 1024 * 1024) throw new Mp4SplitError();
    const moovData = new Uint8Array(await source.slice(moovTop.offset, moovTop.offset + moovTop.size).arrayBuffer());
    const root = boxAt(moovData, 0);
    if (!root || root.end !== moovData.length) throw new Mp4SplitError();
    const rootChildren = boxes(moovData, root.payloadStart, root.end);
    if (rootChildren.some((box) => box.type === "mvex") !== fragmented) throw new Mp4SplitError("Invalid fragmented MP4 structure.");
    const mvhdBox = rootChildren.find((box) => box.type === "mvhd");
    if (!mvhdBox) throw new Mp4SplitError();
    const mvhd = copyBox(moovData, mvhdBox);
    const movieVersion = mvhd[8]!;
    if (movieVersion !== 0 && movieVersion !== 1) throw new Mp4SplitError();
    const movieTimescale = u32(mvhd, movieVersion === 1 ? 28 : 20);
    if (movieTimescale === 0) throw new Mp4SplitError();

    let chosen: { track: IsoBox; mdia: IsoBox; minf: IsoBox; stbl: IsoBox } | null = null;
    for (const track of rootChildren.filter((box) => box.type === "trak")) {
      const mdia = findChild(moovData, track, "mdia");
      const hdlr = findChild(moovData, mdia, "hdlr");
      if (!mdia || !hdlr || hdlr.payloadStart + 12 > hdlr.end) continue;
      const handler = String.fromCharCode(moovData[hdlr.payloadStart + 8]!, moovData[hdlr.payloadStart + 9]!, moovData[hdlr.payloadStart + 10]!, moovData[hdlr.payloadStart + 11]!);
      if (handler !== "soun") continue;
      const minf = findChild(moovData, mdia, "minf");
      const stbl = findChild(moovData, minf, "stbl");
      if (minf && stbl) { chosen = { track, mdia, minf, stbl }; break; }
    }
    if (!chosen) throw new Mp4SplitError("No audio track was found.");

    const mdhdBox = findChild(moovData, chosen.mdia, "mdhd");
    const tkhdBox = findChild(moovData, chosen.track, "tkhd");
    const hdlrBox = findChild(moovData, chosen.mdia, "hdlr");
    const smhdBox = findChild(moovData, chosen.minf, "smhd");
    const dinfBox = findChild(moovData, chosen.minf, "dinf");
    const stsdBox = findChild(moovData, chosen.stbl, "stsd");
    const sttsBox = findChild(moovData, chosen.stbl, "stts");
    const stszBox = findChild(moovData, chosen.stbl, "stsz");
    const stz2Box = findChild(moovData, chosen.stbl, "stz2");
    const stscBox = findChild(moovData, chosen.stbl, "stsc");
    const stcoBox = findChild(moovData, chosen.stbl, "stco");
    const co64Box = findChild(moovData, chosen.stbl, "co64");
    const offsetsBox = stcoBox ?? co64Box;
    if (stz2Box) throw new Mp4SplitError("Compact sample sizes are not supported.");
    if (!mdhdBox || !tkhdBox || !hdlrBox || !smhdBox || !dinfBox || !stsdBox || (!fragmented && (!sttsBox || !stszBox || !stscBox || !offsetsBox))) throw new Mp4SplitError();
    const mdhd = copyBox(moovData, mdhdBox);
    const mdhdVersion = mdhd[8]!;
    if (mdhdVersion !== 0 && mdhdVersion !== 1) throw new Mp4SplitError();
    const timescale = u32(mdhd, mdhdVersion === 1 ? 28 : 20);
    if (timescale === 0) throw new Mp4SplitError();
    const mdhdDuration = mdhdVersion === 1 ? u64(mdhd, 32) : u32(mdhd, 24);
    if (mdhdDuration === 0 && !fragmented) throw new Mp4SplitError();
    let sampleCount: number;
    let sizes: Uint32Array;
    let durations: Uint32Array;
    let sampleOffsets: Float64Array;
    if (fragmented) {
      if (stszBox && (stszBox.payloadStart + 12 > stszBox.end || u32(moovData, stszBox.payloadStart + 8) !== 0))
        throw new Mp4SplitError("Unsupported fragmented MP4: mixed non-fragmented audio samples.");
      const tkhd = copyBox(moovData, tkhdBox);
      const trackVersion = tkhd[8];
      if (trackVersion !== 0 && trackVersion !== 1) throw new Mp4SplitError();
      const trackId = u32(tkhd, trackVersion === 1 ? 28 : 20);
      let samples;
      try { samples = await readFragmentSamples(source, top, moovData, root, trackId); }
      catch (error) { throw new Mp4SplitError(error instanceof Error && error.message.startsWith("Unsupported fragmented MP4:") ? error.message : "Unable to parse fragmented MP4 audio."); }
      sampleOffsets = samples.offsets;
      sizes = samples.sizes;
      durations = samples.durations;
      sampleCount = sizes.length;
    } else {
      if (stszBox!.payloadStart + 12 > stszBox!.end) throw new Mp4SplitError();
      sampleCount = u32(moovData, stszBox!.payloadStart + 8);
      const fixedSize = u32(moovData, stszBox!.payloadStart + 4);
      if (sampleCount === 0 || sampleCount > source.size) throw new Mp4SplitError();
      sizes = new Uint32Array(sampleCount);
      if (fixedSize !== 0) sizes.fill(fixedSize);
      else {
        if (stszBox!.end - (stszBox!.payloadStart + 12) !== sampleCount * 4) throw new Mp4SplitError();
        for (let index = 0; index < sampleCount; index += 1) sizes[index] = u32(moovData, stszBox!.payloadStart + 12 + index * 4);
      }

      durations = new Uint32Array(sampleCount);
      const sttsCount = checkedBoxCount(moovData, sttsBox!, 8);
      let sampleCursor = 0;
      for (let index = 0; index < sttsCount; index += 1) {
        const at = sttsBox!.payloadStart + 8 + index * 8;
        const count = u32(moovData, at);
        const delta = u32(moovData, at + 4);
        if (count === 0 || delta === 0 || sampleCursor + count > sampleCount) throw new Mp4SplitError();
        durations.fill(delta, sampleCursor, sampleCursor + count);
        sampleCursor += count;
      }
      if (sampleCursor !== sampleCount) throw new Mp4SplitError();

      const chunkCount = checkedBoxCount(moovData, offsetsBox!, offsetsBox!.type === "co64" ? 8 : 4);
      const stscCount = checkedBoxCount(moovData, stscBox!, 12);
      if (chunkCount === 0 || stscCount === 0 || u32(moovData, stscBox!.payloadStart + 8) !== 1) throw new Mp4SplitError();
      const chunkOffsets = new Float64Array(chunkCount);
      for (let index = 0; index < chunkCount; index += 1) {
        chunkOffsets[index] = offsetsBox!.type === "co64" ? u64(moovData, offsetsBox!.payloadStart + 8 + index * 8) : u32(moovData, offsetsBox!.payloadStart + 8 + index * 4);
      }
      sampleOffsets = new Float64Array(sampleCount);
      let sampleIndex = 0;
      let stscEntry = 0;
      let previousFirstChunk = 0;
      for (let index = 0; index < stscCount; index += 1) {
        const firstChunk = u32(moovData, stscBox!.payloadStart + 8 + index * 12);
        const perChunk = u32(moovData, stscBox!.payloadStart + 12 + index * 12);
        const description = u32(moovData, stscBox!.payloadStart + 16 + index * 12);
        if (firstChunk <= previousFirstChunk || firstChunk > chunkCount || perChunk === 0 || description !== 1) throw new Mp4SplitError();
        previousFirstChunk = firstChunk;
      }
      for (let chunk = 1; chunk <= chunkCount; chunk += 1) {
        while (stscEntry + 1 < stscCount && u32(moovData, stscBox!.payloadStart + 8 + (stscEntry + 1) * 12) <= chunk) stscEntry += 1;
        let byteAt = chunkOffsets[chunk - 1]!;
        const perChunk = u32(moovData, stscBox!.payloadStart + 12 + stscEntry * 12);
        for (let inChunk = 0; inChunk < perChunk; inChunk += 1) {
          if (sampleIndex >= sampleCount) throw new Mp4SplitError();
          sampleOffsets[sampleIndex] = byteAt;
          byteAt += sizes[sampleIndex]!;
          sampleIndex += 1;
        }
      }
      if (sampleIndex !== sampleCount) throw new Mp4SplitError();
      const mdatRanges = top.filter((box) => box.type === "mdat")
        .map((box) => ({ start: box.offset + box.headerSize, end: box.offset + box.size }))
        .sort((left, right) => left.start - right.start);
      for (let index = 0; index < sampleCount; index += 1) {
        const sampleStart = sampleOffsets[index]!;
        const sampleEnd = sampleStart + sizes[index]!;
        let low = 0;
        let high = mdatRanges.length;
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2);
          if (mdatRanges[middle]!.start <= sampleStart) low = middle + 1;
          else high = middle;
        }
        const range = mdatRanges[low - 1];
        if (sampleEnd > source.size || !range || sampleEnd > range.end) throw new Mp4SplitError();
      }
    }

    if (stsdBox.payloadStart + 8 > stsdBox.end || u32(moovData, stsdBox.payloadStart + 4) < 1) throw new Mp4SplitError();
    const firstEntry = boxAt(moovData, stsdBox.payloadStart + 8, stsdBox.end);
    if (!firstEntry || firstEntry.end > stsdBox.end) throw new Mp4SplitError();
    const codec = firstEntry.type;
    if (fragmented && codec === "enca") throw new Mp4SplitError("Unsupported fragmented MP4: encrypted audio is not supported.");
    const sampleRate = codec === "mp4a" && firstEntry.end - firstEntry.payloadStart >= 28 ? u32(moovData, firstEntry.payloadStart + 24) >>> 16 : timescale;
    const warnings: string[] = [];
    if (codec !== "mp4a") warnings.push(`Codec ${codec} was not verified`);
    const elst = findChild(moovData, findChild(moovData, chosen.track, "edts"), "elst");
    if (elst && elst.payloadStart + 8 <= elst.end) {
      const version = moovData[elst.payloadStart]!;
      const entries = u32(moovData, elst.payloadStart + 4);
      const entrySize = version === 1 ? 20 : 12;
      if (fragmented && (version > 1 || entries > 1 || (entries > 0 && elst.payloadStart + 8 + entrySize > elst.end)))
        throw new Mp4SplitError("Unsupported fragmented MP4: complex edit list.");
      if (entries > 0 && elst.payloadStart + 8 + entrySize <= elst.end) {
        const mediaTimeAt = elst.payloadStart + 12 + (version === 1 ? 4 : 0);
        const view = new DataView(moovData.buffer, moovData.byteOffset, moovData.byteLength);
        const mediaTime = version === 1 ? Number(view.getBigInt64(mediaTimeAt)) : i32(moovData, mediaTimeAt);
        if (fragmented && mediaTime !== 0) throw new Mp4SplitError("Unsupported fragmented MP4: edited audio timeline.");
        if (mediaTime !== 0 && !(mediaTime > 0 && mediaTime <= 2112)) warnings.push("The first edit-list entry uses an unusual media_time.");
      }
    }

    const starts = new Float64Array(sampleCount + 1);
    const bytePrefix = new Float64Array(sampleCount + 1);
    for (let index = 0; index < sampleCount; index += 1) {
      starts[index + 1] = starts[index]! + durations[index]!;
      bytePrefix[index + 1] = bytePrefix[index]! + sizes[index]!;
    }
    const chunks: Mp4ChunkPlan[] = [];
    let own = 0;
    let reducedLead = false;
    while (own < sampleCount) {
      let lead = own;
      while (lead > 0 && (own - lead < 2 || starts[own]! - starts[lead]! < minLead * timescale)) lead -= 1;
      while (lead < own && 4096 + (own + 1 - lead) * 12 + bytePrefix[own + 1]! - bytePrefix[lead]! > options.maxBytes) { lead += 1; reducedLead = true; }
      if (4096 + (own + 1 - lead) * 12 + bytePrefix[own + 1]! - bytePrefix[lead]! > options.maxBytes)
        throw new Mp4SplitError("An audio sample is too large to fit within the chunk size limit.");
      let end = own + 1;
      while (end < sampleCount && starts[end]! - starts[own]! < options.targetSeconds * timescale && 4096 + (end + 1 - lead) * 12 + bytePrefix[end + 1]! - bytePrefix[lead]! <= options.maxBytes) end += 1;
      chunks.push({
        index: chunks.length,
        leadInSampleCount: own - lead,
        ownSampleStart: own,
        ownSampleEnd: end,
        ownStartSeconds: starts[own]! / timescale,
        ownDurationSeconds: (starts[end]! - starts[own]!) / timescale,
        leadInSeconds: (starts[own]! - starts[lead]!) / timescale,
        estimatedBytes: 4096 + (end - lead) * 12 + bytePrefix[end]! - bytePrefix[lead]!,
      });
      own = end;
    }
    if (reducedLead) warnings.push("Reduced lead-in on one or more chunks to fit maxBytes.");
    const plan: Mp4SplitPlan = { chunks, totalSeconds: starts[sampleCount]! / timescale, sampleRate, timescale, codec, warnings };
    parsedPlans.set(plan, {
      offsets: sampleOffsets, sizes, durations, starts, stsdBox: copyBox(moovData, stsdBox), mdhd,
      hdlr: copyBox(moovData, hdlrBox), tkhd: copyBox(moovData, tkhdBox), mvhd,
      smhd: copyBox(moovData, smhdBox), dinf: copyBox(moovData, dinfBox),
      timescale, sampleRate, sourceSize: source.size, maxBytes: options.maxBytes, movieTimescale,
    });
    return plan;
  } catch (error) {
    if (error instanceof Mp4SplitError) throw error;
    throw new Mp4SplitError();
  }
}
// Chunk bounds are checked before indexing the plan's sample arrays.

export async function readMp4Chunk(source: Blob, plan: Mp4SplitPlan, index: number): Promise<Blob> {
  const parsed = parsedPlans.get(plan);
  const chunk = plan.chunks[index];
  if (!parsed || !chunk || chunk.index !== index || parsed.sourceSize !== source.size) throw new Mp4SplitError();
  const start = chunk.ownSampleStart - chunk.leadInSampleCount;
  const end = chunk.ownSampleEnd;
  if (start < 0 || end <= start || end > parsed.sizes.length) throw new Mp4SplitError();
  let payloadLength = 0;
  for (let sample = start; sample < end; sample += 1) payloadLength += parsed.sizes[sample]!;
  const payload = new Uint8Array(payloadLength);
  let payloadOffset = 0;
  let runStart = parsed.offsets[start]!;
  let runEnd = runStart + parsed.sizes[start]!;
  for (let sample = start + 1; sample <= end; sample += 1) {
    const nextStart = sample < end ? parsed.offsets[sample]! : Number.NaN;
    if (sample < end && nextStart === runEnd) runEnd += parsed.sizes[sample]!;
    else {
      const run = new Uint8Array(await source.slice(runStart, runEnd).arrayBuffer());
      payload.set(run, payloadOffset);
      payloadOffset += run.length;
      if (sample < end) {
        runStart = nextStart;
        runEnd = nextStart + parsed.sizes[sample]!;
      }
    }
  }
  const ftyp = makeBox("ftyp", new Uint8Array([105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 105, 115, 111, 50, 109, 112, 52, 49, 77, 52, 65, 32]));
  const stts = encodeStts(parsed.durations, start, end);
  const stszPayload = new Uint8Array(12 + (end - start) * 4);
  const stszView = new DataView(stszPayload.buffer);
  stszView.setUint32(8, end - start);
  for (let sample = start; sample < end; sample += 1) stszView.setUint32(12 + (sample - start) * 4, parsed.sizes[sample]!);
  const stsc = makeBox("stsc", uint32(0, 1, 1, end - start, 1));
  const duration = parsed.starts[end]! - parsed.starts[start]!;
  const mdhd = patchDuration(parsed.mdhd, duration, "mdhd");
  const movieDuration = Math.round(duration * parsed.movieTimescale / parsed.timescale);
  const tkhd = patchTrack(patchDuration(parsed.tkhd, movieDuration, "tkhd"));
  const mvhd = patchNextTrack(patchDuration(parsed.mvhd, movieDuration, "mvhd"));
  const makeMoov = (chunkOffset: number): Uint8Array<ArrayBuffer> => {
    let offsetBox: Uint8Array;
    if (chunkOffset > 0xffffffff) {
      const payloadBytes = new Uint8Array(16);
      const view = new DataView(payloadBytes.buffer);
      view.setUint32(4, 1);
      view.setBigUint64(8, BigInt(chunkOffset));
      offsetBox = makeBox("co64", payloadBytes);
    } else offsetBox = makeBox("stco", uint32(0, 1, chunkOffset));
    const stbl = makeBox("stbl", joinBytes([parsed.stsdBox, stts, stsc, makeBox("stsz", stszPayload), offsetBox]));
    const minf = makeBox("minf", joinBytes([parsed.smhd, parsed.dinf, stbl]));
    const mdia = makeBox("mdia", joinBytes([mdhd, parsed.hdlr, minf]));
    return makeBox("moov", joinBytes([mvhd, makeBox("trak", joinBytes([tkhd, mdia]))]));
  };
  const moov = makeMoov(0);
  const mdatHeader = new Uint8Array(8);
  const mdatView = new DataView(mdatHeader.buffer);
  mdatView.setUint32(0, payload.length + mdatHeader.length);
  mdatHeader.set([109, 100, 97, 116], 4);
  const fixedMoov = makeMoov(ftyp.length + moov.length + mdatHeader.length);
  if (ftyp.length + fixedMoov.length + mdatHeader.length + payload.length > parsed.maxBytes)
    throw new Mp4SplitError("The generated audio chunk exceeds the size limit.");
  return new Blob([ftyp, fixedMoov, mdatHeader, payload], { type: "audio/mp4" });
}

function uint32(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) view.setUint32(index * 4, values[index]!);
  return bytes;
}

function encodeStts(durations: Uint32Array, start: number, end: number): Uint8Array {
  const runs: number[] = [];
  for (let index = start; index < end;) {
    const duration = durations[index]!;
    let count = 1;
    while (index + count < end && durations[index + count] === duration) count += 1;
    runs.push(count, duration);
    index += count;
  }
  const payload = new Uint8Array(8 + runs.length * 4);
  const view = new DataView(payload.buffer);
  view.setUint32(4, runs.length / 2);
  for (let index = 0; index < runs.length; index += 1) view.setUint32(8 + index * 4, runs[index]!);
  return makeBox("stts", payload);
}

function patchDuration(box: Uint8Array, duration: number, kind: "mvhd" | "tkhd" | "mdhd"): Uint8Array {
  const output = box.slice();
  const version = output[8]!;
  const offset = kind === "tkhd" ? (version === 1 ? 36 : 28) : (version === 1 ? 32 : 24);
  const view = new DataView(output.buffer);
  if (version === 1) view.setBigUint64(offset, BigInt(duration));
  else view.setUint32(offset, duration);
  return output;
}

function patchTrack(durationPatched: Uint8Array): Uint8Array {
  const output = durationPatched.slice();
  new DataView(output.buffer).setUint32(output[8] === 1 ? 28 : 20, 1);
  output[11] = (output[11] ?? 0) | 0x03;
  return output;
}

function patchNextTrack(box: Uint8Array): Uint8Array {
  const output = box.slice();
  new DataView(output.buffer).setUint32(output.length - 4, 2);
  return output;
}
