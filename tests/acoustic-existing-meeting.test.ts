import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { analyzeExistingMeetingAcoustics } from "../src/jobs/acoustic-continuity";
import { createMeeting, segment, validateMeeting } from "../src/domain/model";
import { replaceTranscript, undoEdit } from "../src/domain/operations";
import { getMeeting, saveMeeting, deleteMeeting, db } from "../src/storage/repository";
import { storeLongAudio } from "../src/storage/long-audio-store";
import type { BrowserSpeakerEmbeddingProvider } from "../src/audio/speaker-embedding";

vi.stubGlobal("window", new EventTarget());

function mp3Frames(count: number): ArrayBuffer {
  const frameLength = Math.floor(144 * 128_000 / 44_100);
  const bytes = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index += 1) {
    const frame = bytes.subarray(index * frameLength, (index + 1) * frameLength);
    frame.set([0xff, 0xfb, 9 << 4, 0]);
  }
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

class FakeAudioContext {
  static decodedByteLengths: number[] = [];
  async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> {
    FakeAudioContext.decodedByteLengths.push(input.byteLength);
    const length = 44_100 * 30;
    return {
      sampleRate: 44_100,
      length,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;
  }
  async close(): Promise<void> { return undefined; }
}

const provider: BrowserSpeakerEmbeddingProvider = {
  async load() { return undefined; },
  async embed() {
    const values = Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0);
    return values;
  },
  dispose() { return undefined; },
};

describe("existing meeting local acoustic analysis", () => {
  it("groups old part-N run speakers locally, saves with CAS, preserves text and supports undo", async () => {
    FakeAudioContext.decodedByteLengths = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const meetingId = "00000000-0000-4000-8000-000000000011";
    const encoded = mp3Frames(3_000);
    const manifest = await storeLongAudio({
      meetingId,
      format: "mp3",
      mimeType: "audio/mpeg",
      totalSeconds: 20,
      sampleRate: 44_100,
      chunks: [
        { meta: { index: 0, ownStartSeconds: 0, ownDurationSeconds: 10, leadInSeconds: 0 }, read: async () => new Blob([encoded], { type: "audio/mpeg" }) },
        { meta: { index: 1, ownStartSeconds: 10, ownDurationSeconds: 10, leadInSeconds: 0 }, read: async () => new Blob([encoded], { type: "audio/mpeg" }) },
      ],
    });
    const sourceSegments = [
      segment("edited text survives", ["part-0:A"], 1, 9),
      segment("second part", ["part-1:A"], 11, 19),
    ];
    const speakers = [
      { id: "part-0:A", name: "Speaker 1", confirmed: false, sourceLabels: [] },
      { id: "part-1:A", name: "Speaker 1", confirmed: false, sourceLabels: [] },
    ];
    const initial = validateMeeting({
      ...createMeeting(),
      id: meetingId,
      speakers,
      segments: sourceSegments,
      audio: {
        name: "old.mp3",
        type: "audio/mpeg",
        size: encoded.byteLength * 2,
        duration: manifest.totalSeconds,
        hash: manifest.manifestSha256,
        present: true,
        chunked: {
          format: "mp3",
          chunkCount: manifest.chunks.length,
          totalSeconds: manifest.totalSeconds,
          manifestSha256: manifest.manifestSha256,
        },
      },
    });
    const withRun = replaceTranscript(initial, speakers, sourceSegments, "OpenRouter", "scribe", {
      originalSpeakers: speakers,
      originalSegments: sourceSegments,
    });
    const saved = await saveMeeting(withRun);
    const analyzed = await analyzeExistingMeetingAcoustics(saved, {
      manifest,
      provider,
      consent: true,
      signal: undefined,
    });
    expect(analyzed.segments.map((value) => value.text)).toEqual(sourceSegments.map((value) => value.text));
    expect(analyzed.segments[0]?.speakerIds).toEqual(analyzed.segments[1]?.speakerIds);
    expect(analyzed.segments[0]?.revision).toBe(2);
    expect(analyzed.undo).toHaveLength(2);
    expect(analyzed.runs).toHaveLength(1);
    expect(analyzed.runs[0]?.originalSegments.map((value) => value.text)).toEqual(sourceSegments.map((value) => value.text));
    const persisted = await saveMeeting(analyzed);
    const reloaded = await getMeeting(meetingId);
    expect(reloaded?.segments[0]?.speakerIds).toEqual(persisted.segments[0]?.speakerIds);
    expect(undoEdit(persisted).segments.map((value) => value.speakerIds)).toEqual(sourceSegments.map((value) => value.speakerIds));
    expect(FakeAudioContext.decodedByteLengths.every((value) => value < encoded.byteLength * 0.9)).toBe(true);
    await deleteMeeting(meetingId);
    (await db()).close();
  });
});
