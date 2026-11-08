export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError("WAV sample rate must be a positive integer.");
  }
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function mixToMono(channels: readonly Float32Array[], start: number, length: number): Float32Array {
  const output = new Float32Array(length);
  if (channels.length === 0) return output;
  for (const channel of channels) {
    for (let index = 0; index < length; index++) output[index] += channel[start + index] ?? 0;
  }
  const scale = 1 / channels.length;
  for (let index = 0; index < length; index++) output[index] *= scale;
  return output;
}
