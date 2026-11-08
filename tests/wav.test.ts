import { describe, expect, it } from "vitest";
import { encodePcm16Wav, mixToMono } from "../src/audio/wav";

describe("PCM WAV encoder", () => {
  it("writes a mono PCM header and exact sample count", async () => {
    const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5]), 16000);
    const bytes = await wav.arrayBuffer();
    const view = new DataView(bytes);
    expect(wav.type).toBe("audio/wav");
    expect(view.getUint32(4, true)).toBe(42);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(-16384);
  });

  it("clips values and averages stereo channels to mono", async () => {
    const mono = mixToMono([new Float32Array([2, -1]), new Float32Array([0, 1])], 0, 2);
    expect([...mono]).toEqual([1, 0]);
    const view = new DataView(await encodePcm16Wav(new Float32Array([-2, 2]), 8000).arrayBuffer());
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
  });
});
