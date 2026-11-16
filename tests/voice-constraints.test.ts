import { describe, expect, it } from "vitest";
import { matchLabelsAcrossParts, type AcousticEmbeddingRecord, type VoiceConstraints } from "../src/domain/acoustic-speaker";
import { createMeeting, segment, validateMeeting, type Meeting } from "../src/domain/model";
import {
  clearSpeakerVoiceDecisions,
  markSpeakersDifferent,
  mergeSpeakers,
  replaceTranscript,
  undoEdit,
} from "../src/domain/operations";
import { buildVoiceConstraints } from "../src/domain/voice-constraints";
import { buildVoiceEvaluationExport } from "../src/domain/voice-evaluation";
import { suggestVoiceMatches } from "../src/domain/voice-suggestions";

const HASH = "c".repeat(64);
const MODEL = { modelId: "Xenova/wavlm-base-plus-sv", modelRevision: "e61029603001bd11295c36d878698708bf59190f", extractionVersion: "wavlm-sv-uncalibrated-v1" };

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shared room component dominates; each voice adds a small distinct part; every sample is noisy. */
function sample(voice: number, rng: () => number): number[] {
  const values = Array.from({ length: 512 }, () => 0);
  values[0] = 3;
  values[1 + voice] = 1;
  for (let index = 10; index < 40; index += 1) values[index] = (rng() * 2 - 1) * 0.4;
  return values;
}

/** Each label speaks in its own 100-second block: block = part * 10 + position in the part. */
function build(parts: { label: string; voice: number }[][]): AcousticEmbeddingRecord[] {
  const rng = random(7);
  return parts.flatMap((labels, chunkIndex) =>
    labels.flatMap(({ label, voice }, position) =>
      [0, 1, 2].map((n) => {
        const start = (chunkIndex * 10 + position) * 100 + n * 10;
        const id = `sample:${chunkIndex}:${label}:${start.toFixed(3)}:${(start + 3).toFixed(3)}`;
        return {
          id,
          meetingId: "meeting",
          recordingHash: HASH,
          sourceRevision: 1,
          chunkIndex,
          sourceSpeakerId: label,
          sample: { id, chunkIndex, sourceSpeakerId: label, startSeconds: start, endSeconds: start + 3, segmentIds: [] },
          ...MODEL,
          values: sample(voice, rng),
          createdAt: "2026-11-16T00:00:00.000Z",
        };
      }),
    ),
  );
}

function match(embeddings: AcousticEmbeddingRecord[], constraints?: VoiceConstraints, expectedVoices?: number) {
  const result = matchLabelsAcrossParts({ meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings, constraints, expectedVoices });
  return {
    voiceOf: new Map(result.assignments.map((assignment) => [assignment.sourceKey, assignment.identityId])),
    reasonOf: new Map(result.assignments.map((assignment) => [assignment.sourceKey, assignment.reason])),
    voices: result.identities.length,
  };
}

// Two people (voices 0 and 1) in two parts. Unconstrained, part 1 pairs with part 0 by voice.
const TWO_BY_TWO = [
  [{ label: "A", voice: 0 }, { label: "B", voice: 1 }],
  [{ label: "A", voice: 0 }, { label: "B", voice: 1 }],
];

describe("human constraints in multi-part voice matching", () => {
  it("pairs the same voice across parts when there is no constraint", () => {
    const { voiceOf, voices } = match(build(TWO_BY_TWO));
    expect(voices).toBe(2);
    expect(voiceOf.get("0:A")).toBe(voiceOf.get("1:A"));
    expect(voiceOf.get("0:B")).toBe(voiceOf.get("1:B"));
  });

  it("never joins labels a person judged different, even when their voices match", () => {
    const { voiceOf, voices } = match(build(TWO_BY_TWO), { mustLink: [], cannotLink: [["0:A", "1:A"]] });
    expect(voiceOf.get("1:A")).toBeTruthy();
    expect(voiceOf.get("1:A")).not.toBe(voiceOf.get("0:A"));
    expect(voiceOf.get("0:B")).toBe(voiceOf.get("1:B"));
    expect(voices).toBe(3);
  });

  it("does not let a head count force a rejected pair together", () => {
    // Asking for 2 voices would normally join 1:A to 0:A. The rejected pair stays apart,
    // so the closest permitted merge is used and, when none is left, the count is not reached.
    const { voiceOf } = match(build(TWO_BY_TWO), { mustLink: [], cannotLink: [["0:A", "1:A"], ["0:B", "1:A"]] }, 2);
    expect(voiceOf.get("1:A")).not.toBe(voiceOf.get("0:A"));
    expect(voiceOf.get("1:A")).not.toBe(voiceOf.get("0:B"));
  });

  it("joins labels a person confirmed as one speaker, even when their voices differ", () => {
    // The person says 0:A and 1:B are one speaker although the vectors disagree.
    const { voiceOf, reasonOf } = match(build(TWO_BY_TWO), { mustLink: [["0:A", "1:B"]], cannotLink: [] });
    expect(voiceOf.get("1:B")).toBe(voiceOf.get("0:A"));
    expect(reasonOf.get("1:B")).toMatch(/a person confirmed/);
    // The other label of part 1 cannot take the same voice in that part.
    expect(voiceOf.get("1:A")).not.toBe(voiceOf.get("0:A"));
  });

  it("joins two labels of one confirmed speaker inside one part", () => {
    const embeddings = build([[{ label: "A", voice: 0 }, { label: "A2", voice: 2 }, { label: "B", voice: 1 }], [{ label: "A", voice: 0 }, { label: "B", voice: 1 }]]);
    const { voiceOf } = match(embeddings, { mustLink: [["0:A", "0:A2"]], cannotLink: [] });
    expect(voiceOf.get("0:A2")).toBe(voiceOf.get("0:A"));
  });
});

function reviewedMeeting(rows: [string, number][], confirmed: string[] = []): Meeting {
  // rows: [speakerId, block]; the speaker owns the 100-second block the label's samples lie in.
  const ids = [...new Set(rows.map(([id]) => id))];
  return validateMeeting({
    ...createMeeting(),
    speakers: ids.map((id) => ({ id, name: id, confirmed: confirmed.includes(id), sourceLabels: [] })),
    segments: rows.map(([id, block]) => segment("words", [id], block * 100, block * 100 + 90)),
  });
}

describe("constraints derived from a person's review", () => {
  const embeddings = build(TWO_BY_TWO); // blocks: 0:A=0, 0:B=1, 1:A=10, 1:B=11

  it("links the labels of a confirmed speaker and separates different confirmed speakers", () => {
    const meeting = reviewedMeeting([["part-0:ann", 0], ["part-0:bob", 1], ["part-0:ann", 10], ["part-0:bob", 11]], ["part-0:ann", "part-0:bob"]);
    const constraints = buildVoiceConstraints(meeting, embeddings);
    expect(constraints.mustLink.map((group) => [...group].sort())).toEqual([["0:A", "1:A"], ["0:B", "1:B"]]);
    expect(constraints.cannotLink).toHaveLength(4);
  });

  it("treats unconfirmed groupings as no constraint", () => {
    const meeting = reviewedMeeting([["part-0:ann", 0], ["part-0:bob", 1], ["part-0:ann", 10], ["part-0:bob", 11]]);
    expect(buildVoiceConstraints(meeting, embeddings)).toEqual({ mustLink: [], cannotLink: [] });
  });

  it("separates the labels of two speakers marked not the same", () => {
    const meeting = markSpeakersDifferent(reviewedMeeting([["part-0:s1", 0], ["part-0:s2", 1], ["part-0:s3", 10], ["part-0:s4", 11]]), "part-0:s1", "part-0:s3");
    expect(buildVoiceConstraints(meeting, embeddings)).toEqual({ mustLink: [], cannotLink: [["0:A", "1:A"]] });
  });

  it("gives no constraint for a label a person split between two speakers", () => {
    const meeting = reviewedMeeting([["part-0:ann", 0], ["part-0:bob", 1], ["part-0:ann", 10], ["part-0:bob", 11]], ["part-0:ann", "part-0:bob"]);
    // The first sample of 0:A (0-3 s) now belongs to bob.
    const split = validateMeeting({ ...meeting, segments: [segment("x", ["part-0:bob"], 0, 5), segment("y", ["part-0:ann"], 5, 90), ...meeting.segments.slice(1)] });
    const constraints = buildVoiceConstraints(split, embeddings);
    expect(constraints.mustLink.flat()).not.toContain("0:A");
    expect(constraints.cannotLink.flat()).not.toContain("0:A");
  });

  it("exports the rejected label pairs for evaluation", () => {
    const meeting = markSpeakersDifferent(reviewedMeeting([["part-0:s1", 0], ["part-0:s2", 1], ["part-0:s3", 10], ["part-0:s4", 11]]), "part-0:s1", "part-0:s3");
    const data = buildVoiceEvaluationExport({ ...meeting, audio: { hash: HASH } } as unknown as Meeting, embeddings, []);
    expect(data.differentLabelPairs).toEqual([["0:A", "1:A"]]);
  });

  it("stops suggesting a pair marked not the same", () => {
    const base = { ...reviewedMeeting([["part-0:s1", 0], ["part-0:s2", 1], ["part-0:s3", 10], ["part-0:s4", 11]]), audio: { hash: HASH } } as unknown as Meeting;
    expect(suggestVoiceMatches(base, embeddings).get("part-0:s1")?.candidates[0]?.speakerId).toBe("part-0:s3");
    const decided = { ...base, voiceDecisions: [{ firstSpeakerId: "part-0:s1", secondSpeakerId: "part-0:s3", decision: "different" as const, decidedAt: "2026-11-16T00:00:00.000Z" }] };
    const suggestions = suggestVoiceMatches(decided, embeddings);
    expect(suggestions.get("part-0:s1")?.candidates.some((candidate) => candidate.speakerId === "part-0:s3")).toBe(false);
    expect(suggestions.get("part-0:s3")?.candidates.some((candidate) => candidate.speakerId === "part-0:s1")).toBe(false);
  });
});

describe("saved voice decisions", () => {
  const base = () => reviewedMeeting([["part-0:s1", 0], ["part-0:s2", 1], ["part-0:s3", 10]]);

  it("saves a decision without changing the transcript revision, and survives validation", () => {
    const meeting = base();
    const decided = markSpeakersDifferent(meeting, "part-0:s3", "part-0:s1");
    expect(decided.revision).toBe(meeting.revision);
    expect(decided.undo).toHaveLength(meeting.undo.length);
    expect(decided.voiceDecisions).toMatchObject([{ firstSpeakerId: "part-0:s1", secondSpeakerId: "part-0:s3", decision: "different" }]);
    expect(markSpeakersDifferent(decided, "part-0:s1", "part-0:s3").voiceDecisions).toHaveLength(1);
    expect(validateMeeting(JSON.parse(JSON.stringify(decided))).voiceDecisions).toEqual(decided.voiceDecisions);
    expect(() => markSpeakersDifferent(meeting, "part-0:s1", "part-0:s1")).toThrow();
    expect(() => markSpeakersDifferent(meeting, "part-0:s1", "part-0:gone")).toThrow();
  });

  it("follows a merge, is dropped when the pair itself is merged, and returns on undo", () => {
    const decided = markSpeakersDifferent(base(), "part-0:s1", "part-0:s3");
    // s3 merged into s2: the decision now separates s1 and s2.
    const moved = mergeSpeakers(decided, "part-0:s3", "part-0:s2");
    expect(moved.voiceDecisions).toMatchObject([{ firstSpeakerId: "part-0:s1", secondSpeakerId: "part-0:s2" }]);
    expect(undoEdit(moved).voiceDecisions).toMatchObject([{ firstSpeakerId: "part-0:s1", secondSpeakerId: "part-0:s3" }]);
    // The person merges the very pair they had separated: the later action wins.
    expect(mergeSpeakers(decided, "part-0:s3", "part-0:s1").voiceDecisions).toBeUndefined();
  });

  it("can be forgotten per speaker and is cleared by a new transcript", () => {
    const decided = markSpeakersDifferent(markSpeakersDifferent(base(), "part-0:s1", "part-0:s3"), "part-0:s2", "part-0:s3");
    expect(clearSpeakerVoiceDecisions(decided, "part-0:s1").voiceDecisions).toMatchObject([{ firstSpeakerId: "part-0:s2", secondSpeakerId: "part-0:s3" }]);
    expect(clearSpeakerVoiceDecisions(decided, "part-0:s3").voiceDecisions).toBeUndefined();
    expect(replaceTranscript(decided, decided.speakers, decided.segments, "provider", "model").voiceDecisions).toBeUndefined();
  });
});
