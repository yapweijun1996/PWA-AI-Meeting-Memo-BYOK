export interface IsoBox {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
  headerSize: number;
}

export function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset);
}

export function i32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset);
}

export function u64(data: Uint8Array, offset: number): number {
  const value = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Box size exceeds safe integer range.");
  return Number(value);
}

export function boxAt(data: Uint8Array, start: number, parentEnd = data.length): IsoBox | null {
  if (start + 8 > parentEnd || start + 8 > data.length) return null;
  const size32 = u32(data, start);
  const type = String.fromCharCode(data[start + 4]!, data[start + 5]!, data[start + 6]!, data[start + 7]!);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (start + 16 > parentEnd || start + 16 > data.length) return null;
    size = u64(data, start + 8);
    headerSize = 16;
  } else if (size32 === 0) size = parentEnd - start;
  if (size < headerSize || start + size > parentEnd || start + size > data.length) return null;
  return { type, start, payloadStart: start + headerSize, end: start + size, headerSize };
}

export function boxes(data: Uint8Array, start: number, end: number): IsoBox[] {
  const result: IsoBox[] = [];
  let cursor = start;
  while (cursor < end) {
    const box = boxAt(data, cursor, end);
    if (box === null || box.end <= cursor) throw new RangeError("Invalid ISO BMFF box.");
    result.push(box);
    cursor = box.end;
  }
  return result;
}

export function makeBox(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const size = payload.length + 8;
  if (size > 0xffffffff) throw new RangeError("ISO BMFF box is too large.");
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  view.setUint32(0, size);
  for (let i = 0; i < 4; i += 1) result[4 + i] = type.charCodeAt(i);
  result.set(payload, 8);
  return result;
}

export function joinBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
