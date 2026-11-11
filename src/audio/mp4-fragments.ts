import { boxAt, boxes, i32, u32, u64, type IsoBox } from "./iso-bmff";

interface TopBox { type: string; offset: number; size: number; headerSize: number }
interface FragmentSamples { offsets: Float64Array; sizes: Uint32Array; durations: Uint32Array }

/** Read fragmented sample tables without reading media payloads. Unsupported layouts fail closed. */
export async function readFragmentSamples(source: Blob, top: TopBox[], moov: Uint8Array, root: IsoBox, trackId: number): Promise<FragmentSamples> {
  const fail = (reason: string): never => { throw new Error(`Unsupported fragmented MP4: ${reason}`); };
  const child = (data: Uint8Array, parent: IsoBox, name: string) => boxes(data, parent.payloadStart, parent.end).find(box => box.type === name);
  const mvex = child(moov, root, "mvex");
  if (!mvex) return fail("missing fragment defaults.");
  const trex = boxes(moov, mvex.payloadStart, mvex.end).find(box => box.type === "trex" && box.payloadStart + 24 <= box.end && u32(moov, box.payloadStart + 4) === trackId);
  if (!trex) return fail("missing audio track defaults.");
  const defaultDescription = u32(moov, trex.payloadStart + 8);
  const trexDuration = u32(moov, trex.payloadStart + 12);
  const trexSize = u32(moov, trex.payloadStart + 16);
  if (defaultDescription !== 1) return fail("multiple audio sample descriptions.");
  const ranges = top.filter(box => box.type === "mdat").map(box => ({ start: box.offset + box.headerSize, end: box.offset + box.size }));
  const containsSample = (start: number, end: number) => {
    let low = 0, high = ranges.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (ranges[middle]!.start <= start) low = middle + 1;
      else high = middle;
    }
    const range = ranges[low - 1];
    return !!range && end <= range.end;
  };
  const offsets: number[] = [], sizes: number[] = [], durations: number[] = [];
  let expectedTime = 0;
  let seen = false;
  for (const fragment of top.filter(box => box.type === "moof")) {
    if (fragment.size > 16 * 1024 * 1024) return fail("fragment metadata is too large.");
    const data = new Uint8Array(await source.slice(fragment.offset, fragment.offset + fragment.size).arrayBuffer());
    const rootBox = boxAt(data, 0);
    if (!rootBox || rootBox.end !== data.length) return fail("invalid fragment metadata.");
    for (const traf of boxes(data, rootBox.payloadStart, rootBox.end).filter(box => box.type === "traf")) {
      const entries = boxes(data, traf.payloadStart, traf.end);
      const tfhd = entries.find(box => box.type === "tfhd");
      if (!tfhd || tfhd.payloadStart + 8 > tfhd.end) return fail("missing track header.");
      if (u32(data, tfhd.payloadStart + 4) !== trackId) continue;
      if (entries.some(box => ["senc", "saiz", "saio"].includes(box.type))) return fail("encrypted audio is not supported.");
      const flags = u32(data, tfhd.payloadStart) & 0xffffff;
      if (flags & 0x010000) return fail("empty audio fragments are not supported.");
      let at = tfhd.payloadStart + 8;
      const read32 = () => { if (at + 4 > tfhd.end) return fail("invalid track header."); const value = u32(data, at); at += 4; return value; };
      let base = fragment.offset;
      if (flags & 1) { if (at + 8 > tfhd.end) return fail("invalid base offset."); base = u64(data, at); at += 8; }
      else if (!(flags & 0x020000)) return fail("implicit track base offset.");
      const description = flags & 2 ? read32() : defaultDescription;
      const defaultDuration = flags & 8 ? read32() : trexDuration;
      const defaultSize = flags & 16 ? read32() : trexSize;
      if (flags & 32) read32();
      if (description !== 1) return fail("multiple audio sample descriptions.");
      const tfdt = entries.find(box => box.type === "tfdt");
      if (!tfdt || tfdt.payloadStart + 8 > tfdt.end) return fail("missing decode time.");
      const version = data[tfdt.payloadStart];
      if (version !== 0 && version !== 1) return fail("unsupported decode time.");
      if (version === 1 && tfdt.payloadStart + 12 > tfdt.end) return fail("invalid decode time.");
      const start = version === 1 ? u64(data, tfdt.payloadStart + 4) : u32(data, tfdt.payloadStart + 4);
      if (start !== expectedTime) return fail("audio timeline contains gaps, overlaps, or a nonzero start.");
      let runEnd: number | undefined;
      for (const trun of entries.filter(box => box.type === "trun")) {
        if (trun.payloadStart + 8 > trun.end) return fail("invalid sample run.");
        const vf = u32(data, trun.payloadStart), trunFlags = vf & 0xffffff;
        if ((vf >>> 24) > 1) return fail("unsupported sample run version.");
        const count = u32(data, trun.payloadStart + 4);
        if (count > 2_000_000 - offsets.length) return fail("too many audio samples.");
        let pos = trun.payloadStart + 8;
        const next = () => { if (pos + 4 > trun.end) return fail("truncated sample run."); const value = u32(data, pos); pos += 4; return value; };
        let byteAt: number;
        if (trunFlags & 1) { if (pos + 4 > trun.end) return fail("missing sample offset."); byteAt = base + i32(data, pos); pos += 4; }
        else if (runEnd !== undefined) byteAt = runEnd;
        else return fail("missing first sample offset.");
        if (trunFlags & 4) next();
        for (let index = 0; index < count; index++) {
          const duration = trunFlags & 0x100 ? next() : defaultDuration;
          const size = trunFlags & 0x200 ? next() : defaultSize;
          if (trunFlags & 0x400) next();
          if ((trunFlags & 0x800) && next() !== 0) return fail("audio composition offsets are not supported.");
          if (!duration || !size || !Number.isSafeInteger(byteAt) || !Number.isSafeInteger(byteAt + size) || !containsSample(byteAt, byteAt + size)) return fail("sample lies outside media data or has invalid duration.");
          offsets.push(byteAt); sizes.push(size); durations.push(duration);
          byteAt += size; expectedTime += duration;
          if (!Number.isSafeInteger(expectedTime)) return fail("audio duration is too large.");
        }
        if (pos !== trun.end) return fail("unexpected sample run data.");
        runEnd = byteAt;
      }
      seen = true;
    }
  }
  if (!seen || !offsets.length) return fail("no fragmented audio samples found.");
  return { offsets: Float64Array.from(offsets), sizes: Uint32Array.from(sizes), durations: Uint32Array.from(durations) };
}
