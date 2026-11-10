import { describe, expect, it } from "vitest";
import { decodeAcousticWindow } from "../src/audio/acoustic-audio";

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
