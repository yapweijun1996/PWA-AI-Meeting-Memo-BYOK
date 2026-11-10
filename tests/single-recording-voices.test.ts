import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { clusterRecordingSources, type AcousticEmbeddingRecord } from "../src/domain/acoustic-speaker";
import { analyzeSingleRecordingVoices, singleRecordingFormat } from "../src/jobs/single-recording-voices";
import { createMeeting, segment, validateMeeting } from "../src/domain/model";
import { replaceTranscript, undoEdit } from "../src/domain/operations";
import { getMeeting, saveMeeting, deleteMeeting, db } from "../src/storage/repository";
import { listAcousticAssignments, listAcousticIdentities } from "../src/storage/acoustic-store";
import type { BrowserSpeakerEmbeddingProvider } from "../src/audio/speaker-embedding";

vi.stubGlobal("window", new EventTarget());

const HASH = "a".repeat(64);
const LABEL_A = "00000000-0000-4000-8000-0000000000a1";
const LABEL_B = "00000000-0000-4000-8000-0000000000b2";
const LABEL_C = "00000000-0000-4000-8000-0000000000c3";
const MODEL = { modelId: "Xenova/wavlm-base-plus-sv", modelRevision: "e61029603001bd11295c36d878698708bf59190f", extractionVersion: "wavlm-sv-uncalibrated-v1" };

function unit(angleDegrees: number): number[] {
  const radians = (angleDegrees * Math.PI) / 180;
  const values = Array.from({ length: 512 }, () => 0);
  values[0] = Math.cos(radians);
  values[1] = Math.sin(radians);
  return values;
}

function record(speaker: string, index: number, values: number[]): AcousticEmbeddingRecord {
  const start = index * 5;
  const id = `sample:0:${speaker}:${start.toFixed(3)}:${(start + 2).toFixed(3)}`;
  return {
    id,
    meetingId: "meeting",
    recordingHash: HASH,
    sourceRevision: 1,
    chunkIndex: 0,
    sourceSpeakerId: speaker,
    sample: { id, chunkIndex: 0, sourceSpeakerId: speaker, startSeconds: start, endSeconds: start + 2, segmentIds: [] },
    ...MODEL,
    values,
    createdAt: new Date().toISOString(),
  };
}

function cluster(embeddings: AcousticEmbeddingRecord[]) {
  return clusterRecordingSources({ meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings });
}

describe("grouping provider labels in one recording", () => {
  it("groups two labels whose voices agree and leaves a different voice alone", () => {
    const result = cluster([
      record("A", 0, unit(0)), record("A", 1, unit(2)),
      record("B", 2, unit(1)), record("B", 3, unit(3)),
      record("C", 4, unit(90)), record("C", 5, unit(92)),
    ]);
    const byLabel = new Map(result.assignments.map((a) => [a.sourceSpeakerId, a]));
    expect(byLabel.get("A")?.identityId).toBeTruthy();
    expect(byLabel.get("A")?.identityId).toBe(byLabel.get("B")?.identityId);
    expect(byLabel.get("C")?.identityId).not.toBe(byLabel.get("A")?.identityId);
    expect(byLabel.get("B")?.state).toBe("matched");
    expect(result.identities).toHaveLength(2);
  });

  it("does not merge labels that are only moderately similar", () => {
    // cos(40 degrees) is about 0.77: above the contradiction floor, below acceptance.
    const result = cluster([
      record("A", 0, unit(0)), record("A", 1, unit(1)),
      record("B", 2, unit(40)), record("B", 3, unit(41)),
    ]);
    const ids = result.assignments.map((a) => a.identityId);
    expect(new Set(ids).size).toBe(2);
  });

  it("refuses an ambiguous chain instead of forcing a merge", () => {
    // A resembles B and C; B and C do not resemble each other.
    const result = cluster([
      record("A", 0, unit(0)), record("A", 1, unit(0)),
      record("B", 2, unit(25)), record("B", 3, unit(25)),
      record("C", 4, unit(-25)), record("C", 5, unit(-25)),
    ]);
    expect(result.assignments.every((a) => a.state === "ambiguous" && a.identityId === null)).toBe(true);
    expect(result.identities).toHaveLength(0);
  });

  it("keeps a label with a single sample unresolved", () => {
    const result = cluster([
      record("A", 0, unit(0)), record("A", 1, unit(1)),
      record("B", 2, unit(0)),
    ]);
    const b = result.assignments.find((a) => a.sourceSpeakerId === "B");
    expect(b?.state).toBe("unresolved");
    expect(b?.identityId).toBeNull();
  });
});

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

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Samples are embedded in time order: A0 A1 B0 B1 C0 C1.
function sequenceProvider(vectors: number[][]): BrowserSpeakerEmbeddingProvider & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() { return state.calls; },
    async load() { return undefined; },
    async embed() { return vectors[state.calls++] ?? unit(0); },
    dispose() { return undefined; },
  };
}

async function singleMp3Meeting(meetingId: string, name = "talk.mp3", type = "audio/mpeg") {
  const bytes = mp3Frames(3_000);
  const hash = await sha256(bytes);
  const speakers = [LABEL_A, LABEL_B, LABEL_C].map((id, index) => ({ id, name: `Speaker ${index + 1}`, confirmed: false, sourceLabels: [`run:${index}`] }));
  const segments = [
    segment("first label opens", [LABEL_A], 0, 6),
    segment("second label continues", [LABEL_B], 6, 12),
    segment("someone else", [LABEL_C], 12, 18),
  ];
  const initial = validateMeeting({
    ...createMeeting(),
    id: meetingId,
    speakers,
    segments,
    audio: { name, type, size: bytes.byteLength, duration: 18, hash, present: true },
  });
  const withRun = replaceTranscript(initial, speakers, segments, "OpenRouter", "scribe", { originalSpeakers: speakers, originalSegments: segments });
  const saved = await saveMeeting(withRun, new Blob([bytes], { type }));
  return { saved, segments };
}

describe("local voice check for a single MP3", () => {
  it("merges an over-split label by voice, keeps text, and is undoable", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const meetingId = "00000000-0000-4000-8000-000000000021";
    const { saved, segments } = await singleMp3Meeting(meetingId);
    const provider = sequenceProvider([unit(0), unit(2), unit(1), unit(3), unit(90), unit(92)]);

    const { meeting, summary } = await analyzeSingleRecordingVoices(saved, { provider, consent: true });

    expect(provider.calls).toBe(6);
    expect(summary).toEqual({ comparedLabels: 3, mergedLabels: 1, unresolvedLabels: 0 });
    expect(meeting.segments.map((s) => s.text)).toEqual(segments.map((s) => s.text));
    expect(meeting.segments[0]?.speakerIds).toEqual(meeting.segments[1]?.speakerIds);
    expect(meeting.segments[2]?.speakerIds).toEqual([LABEL_C]);
    expect(meeting.speakers).toHaveLength(2);
    expect(meeting.runs[0]?.originalSegments.map((s) => s.speakerIds)).toEqual(segments.map((s) => s.speakerIds));
    expect(undoEdit(meeting).segments.map((s) => s.speakerIds)).toEqual(segments.map((s) => s.speakerIds));
    expect((await listAcousticIdentities(meetingId)).length).toBe(2);
    expect((await listAcousticAssignments(meetingId)).length).toBe(3);

    const persisted = await saveMeeting(meeting);
    expect((await getMeeting(meetingId))?.segments[1]?.speakerIds).toEqual(persisted.segments[1]?.speakerIds);
    await deleteMeeting(meetingId);
  });

  it("changes nothing when every label is a different voice", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const meetingId = "00000000-0000-4000-8000-000000000022";
    const { saved } = await singleMp3Meeting(meetingId);
    const provider = sequenceProvider([unit(0), unit(2), unit(90), unit(92), unit(180), unit(182)]);
    const { meeting, summary } = await analyzeSingleRecordingVoices(saved, { provider, consent: true });
    expect(summary.mergedLabels).toBe(0);
    expect(meeting).toStrictEqual(saved);
    await deleteMeeting(meetingId);
  });

  it("requires consent and a supported format, and rejects a changed recording", async () => {
    const meetingId = "00000000-0000-4000-8000-000000000023";
    const { saved } = await singleMp3Meeting(meetingId);
    const provider = sequenceProvider([]);
    await expect(analyzeSingleRecordingVoices(saved, { provider, consent: false })).rejects.toThrow(/consent/i);
    const wav = { ...saved, audio: { ...saved.audio!, name: "talk.wav", type: "audio/wav" } };
    await expect(analyzeSingleRecordingVoices(wav, { provider, consent: true })).rejects.toThrow(/MP3 and M4A/);
    const tampered = { ...saved, audio: { ...saved.audio!, hash: "b".repeat(64) } };
    await expect(analyzeSingleRecordingVoices(tampered, { provider, consent: true })).rejects.toThrow(/does not match/);
    expect(singleRecordingFormat({ name: "x.m4a", type: "" })).toBe("mp4");
    expect(singleRecordingFormat({ name: "x.bin", type: "audio/mpeg" })).toBe("mp3");
    await deleteMeeting(meetingId);
    (await db()).close();
  });
});
