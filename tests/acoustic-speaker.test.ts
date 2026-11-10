import { describe, expect, it } from "vitest";
import {
  ACOUSTIC_POLICY,
  applyAcousticAssignments,
  applyAcousticAssignmentsToMeeting,
  chooseAcousticAssignment,
  selectAcousticSamples,
  type AcousticEmbeddingRecord,
  type AcousticIdentity,
} from "../src/domain/acoustic-speaker";
import { createMeeting, ref, segment, validateMeeting } from "../src/domain/model";
import { undoEdit } from "../src/domain/operations";

const meetingId = "meeting-acoustic";
const recordingHash = "a".repeat(64);
const vector = (axis: number): number[] => Array.from({ length: ACOUSTIC_POLICY.dimensions }, (_, index) => index === axis ? 1 : 0);
const mixedVector = (cosine: number): number[] => [cosine, Math.sqrt(1 - cosine * cosine), ...Array.from({ length: ACOUSTIC_POLICY.dimensions - 2 }, () => 0)];
const embedding = (id: string, values: number[], overrides: Partial<AcousticEmbeddingRecord> = {}): AcousticEmbeddingRecord => ({
  id,
  meetingId,
  recordingHash,
  sourceRevision: 1,
  chunkIndex: 0,
  sourceSpeakerId: "source-a",
  sample: { id: `sample:${id}`, chunkIndex: 0, sourceSpeakerId: "source-a", startSeconds: 0, endSeconds: 2, segmentIds: [id] },
  modelId: ACOUSTIC_POLICY.modelId,
  modelRevision: ACOUSTIC_POLICY.modelRevision,
  extractionVersion: ACOUSTIC_POLICY.version,
  values,
  createdAt: new Date().toISOString(),
  ...overrides,
});
const identity = (id: string, axis: number, overrides: Partial<AcousticIdentity> = {}): AcousticIdentity => ({
  id,
  meetingId,
  recordingHash,
  sourceRevision: 1,
  modelRevision: ACOUSTIC_POLICY.modelRevision,
  extractionVersion: ACOUSTIC_POLICY.version,
  centroid: vector(axis),
  anchors: [vector(axis)],
  representativeEmbeddingIds: [],
  sourceKeys: [],
  sourceCount: 0,
  sampleCount: 2,
  confirmedSpeakerId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("bounded acoustic sample selection", () => {
  it("excludes a known overlapping speaker interval and allows exact touching boundaries", () => {
    const overlapping = selectAcousticSamples([{
      chunk: { index: 0, ownStartSeconds: 0, ownDurationSeconds: 10, leadInSeconds: 0 },
      speech: { segments: [segment("A", ["a"], 0, 3), segment("B", ["b"], 2, 4)] },
    }]);
    expect(overlapping.samples).toHaveLength(0);

    const touching = selectAcousticSamples([{
      chunk: { index: 1, ownStartSeconds: 0, ownDurationSeconds: 10, leadInSeconds: 0 },
      speech: { segments: [segment("A", ["a"], 0, 2), segment("B", ["b"], 2, 4)] },
    }]);
    expect(touching.samples.map((sample) => sample.sourceSpeakerId)).toEqual(["a", "b"]);
  });

  it("selects independent bounded windows from a long clean turn", () => {
    const result = selectAcousticSamples([{
      chunk: { index: 2, ownStartSeconds: 100, ownDurationSeconds: 30, leadInSeconds: 4 },
      speech: { segments: [segment("long", ["a"], 4, 34)] },
    }]);
    expect(result.samples).toHaveLength(3);
    expect(result.samples.map((sample) => sample.startSeconds)).toEqual([100, 104, 108]);
    expect(result.samples.every((sample) => sample.startSeconds >= 100 && sample.endSeconds <= 130)).toBe(true);
  });
});

describe("meeting-scoped acoustic policy", () => {
  it("creates a new identity for a consistent distinct voice", () => {
    const result = chooseAcousticAssignment({
      meetingId,
      recordingHash,
      sourceRevision: 1,
      chunkIndex: 1,
      sourceSpeakerId: "source-b",
      embeddings: [embedding("b1", vector(1), { chunkIndex: 1, sourceSpeakerId: "source-b" }), embedding("b2", vector(1), { chunkIndex: 1, sourceSpeakerId: "source-b" })],
    }, [identity("voice-a", 0)]);
    expect(result.assignment.state).toBe("new_identity");
    expect(result.assignment.identityId).toBe(result.identity?.id);
  });

  it("creates a new identity when every known profile is a non-match", () => {
    const result = chooseAcousticAssignment({
      meetingId,
      recordingHash,
      sourceRevision: 1,
      chunkIndex: 2,
      sourceSpeakerId: "source-c",
      embeddings: [
        embedding("c1", vector(2), { chunkIndex: 2, sourceSpeakerId: "source-c" }),
        embedding("c2", vector(2), { chunkIndex: 2, sourceSpeakerId: "source-c" }),
      ],
    }, [identity("voice-a", 0), identity("voice-b", 1)]);
    expect(result.assignment.state).toBe("new_identity");
  });

  it("does not create a prototype from the uncalibrated middle cohesion band", () => {
    const result = chooseAcousticAssignment({
      meetingId,
      recordingHash,
      sourceRevision: 1,
      chunkIndex: 3,
      sourceSpeakerId: "source-d",
      embeddings: [
        embedding("d1", vector(0), { chunkIndex: 3, sourceSpeakerId: "source-d" }),
        embedding("d2", mixedVector(0.7649), { chunkIndex: 3, sourceSpeakerId: "source-d" }),
      ],
    }, []);
    expect(result.assignment.state).toBe("ambiguous");
    expect(result.assignment.identityId).toBeNull();
    expect(result.identity).toBeUndefined();
  });

  it("keeps internally contradictory samples unresolved even with no identities", () => {
    const result = chooseAcousticAssignment({
      meetingId,
      recordingHash,
      sourceRevision: 1,
      chunkIndex: 1,
      sourceSpeakerId: "source-b",
      embeddings: [embedding("b1", vector(0), { chunkIndex: 1, sourceSpeakerId: "source-b" }), embedding("b2", vector(1), { chunkIndex: 1, sourceSpeakerId: "source-b" })],
    }, []);
    expect(result.assignment.state).toBe("conflict");
    expect(result.assignment.identityId).toBeNull();
  });

  it("rejects cross-meeting or wrong-model evidence before scoring", () => {
    expect(() => chooseAcousticAssignment({
      meetingId,
      recordingHash,
      sourceRevision: 1,
      chunkIndex: 0,
      sourceSpeakerId: "source-a",
      embeddings: [embedding("x1", vector(0), { meetingId: "other" }), embedding("x2", vector(0))],
    }, [])).toThrow("different meeting");
    expect(() => chooseAcousticAssignment({
      meetingId,
      recordingHash,
      sourceRevision: 1,
      chunkIndex: 0,
      sourceSpeakerId: "source-a",
      embeddings: [embedding("x1", vector(0), { modelRevision: "wrong" }), embedding("x2", vector(0), { modelRevision: "wrong" })],
    }, [])).toThrow("different meeting");
  });

  it("keeps a fixed seed anchor to prevent transitive centroid drift", () => {
    const result = chooseAcousticAssignment({
      meetingId,
      recordingHash,
      sourceRevision: 1,
      chunkIndex: 1,
      sourceSpeakerId: "source-b",
      embeddings: [embedding("b1", vector(1), { chunkIndex: 1, sourceSpeakerId: "source-b" }), embedding("b2", vector(1), { chunkIndex: 1, sourceSpeakerId: "source-b" })],
    }, [identity("voice-a", 0, { centroid: vector(1), anchors: [vector(0)] })]);
    expect(result.assignment.state).toBe("new_identity");
  });

  it("maps an explicit human-linked identity without overwriting its name", () => {
    const speech = {
      speakers: [{ id: "part-1:source-a", name: "Speaker 1", confirmed: false, sourceLabels: ["raw"] }],
      segments: [segment("hello", ["part-1:source-a"], 1, 2)],
      duration: 2,
      requestId: null,
    };
    const output = applyAcousticAssignments(speech, [{
      id: "assignment",
      meetingId,
      recordingHash,
      sourceRevision: 1,
      sourceKey: "1:source-a",
      chunkIndex: 1,
      sourceSpeakerId: "source-a",
      state: "matched",
      identityId: "voice-a",
      scores: [],
      evidenceEmbeddingIds: [],
      reason: "explicit",
      thresholdVersion: ACOUSTIC_POLICY.version,
      calibrationStatus: "uncalibrated",
      updatedAt: new Date().toISOString(),
    }], [identity("voice-a", 0, { confirmedSpeakerId: "human-a" })], [{ id: "human-a", name: "Alice", confirmed: true, sourceLabels: ["human"] }]);
    expect(output.speakers).toEqual([{ id: "human-a", name: "Alice", confirmed: true, sourceLabels: ["human", "raw"] }]);
    expect(output.segments[0]?.speakerIds).toEqual(["human-a"]);
  });

  it("revises only changed speaker attribution and keeps undo/history refs valid", () => {
    const source = segment("human correction", ["part-0:source-a"], 1, 2);
    const derivedIdentityId = "00000000-0000-4000-8000-000000000002";
    const meeting = validateMeeting({ ...createMeeting(),
      speakers: [{ id: "part-0:source-a", name: "Speaker 1", confirmed: false, sourceLabels: [] }],
      segments: [source],
      audio: { name: "recording.mp3", type: "audio/mpeg", size: 1, duration: 2, hash: recordingHash, present: true },
    });
    const output = applyAcousticAssignmentsToMeeting(meeting, [{
      id: "assignment",
      meetingId,
      recordingHash,
      sourceRevision: 1,
      sourceKey: "0:source-a",
      chunkIndex: 0,
      sourceSpeakerId: "source-a",
      state: "matched",
      identityId: derivedIdentityId,
      scores: [],
      evidenceEmbeddingIds: [],
      reason: "matched",
      thresholdVersion: ACOUSTIC_POLICY.version,
      calibrationStatus: "uncalibrated",
      updatedAt: new Date().toISOString(),
    }], [identity(derivedIdentityId, 0)]);
    expect(output.segments[0]?.text).toBe(source.text);
    expect(output.segments[0]?.speakerIds).toEqual([derivedIdentityId]);
    expect(output.segments[0]?.revision).toBe(2);
    expect(output.segments[0]?.parents).toEqual([ref(source)]);
    expect(output.history.some((value) => ref(value) === ref(source))).toBe(true);
    expect(undoEdit(output).segments[0]?.speakerIds).toEqual(source.speakerIds);
  });
});
