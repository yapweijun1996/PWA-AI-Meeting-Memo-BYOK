import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { analyzeExistingMeetingAcoustics, describeAcousticState } from "../src/jobs/acoustic-continuity";
import { createMeeting, segment, validateMeeting } from "../src/domain/model";
import { replaceTranscript, undoEdit } from "../src/domain/operations";
import { saveMeeting, deleteMeeting, db } from "../src/storage/repository";
import { storeLongAudio } from "../src/storage/long-audio-store";
import { listAcousticIdentities } from "../src/storage/acoustic-store";
import type { BrowserSpeakerEmbeddingProvider } from "../src/audio/speaker-embedding";

vi.stubGlobal("window", new EventTarget());

function unit(angleDegrees: number): number[] {
  const radians = (angleDegrees * Math.PI) / 180;
  const values = Array.from({ length: 512 }, () => 0);
  values[0] = Math.cos(radians);
  values[1] = Math.sin(radians);
  return values;
}

function mp3Frames(count: number): ArrayBuffer {
  const frameLength = Math.floor(144 * 128_000 / 44_100);
  const bytes = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index += 1) {
    bytes.subarray(index * frameLength, (index + 1) * frameLength).set([0xff, 0xfb, 9 << 4, 0]);
  }
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

class FakeAudioContext {
  async decodeAudioData(): Promise<AudioBuffer> {
    const length = 44_100 * 30;
    return { sampleRate: 44_100, length, numberOfChannels: 1, getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }
  async close(): Promise<void> { return undefined; }
}

describe("labels split inside one recording part", () => {
  it("groups two same-voice labels in a part and still links them to the next part", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const meetingId = "00000000-0000-4000-8000-000000000031";
    const encoded = mp3Frames(3_000);
    const manifest = await storeLongAudio({
      meetingId,
      format: "mp3",
      mimeType: "audio/mpeg",
      totalSeconds: 40,
      sampleRate: 44_100,
      chunks: [
        { meta: { index: 0, ownStartSeconds: 0, ownDurationSeconds: 20, leadInSeconds: 0 }, read: async () => new Blob([encoded], { type: "audio/mpeg" }) },
        { meta: { index: 1, ownStartSeconds: 20, ownDurationSeconds: 20, leadInSeconds: 0 }, read: async () => new Blob([encoded], { type: "audio/mpeg" }) },
      ],
    });
    const ids = ["part-0:A", "part-0:B", "part-0:C", "part-1:D", "part-1:E"];
    const speakers = ids.map((id, index) => ({ id, name: `Speaker ${index + 1}`, confirmed: false, sourceLabels: [] }));
    const segments = [
      segment("part zero one", ["part-0:A"], 0, 6),
      segment("part zero two", ["part-0:B"], 6, 12),
      segment("part zero three", ["part-0:C"], 12, 18),
      segment("part one one", ["part-1:D"], 20, 26),
      segment("part one two", ["part-1:E"], 26, 32),
    ];
    const initial = validateMeeting({
      ...createMeeting(),
      id: meetingId,
      speakers,
      segments,
      audio: {
        name: "long.mp3",
        type: "audio/mpeg",
        size: encoded.byteLength * 2,
        duration: manifest.totalSeconds,
        hash: manifest.manifestSha256,
        present: true,
        chunked: { format: "mp3", chunkCount: 2, totalSeconds: manifest.totalSeconds, manifestSha256: manifest.manifestSha256 },
      },
    });
    const saved = await saveMeeting(replaceTranscript(initial, speakers, segments, "OpenRouter", "scribe", { originalSpeakers: speakers, originalSegments: segments }));
    // Embedding order: part 0 -> A A B B C C, part 1 -> D D E E.
    const vectors = [0, 2, 1, 3, 90, 92, 2, 4, 91, 93].map(unit);
    let call = 0;
    const provider: BrowserSpeakerEmbeddingProvider = {
      async load() { return undefined; },
      async embed() { return vectors[call++] ?? unit(0); },
      dispose() { return undefined; },
    };

    const analyzed = await analyzeExistingMeetingAcoustics(saved, { manifest, provider, consent: true });

    const speakerOf = (text: string) => analyzed.segments.find((s) => s.text === text)?.speakerIds[0];
    expect(speakerOf("part zero one")).toBe(speakerOf("part zero two"));
    expect(speakerOf("part zero one")).toBe(speakerOf("part one one"));
    expect(speakerOf("part zero three")).toBe(speakerOf("part one two"));
    expect(speakerOf("part zero one")).not.toBe(speakerOf("part zero three"));
    expect(analyzed.segments.map((s) => s.text)).toEqual(segments.map((s) => s.text));
    expect((await listAcousticIdentities(meetingId)).length).toBe(2);
    const state = await describeAcousticState(meetingId);
    expect(state.byState.matched + state.byState.new_identity).toBe(5);
    expect(state.voices).toBe(2);
    // Every label has a near-identical label in the other part.
    expect(state.crossPart.labels).toBe(5);
    expect(state.crossPart.strong).toBe(5);
    expect(state.samples).toBe(10);
    expect(state.pairs.sameLabel.median).toBeGreaterThan(0.99);
    expect(state.pairs.otherLabelSamePart.count).toBeGreaterThan(0);
    expect(undoEdit(analyzed).segments.map((s) => s.speakerIds)).toEqual(segments.map((s) => s.speakerIds));
    await deleteMeeting(meetingId);
    (await db()).close();
  });
});
