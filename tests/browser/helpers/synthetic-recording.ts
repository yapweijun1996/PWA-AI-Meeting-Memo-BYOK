export function wavFile(seconds = 40) {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export function syntheticMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const bytes = Buffer.alloc(63_000 * frame.length);
  for (let offset = 0; offset < bytes.length; offset += frame.length) frame.copy(bytes, offset);
  return bytes;
}
