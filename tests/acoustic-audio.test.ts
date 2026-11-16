import { describe, expect, it } from "vitest";
import { decodeAcousticWindow, isUsableAcousticWindow, resampleBandLimited } from "../src/audio/acoustic-audio";

function makeMp3Frame(): Uint8Array {
  const length = Math.floor(144 * 128_000 / 44_100);
  const frame = new Uint8Array(length);
  frame.set([0xff, 0xfb, 9 << 4, 0]);
  return frame;
}

function frameStream(count: number): Uint8Array {
  const frame = makeMp3Frame();
  const output = new Uint8Array(frame.length * count);
  for (let index = 0; index < count; index += 1) output.set(frame, index * frame.length);
  return output;
}

describe("bounded acoustic decoding", () => {
  it("extracts a short MP3 container window before decoding a long part", async () => {
    const bytes = frameStream(3_000);
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    let decodedBytes = 0;
    const decodedLength = 44_100 * 30;
    const pcm = await decodeAcousticWindow(input, {
      index: 0,
      ownStartSeconds: 0,
      ownDurationSeconds: 3_000 * 1_152 / 44_100,
      leadInSeconds: 0,
    }, {
      id: "sample",
      chunkIndex: 0,
      sourceSpeakerId: "speaker",
      startSeconds: 65,
      endSeconds: 69,
      segmentIds: ["segment"],
    }, {
      format: "mp3",
      createContext: () => ({
        decodeAudioData: async (input: ArrayBuffer) => {
          decodedBytes = input.byteLength;
          return {
            sampleRate: 44_100,
            length: decodedLength,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(decodedLength),
          } as unknown as AudioBuffer;
        },
        close: async () => undefined,
      } as unknown as AudioContext),
    });
    expect(pcm.length).toBeGreaterThan(0);
    expect(decodedBytes).toBeGreaterThan(0);
    expect(decodedBytes).toBeLessThan(bytes.byteLength / 2);
  });
});

function tone(frequency: number, rate: number, seconds: number, amplitude = 0.5): Float32Array {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, index) => amplitude * Math.sin((2 * Math.PI * frequency * index) / rate));
}
function rms(samples: Float32Array, skip = 0): number {
  let energy = 0;
  for (let index = skip; index < samples.length - skip; index += 1) energy += samples[index]! * samples[index]!;
  return Math.sqrt(energy / (samples.length - 2 * skip));
}

describe("band-limited conversion to 16 kHz", () => {
  it("keeps speech-band content at its level", () => {
    for (const rate of [44_100, 48_000]) {
      const output = resampleBandLimited(tone(1_000, rate, 1), rate, 16_000);
      expect(output.length).toBe(16_000);
      // A 0.5-amplitude sine has RMS 0.354.
      expect(rms(output, 200)).toBeGreaterThan(0.35);
      expect(rms(output, 200)).toBeLessThan(0.358);
    }
  });

  it("removes content above the new Nyquist frequency instead of folding it into the speech band", () => {
    // 10 kHz cannot exist at 16 kHz. Linear interpolation would fold most of it back to 6 kHz.
    for (const rate of [44_100, 48_000]) {
      expect(rms(resampleBandLimited(tone(10_000, rate, 1), rate, 16_000), 200)).toBeLessThan(0.005);
    }
  });

  it("gives nearly the same signal from 44.1 kHz and 48 kHz sources", () => {
    const mix = (rate: number) => {
      const low = tone(300, rate, 1, 0.3);
      const mid = tone(2_500, rate, 1, 0.2);
      const high = tone(11_000, rate, 1, 0.2);
      return low.map((value, index) => value + mid[index]! + high[index]!);
    };
    const a = resampleBandLimited(mix(44_100), 44_100, 16_000);
    const b = resampleBandLimited(mix(48_000), 48_000, 16_000);
    let dot = 0, aa = 0, bb = 0;
    for (let index = 200; index < 15_800; index += 1) { dot += a[index]! * b[index]!; aa += a[index]! ** 2; bb += b[index]! ** 2; }
    expect(dot / Math.sqrt(aa * bb)).toBeGreaterThan(0.999);
  });

  it("returns the input unchanged when the rate already matches", () => {
    const input = tone(440, 16_000, 0.1);
    expect(resampleBandLimited(input, 16_000, 16_000)).toBe(input);
  });
});

describe("usable voice window", () => {
  it("accepts ordinary speech levels and rejects silence, clipping and invalid audio", () => {
    expect(isUsableAcousticWindow(tone(200, 16_000, 2, 0.05))).toBe(true);
    expect(isUsableAcousticWindow(new Float32Array(32_000))).toBe(false);
    expect(isUsableAcousticWindow(tone(200, 16_000, 2, 0.001))).toBe(false);
    expect(isUsableAcousticWindow(new Float32Array(32_000).fill(1))).toBe(false);
    expect(isUsableAcousticWindow(new Float32Array(0))).toBe(false);
    expect(isUsableAcousticWindow(Float32Array.from([0.1, Number.NaN]))).toBe(false);
  });
});
