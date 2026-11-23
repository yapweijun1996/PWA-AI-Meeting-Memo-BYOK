import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { AcousticAssignment, AcousticEmbeddingRecord } from "../src/domain/acoustic-speaker";
import { segment, type Meeting } from "../src/domain/model";
import { buildVoiceEvaluationExport } from "../src/domain/voice-evaluation";
// @ts-expect-error The offline read-only CLI is JavaScript.
import { evaluateVoiceMatching, replayVoiceMatching } from "../scripts/evaluate-voice-matching.mjs";
import * as matcher from "../src/domain/acoustic-speaker";

const HASH = "e".repeat(64);

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shared room component dominates; each voice adds a distinct part; every sample is noisy. */
function vector(voice: number, rng: () => number): number[] {
  const values = Array.from({ length: 512 }, () => 0);
  values[0] = 3;
  values[1 + voice] = 1;
  for (let index = 10; index < 40; index += 1) values[index] = (rng() * 2 - 1) * 0.2;
  return values;
}

function record(part: number, label: string, voice: number, start: number, rng: () => number): AcousticEmbeddingRecord {
  const id = `sample:${part}:${label}:${start.toFixed(3)}:${(start + 3).toFixed(3)}`;
  return {
    id,
    meetingId: "meeting",
    recordingHash: HASH,
    sourceRevision: 1,
    chunkIndex: part,
    sourceSpeakerId: label,
    sample: { id, chunkIndex: part, sourceSpeakerId: label, startSeconds: start, endSeconds: start + 3, segmentIds: [] },
    modelId: "model",
    modelRevision: "revision",
    extractionVersion: "extraction",
    values: vector(voice, rng),
    createdAt: "2026-11-16T00:00:00.000Z",
  };
}

function assignment(part: number, label: string, identityId: string | null, state: AcousticAssignment["state"] = "matched"): AcousticAssignment {
  return {
    id: `meeting:${part}:${label}`,
    meetingId: "meeting",
    recordingHash: HASH,
    sourceRevision: 1,
    sourceKey: `${part}:${label}`,
    chunkIndex: part,
    sourceSpeakerId: label,
    state,
    identityId,
    scores: [],
    evidenceEmbeddingIds: [],
    reason: "test",
    thresholdVersion: "test",
    calibrationStatus: "uncalibrated",
    updatedAt: "2026-11-16T00:00:00.000Z",
  };
}

/**
 * Two parts. Rows are [part, label, voice, current speaker]; each label speaks in
 * its own 100-second block and has three samples there.
 */
function fixture(rows: [number, string, number, string][], confirmed: string[]) {
  const rng = random(7);
  const speakerIds = [...new Set(rows.map((row) => row[3]))];
  const speakers = speakerIds.map((id) => ({ id, name: `Private name ${id}`, confirmed: confirmed.includes(id), sourceLabels: [] as string[] }));
  const segments = rows.map(([, , , speakerId], index) => segment("private words", [speakerId], index * 100, index * 100 + 90));
  const embeddings = rows.flatMap(([part, label, voice], index) =>
    [0, 1, 2].map((n) => record(part, label, voice, index * 100 + n * 10, rng)),
  );
  const meeting = {
    speakers,
    segments,
    audio: { hash: HASH, duration: rows.length * 100, chunked: { chunkCount: 2 } },
  } as unknown as Meeting;
  return { meeting, embeddings };
}

const ROWS: [number, string, number, string][] = [
  [0, "A", 0, "ann"], [0, "B", 1, "bob"], [0, "C", 2, "cy"],
  [1, "A", 1, "bob"], [1, "B", 0, "ann"], [1, "C", 2, "cy"],
];

describe("voice evaluation export", () => {
  it("uses confirmed speakers as reference and carries no names, text or recording hash", () => {
    const { meeting, embeddings } = fixture(ROWS, ["ann", "bob"]);
    const data = buildVoiceEvaluationExport(meeting, embeddings, [], "2026-11-16T00:00:00.000Z");
    expect(data.samples).toHaveLength(18);
    expect(data.reference).toEqual({ source: "human-confirmed-speakers", speakers: 3, confirmedSpeakers: 2 });
    // ann is P01, bob is P02; cy is not confirmed, so its samples have no reference.
    expect(data.samples.filter((sample) => sample.part === 0 && sample.label === "A").every((sample) => sample.reference === "P01")).toBe(true);
    expect(data.samples.filter((sample) => sample.part === 1 && sample.label === "A").every((sample) => sample.reference === "P02")).toBe(true);
    expect(data.samples.filter((sample) => sample.label === "C").every((sample) => sample.reference === null)).toBe(true);
    const text = JSON.stringify(data);
    expect(text).not.toContain("Private name");
    expect(text).not.toContain("private words");
    expect(text).not.toContain(HASH);
  });

  it("leaves a sample without reference when its time range now covers two speakers", () => {
    const { meeting, embeddings } = fixture(ROWS, ["ann", "bob", "cy"]);
    const overlapped = { ...meeting, segments: [...meeting.segments, segment("x", ["bob"], 0, 5)] } as Meeting;
    const data = buildVoiceEvaluationExport(overlapped, embeddings, []);
    const first = data.samples.find((sample) => sample.part === 0 && sample.label === "A" && sample.start === 0);
    expect(first?.reference).toBeNull();
    expect(data.samples.filter((sample) => sample.reference !== null)).toHaveLength(17);
  });

  it("ignores vectors of another recording and stale decisions", () => {
    const { meeting, embeddings } = fixture(ROWS, ["ann"]);
    const other = embeddings.map((embedding) => ({ ...embedding, recordingHash: "f".repeat(64) }));
    const data = buildVoiceEvaluationExport(meeting, other, [assignment(0, "A", "v", "stale")]);
    expect(data.samples).toHaveLength(0);
    expect(data.decisions).toHaveLength(0);
  });
});

describe("offline voice evaluation", () => {
  const all = ["ann", "bob", "cy"];

  it("scores a correct grouping as fully correct", () => {
    const { meeting, embeddings } = fixture(ROWS, all);
    const decisions = [
      assignment(0, "A", "v-ann", "new_identity"), assignment(0, "B", "v-bob", "new_identity"), assignment(0, "C", "v-cy", "new_identity"),
      assignment(1, "A", "v-bob"), assignment(1, "B", "v-ann"), assignment(1, "C", "v-cy"),
    ];
    const result = evaluateVoiceMatching(JSON.parse(JSON.stringify(buildVoiceEvaluationExport(meeting, embeddings, decisions))));
    expect(result.counts).toMatchObject({ samples: 18, samplesWithReference: 18, referenceSpeakers: 3, labels: 6, labelsWithOneReference: 6, labelsMixingReferences: 0 });
    expect(result.savedGrouping).toMatchObject({ labelsScored: 6, voices: 3, correctMerges: 3, wrongMerges: 0, missedMerges: 0, mergePrecision: 1, mergeRecall: 1 });
    expect(result.savedGrouping.voicesMixingPeople).toEqual([]);
  });

  it("counts a wrong merge, a missed merge and undecided labels", () => {
    const { meeting, embeddings } = fixture(ROWS, all);
    const decisions = [
      assignment(0, "A", "v1", "new_identity"), assignment(0, "B", "v2", "new_identity"), assignment(0, "C", "v3", "new_identity"),
      // Part 1 label A is bob but was put in ann's voice; label B (ann) got a voice of its own.
      assignment(1, "A", "v1"), assignment(1, "B", "v4", "new_identity"), assignment(1, "C", null, "ambiguous"),
    ];
    const result = evaluateVoiceMatching(buildVoiceEvaluationExport(meeting, embeddings, decisions));
    expect(result.savedGrouping).toMatchObject({ labelsScored: 5, voices: 4, correctMerges: 0, wrongMerges: 1, missedMerges: 2, mergePrecision: 0, mergeRecall: 0 });
    expect(result.savedGrouping.labelsUndecidedByState).toEqual({ ambiguous: 1 });
    expect(result.savedGrouping.voicesMixingPeople).toEqual([{ voice: "V01", references: ["P01", "P02"] }]);
  });

  it("reports missing decisions and unresolved reference pairs in the CLI baseline", () => {
    const path = "tests/fixtures/voice-evaluation.synthetic.json";
    const result = JSON.parse(execFileSync(process.execPath, ["scripts/evaluate-voice-matching.mjs", path, "--replay"], { encoding: "utf8" }));
    expect(result.counts).toMatchObject({ samples: 9, samplesWithReference: 8, labels: 8, labelsWithOneReference: 6, labelsMixingReferences: 1, labelsWithoutReference: 1 });
    expect(result.savedGrouping).toMatchObject({
      labelsScored: 4, referenceLabels: 6, labelDecisionCoverage: 4 / 6,
      labelsUndecidedByState: { ambiguous: 1 }, labelsMissingDecision: 1,
      correctMerges: 1, wrongMerges: 2, missedMerges: 2,
      referenceSamePersonPairs: 10, unresolvedSamePersonPairs: 7,
      mergePrecision: 1 / 3, mergeRecall: 1 / 3, mergeRecallAllReferencedPairs: 1 / 10,
    });
    expect(result.replay.runs[0]).toMatchObject({ labelsScored: 0, referenceSamePersonPairs: 10, unresolvedSamePersonPairs: 10 });
    const fixture = JSON.parse(readFileSync(path, "utf8"));
    fixture.decisions.push(fixture.decisions[0]);
    expect(() => evaluateVoiceMatching(fixture)).toThrow(/Invalid or oversized/);
  });

  it("shows that removing the average separates voices that raw similarity cannot", () => {
    const { meeting, embeddings } = fixture(ROWS, all);
    const result = evaluateVoiceMatching(buildVoiceEvaluationExport(meeting, embeddings, []));
    // The shared room component makes every raw pair look alike.
    expect(result.samplePairs.raw.differentPeople.median).toBeGreaterThan(0.8);
    for (const view of ["centredOnSampleAverage", "centredOnLabelAverage"] as const) {
      expect(result.labelPairs[view].samePerson.median).toBeGreaterThan(0.5);
      expect(result.labelPairs[view].differentPeople.median).toBeLessThan(0);
      expect(result.labelPairs[view].balancedThreshold).toMatchObject({ falseAcceptRate: 0, falseRejectRate: 0 });
    }
  });

  it("reports a provider label whose samples belong to two confirmed people", () => {
    const { meeting, embeddings } = fixture(ROWS, all);
    // A person moved the first passage of part 0 label A to bob: that label now mixes two people.
    const mixed = {
      ...meeting,
      segments: [segment("x", ["bob"], 0, 5), segment("y", ["ann"], 5, 90), ...meeting.segments.slice(1)],
    } as Meeting;
    const result = evaluateVoiceMatching(buildVoiceEvaluationExport(mixed, embeddings, []));
    expect(result.mixedLabels).toEqual([{ part: 0, label: "A", samplesPerReference: { P02: 1, P01: 2 } }]);
    expect(result.counts.labelsWithOneReference).toBe(5);
  });

  it("replays the app's matcher on the exported vectors and scores each setting", () => {
    const { meeting, embeddings } = fixture(ROWS, all);
    const data = JSON.parse(JSON.stringify(buildVoiceEvaluationExport(meeting, embeddings, [])));
    const result = replayVoiceMatching(data, matcher);
    const current = result.replay.runs[0];
    // Labels A and B swap people between the parts; the matcher follows the voices, not the labels.
    expect(current).toMatchObject({ name: "current settings", floorCosine: 0.35, margin: 0.1, voices: 3, labelsScored: 6, correctMerges: 3, wrongMerges: 0, missedMerges: 0 });
    expect(result.replay.runs.some((run: { expectedVoices: number | null }) => run.expectedVoices === 3)).toBe(true);
    expect(result.replay.runs.filter((run: { name: string }) => run.name.startsWith("floor "))).toHaveLength(17);
    // A person's "different" pair is honoured when the replay is told to use it.
    const constrained = replayVoiceMatching({ ...data, differentLabelPairs: [["0:A", "1:B"]] }, matcher).replay.runs
      .find((run: { name: string }) => run.name === "current settings with human different pairs");
    expect(constrained).toMatchObject({ humanDifferentPairsJoined: 0, missedMerges: 1 });
    expect(result.savedGrouping.labelsScored).toBe(0);
  });

  it("rejects files that are not an export", () => {
    const { meeting, embeddings } = fixture(ROWS, all);
    const data = buildVoiceEvaluationExport(meeting, embeddings, []);
    expect(() => evaluateVoiceMatching({ ...data, kind: "something-else" })).toThrow(/Invalid or oversized/);
    expect(() => evaluateVoiceMatching({ ...data, samples: [{ ...data.samples[0], values: [1, Number.NaN] }] })).toThrow(/Invalid or oversized/);
    expect(() => evaluateVoiceMatching({ ...data, samples: [data.samples[0], data.samples[0]] })).toThrow(/Invalid or oversized/);
  });
});
