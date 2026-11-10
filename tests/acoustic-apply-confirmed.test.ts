import { describe, expect, it } from "vitest";
import { applyAcousticAssignments, applyAcousticAssignmentsToMeeting, type AcousticAssignment, type AcousticIdentity } from "../src/domain/acoustic-speaker";
import { createMeeting, segment, validateMeeting } from "../src/domain/model";
import { replaceTranscript } from "../src/domain/operations";
import type { NormalizedSpeech } from "../src/providers/api";

const HASH = "e".repeat(64);
const speaker = (id: string, name: string, confirmed = false) => ({ id, name, confirmed, sourceLabels: [] as string[] });
const identity = (id: string): AcousticIdentity => ({
  id, meetingId: "m", recordingHash: HASH, sourceRevision: 1, modelRevision: "r", extractionVersion: "v",
  centroid: [], anchors: [], representativeEmbeddingIds: [], sourceKeys: [], sourceCount: 1, sampleCount: 1,
  confirmedSpeakerId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const assignment = (chunkIndex: number, label: string, identityId: string, state: AcousticAssignment["state"] = "matched"): AcousticAssignment => ({
  id: `m:${chunkIndex}:${label}`, meetingId: "m", recordingHash: HASH, sourceRevision: 1, sourceKey: `${chunkIndex}:${label}`,
  chunkIndex, sourceSpeakerId: label, state, identityId, scores: [], evidenceEmbeddingIds: [], reason: "test",
  thresholdVersion: "t", calibrationStatus: "uncalibrated", updatedAt: new Date().toISOString(),
});

function speech(speakers: ReturnType<typeof speaker>[], segments: ReturnType<typeof segment>[]): NormalizedSpeech {
  return { speakers, segments, duration: 100, requestId: null };
}

// Test speakers are keyed "part-N:label" like merged chunked transcripts, with the
// source label being the bare part after the colon.
describe("applying voices when a human already confirmed a speaker", () => {
  const ctx = { recordingHash: HASH, sourceRevision: 1 };

  it("makes other labels of the same voice join the confirmed speaker", () => {
    const speakers = [speaker("part-0:A", "Alice", true), speaker("part-1:X", "Speaker 1 (part 2)"), speaker("part-1:Y", "Speaker 2 (part 2)")];
    const segments = [segment("one", ["part-0:A"], 0, 5), segment("two", ["part-1:X"], 10, 15), segment("three", ["part-1:Y"], 20, 25)];
    const result = applyAcousticAssignments(
      speech(speakers, segments),
      [assignment(0, "A", "v1", "new_identity"), assignment(1, "X", "v1"), assignment(1, "Y", "v2", "new_identity")],
      [identity("v1"), identity("v2")],
      speakers,
      ctx,
    );
    expect(result.segments.map((s) => s.speakerIds)).toEqual([["part-0:A"], ["part-0:A"], ["v2"]]);
    const alice = result.speakers.find((s) => s.id === "part-0:A");
    expect(alice?.name).toBe("Alice");
    expect(alice?.confirmed).toBe(true);
    expect(result.speakers.some((s) => s.id === "part-1:X")).toBe(false);
  });

  it("does not merge two different confirmed speakers even if their voices matched", () => {
    const speakers = [speaker("part-0:A", "Alice", true), speaker("part-1:B", "Bob", true), speaker("part-1:Z", "Speaker 3 (part 2)")];
    const segments = [segment("one", ["part-0:A"], 0, 5), segment("two", ["part-1:B"], 10, 15), segment("three", ["part-1:Z"], 20, 25)];
    const result = applyAcousticAssignments(
      speech(speakers, segments),
      [assignment(0, "A", "v1", "new_identity"), assignment(1, "B", "v1"), assignment(1, "Z", "v1")],
      [identity("v1")],
      speakers,
      ctx,
    );
    // The voice contains two people a human confirmed as different, so nothing in it is re-keyed.
    expect(result.segments.map((s) => s.speakerIds)).toEqual([["part-0:A"], ["part-1:B"], ["part-1:Z"]]);
  });

  it("still groups unconfirmed labels into one anonymous voice", () => {
    const speakers = [speaker("part-0:P", "Speaker 1"), speaker("part-1:Q", "Speaker 1 (part 2)")];
    const segments = [segment("one", ["part-0:P"], 0, 5), segment("two", ["part-1:Q"], 10, 15)];
    const result = applyAcousticAssignments(
      speech(speakers, segments),
      [assignment(0, "P", "v1", "new_identity"), assignment(1, "Q", "v1")],
      [identity("v1")],
      speakers,
      ctx,
    );
    expect(result.segments[0]?.speakerIds).toEqual(["v1"]);
    expect(result.segments[1]?.speakerIds).toEqual(["v1"]);
  });

  it("follows a speaker an earlier run already re-keyed back to its original label", () => {
    const stale = "11111111-1111-4111-8111-111111111111";
    const speakers = [speaker("part-0:A", "Alice", true), speaker(stale, "Speaker 1 (part 2)")];
    const segments = [segment("one", ["part-0:A"], 0, 5), segment("two", [stale], 10, 15)];
    const result = applyAcousticAssignments(
      speech(speakers, segments),
      [assignment(0, "A", "v1", "new_identity"), assignment(1, "X", "v1")],
      [identity("v1")],
      speakers,
      ctx,
      undefined,
      new Map([[stale, ["part-1:X"]]]),
    );
    expect(result.segments.map((s) => s.speakerIds)).toEqual([["part-0:A"], ["part-0:A"]]);
    expect(result.speakers.map((s) => s.id)).toEqual(["part-0:A"]);
  });

  it("recovers the original label from the provider run, and leaves human-reassigned speakers alone", () => {
    const stale = "22222222-2222-4222-8222-222222222222";
    const other = "33333333-3333-4333-8333-333333333333";
    const runSpeakers = [speaker("part-0:A", "Speaker 1"), speaker("part-1:X", "Speaker 1"), speaker("part-1:Y", "Speaker 2")];
    const runSegments = [segment("one", ["part-0:A"], 0, 5), segment("two", ["part-1:X"], 10, 15), segment("three", ["part-1:Y"], 20, 25), segment("four", ["part-1:Y"], 30, 35), segment("five", ["part-0:A"], 40, 45)];
    // Now: X was re-keyed to `stale`; `other` holds a Y passage and an A passage a human moved into it.
    const currentSpeakers = [speaker("part-0:A", "Alice", true), speaker(stale, "Speaker 1 (part 2)"), speaker(other, "Speaker 2 (part 2)")];
    const currentSegments = [
      runSegments[0]!,
      { ...runSegments[1]!, speakerIds: [stale] },
      { ...runSegments[2]!, speakerIds: [other] },
      { ...runSegments[3]!, speakerIds: ["part-0:A"] },
      { ...runSegments[4]!, speakerIds: [other] },
    ];
    const base = validateMeeting({
      ...createMeeting(),
      speakers: currentSpeakers,
      segments: currentSegments,
      audio: { name: "a.mp3", type: "audio/mpeg", size: 10, duration: 60, hash: HASH, present: true },
    });
    const meeting = replaceTranscript(base, currentSpeakers, currentSegments, "P", "m", { originalSpeakers: runSpeakers, originalSegments: runSegments });
    const ctxAssign = (chunk: number, label: string, id: string, state: AcousticAssignment["state"] = "matched") => ({ ...assignment(chunk, label, id, state), meetingId: meeting.id, sourceRevision: meeting.revision });
    const applied = applyAcousticAssignmentsToMeeting(
      meeting,
      [ctxAssign(0, "A", "v1", "new_identity"), ctxAssign(1, "X", "v1"), ctxAssign(1, "Y", "v1")],
      [{ ...identity("v1"), meetingId: meeting.id, sourceRevision: meeting.revision }],
    );
    const byText = (text: string) => applied.segments.find((s) => s.text === text)?.speakerIds;
    expect(byText("two")).toEqual(["part-0:A"]); // re-keyed speaker follows its original label
    expect(byText("three")).toEqual([other]); // `other` mixes two origins, so it is not guessed at
  });

  it("lets a speaker merged from several labels follow them only when they all agree", () => {
    const merged = "44444444-4444-4444-8444-444444444444";
    const speakers = [speaker("part-0:A", "Alice", true), speaker(merged, "Speaker 1 (part 2)")];
    const segments = [segment("one", ["part-0:A"], 0, 5), segment("two", [merged], 10, 15)];
    const agree = applyAcousticAssignments(
      speech(speakers, segments),
      [assignment(0, "A", "v1", "new_identity"), assignment(1, "X", "v1"), assignment(1, "Y", "v1")],
      [identity("v1")], speakers, ctx, undefined, new Map([[merged, ["part-1:X", "part-1:Y"]]]),
    );
    expect(agree.segments[1]?.speakerIds).toEqual(["part-0:A"]);
    const split = applyAcousticAssignments(
      speech(speakers, segments),
      [assignment(0, "A", "v1", "new_identity"), assignment(1, "X", "v1"), assignment(1, "Y", "v2", "new_identity")],
      [identity("v1"), identity("v2")], speakers, ctx, undefined, new Map([[merged, ["part-1:X", "part-1:Y"]]]),
    );
    expect(split.segments[1]?.speakerIds).toEqual([merged]);
  });

  it("counts a confirmed speaker that an earlier run re-keyed as the human of its voice", () => {
    const confirmedKeyed = "55555555-5555-4555-8555-555555555555";
    const speakers = [speaker(confirmedKeyed, "Carol", true), speaker("part-2:R", "Speaker 1 (part 3)")];
    const segments = [segment("one", [confirmedKeyed], 0, 5), segment("two", ["part-2:R"], 20, 25)];
    const result = applyAcousticAssignments(
      speech(speakers, segments),
      [assignment(1, "Q", "v1", "new_identity"), assignment(2, "R", "v1")],
      [identity("v1")], speakers, ctx, undefined, new Map([[confirmedKeyed, ["part-1:Q"]]]),
    );
    expect(result.segments.map((s) => s.speakerIds)).toEqual([[confirmedKeyed], [confirmedKeyed]]);
    expect(result.speakers.find((s) => s.id === confirmedKeyed)?.name).toBe("Carol");
  });
});
