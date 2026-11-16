import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  matchLabelsAcrossParts,
  type AcousticEmbeddingRecord,
} from "../src/domain/acoustic-speaker";

const HASH = "c".repeat(64);
const MODEL = { modelId: "Xenova/wavlm-base-plus-sv", modelRevision: "e61029603001bd11295c36d878698708bf59190f", extractionVersion: "wavlm-sv-uncalibrated-v1" };

function random(seed: number) {
  // mulberry32: deterministic, so the test cannot flake.
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shared room/channel component dominates; each voice adds a small distinct part; every sample is noisy. */
function sample(voice: number, rng: () => number, common = 3, noise = 0.4): number[] {
  const values = Array.from({ length: 512 }, () => 0);
  values[0] = common;
  values[1 + voice] = 1;
  for (let index = 10; index < 40; index += 1) values[index] = (rng() * 2 - 1) * noise;
  return values;
}

function record(chunkIndex: number, label: string, voice: number, n: number, rng: () => number): AcousticEmbeddingRecord {
  const start = chunkIndex * 1000 + n * 5;
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
    createdAt: new Date().toISOString(),
  };
}

function build(parts: { label: string; voice: number }[][], seed = 7, samplesPerLabel = 3) {
  const rng = random(seed);
  return parts.flatMap((labels, chunkIndex) =>
    labels.flatMap(({ label, voice }) =>
      Array.from({ length: samplesPerLabel }, (_, n) => record(chunkIndex, label, voice, n, rng)),
    ),
  );
}

function run(embeddings: AcousticEmbeddingRecord[], expectedVoices?: number) {
  return matchLabelsAcrossParts({ meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings, expectedVoices });
}

const voiceOf = (result: ReturnType<typeof run>, chunk: number, label: string) =>
  result.assignments.find((a) => a.chunkIndex === chunk && a.sourceSpeakerId === label)?.identityId;

describe("one-to-one matching of provider labels across parts", () => {
  // Five parts, four people, labels numbered differently in every part.
  const order = [
    [0, 1, 2, 3],
    [2, 0, 3, 1],
    [1, 3, 0, 2],
    [3, 2, 1, 0],
    [0, 3, 1, 2],
  ];
  const parts = order.map((voices, part) => voices.map((voice, index) => ({ label: `L${part}${index}`, voice })));

  it("starts from data where raw cosine cannot tell the voices apart", () => {
    const rng = random(99);
    const same = cosineSimilarity(sample(0, rng), sample(0, rng));
    const different = cosineSimilarity(sample(0, rng), sample(1, rng));
    // Real recording measured 0.74 (different labels) vs 0.82 (same label).
    expect(different).toBeGreaterThan(0.7);
    expect(same - different).toBeLessThan(0.15);
  });

  it("turns 20 labels into the 4 real voices", () => {
    const result = run(build(parts));
    expect(result.identities).toHaveLength(4);
    parts.forEach((labels, part) =>
      labels.forEach(({ label, voice }) => {
        const first = parts[0]!.find((entry) => entry.voice === voice)!;
        expect(voiceOf(result, part, label)).toBe(voiceOf(result, 0, first.label));
        expect(voiceOf(result, part, label)).toBeTruthy();
      }),
    );
  });

  it("never puts two labels of one part into the same voice", () => {
    const result = run(build(parts));
    for (let part = 0; part < parts.length; part += 1) {
      const ids = result.assignments.filter((a) => a.chunkIndex === part && a.identityId).map((a) => a.identityId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("gives a person who only appears in one part their own voice", () => {
    const withGuest = parts.map((labels, part) => (part === 2 ? [...labels, { label: "guest", voice: 4 }] : labels));
    const result = run(build(withGuest));
    expect(result.identities).toHaveLength(5);
    expect(voiceOf(result, 2, "guest")).toBeTruthy();
  });

  it("leaves a label with too few samples unresolved", () => {
    const embeddings = [...build(parts), ...build([[{ label: "brief", voice: 0 }]], 5, 1).map((e) => ({ ...e, chunkIndex: 1, sourceSpeakerId: "brief", id: "sample:1:brief:0.000:3.000", sample: { ...e.sample, chunkIndex: 1, sourceSpeakerId: "brief", id: "sample:1:brief:0.000:3.000" } }))];
    const result = run(embeddings);
    const brief = result.assignments.find((a) => a.sourceSpeakerId === "brief");
    expect(brief?.state).toBe("unresolved");
    expect(brief?.identityId).toBeNull();
    expect(result.identities).toHaveLength(4);
  });

  it("rejects evidence from another recording", () => {
    const wrong = build(parts).map((e, i) => (i === 0 ? { ...e, recordingHash: "d".repeat(64) } : e));
    expect(() => run(wrong)).toThrow(/different recording/);
  });

  describe("with the expected number of speakers", () => {
    // Part 2 has five labels for four people: one person was split in two by the provider.
    const withSplit = parts.map((labels, part) => (part === 1 ? [...labels, { label: "dup", voice: 0 }] : labels));

    it("does not guess when the number is not given", () => {
      const result = run(build(withSplit));
      const dup = result.assignments.find((a) => a.sourceSpeakerId === "dup");
      expect(dup?.identityId ?? null).toBeNull();
      expect(result.identities.length).toBeGreaterThanOrEqual(4);
    });

    it("joins the over-split label to the same person and ends with that many voices", () => {
      const result = run(build(withSplit), 4);
      expect(result.identities).toHaveLength(4);
      const first = parts[0]!.find((entry) => entry.voice === 0)!;
      expect(voiceOf(result, 1, "dup")).toBe(voiceOf(result, 0, first.label));
      // Labels of one real person still end up together.
      parts.forEach((labels, part) =>
        labels.forEach(({ label, voice }) => {
          const anchor = parts[0]!.find((entry) => entry.voice === voice)!;
          expect(voiceOf(result, part, label)).toBe(voiceOf(result, 0, anchor.label));
        }),
      );
    });

    it("never invents voices to reach a larger number than the evidence supports", () => {
      const result = run(build(parts), 9);
      expect(result.identities).toHaveLength(4);
    });

    it("rejects an invalid number", () => {
      expect(() => run(build(parts), 0)).toThrow(/whole number/);
      expect(() => run(build(parts), 2.5)).toThrow(/whole number/);
    });
  });
});

describe("which average is removed before comparing", () => {
  const parts = [
    [{ label: "A", voice: 0 }, { label: "B", voice: 1 }, { label: "C", voice: 2 }],
    [{ label: "A", voice: 1 }, { label: "B", voice: 2 }, { label: "C", voice: 0 }],
    [{ label: "A", voice: 2 }, { label: "B", voice: 0 }, { label: "C", voice: 1 }],
  ];
  const voiceByLabel = (key: string) => parts[Number(key[0])]!.find((entry) => entry.label === key.slice(2))!.voice;
  const grouping = (centre?: "samples" | "labels" | "voices") => {
    const result = matchLabelsAcrossParts(
      { meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings: build(parts) },
      undefined,
      { version: "test", withinPartMergeCosine: 0.9, floorCosine: 0.35, margin: 0.1, centre },
    );
    const groups = new Map<string, number[]>();
    for (const assignment of result.assignments) {
      groups.set(assignment.identityId ?? assignment.sourceKey, [...(groups.get(assignment.identityId ?? assignment.sourceKey) ?? []), voiceByLabel(assignment.sourceKey)]);
    }
    return [...groups.values()].map((voices) => voices.sort()).sort();
  };

  it("keeps the sample average as the default", () => {
    expect(grouping()).toEqual(grouping("samples"));
  });

  it("groups each voice across parts under every option", () => {
    for (const centre of ["samples", "labels", "voices"] as const) {
      expect(grouping(centre), centre).toEqual([[0, 0, 0], [1, 1, 1], [2, 2, 2]]);
    }
  });

  it("still places a voice that dominates the recording when each voice counts once", () => {
    // Voice 0 has two labels in every part, so it supplies half of all samples.
    const dominated = [
      [{ label: "A", voice: 0 }, { label: "A2", voice: 0 }, { label: "B", voice: 1 }, { label: "C", voice: 2 }],
      [{ label: "A", voice: 0 }, { label: "A2", voice: 0 }, { label: "B", voice: 1 }, { label: "C", voice: 2 }],
    ];
    const result = matchLabelsAcrossParts(
      { meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings: build(dominated) },
      undefined,
      { version: "test", withinPartMergeCosine: 0.9, floorCosine: 0.35, margin: 0.1, centre: "voices" },
    );
    const voiceOf = new Map(result.assignments.map((assignment) => [assignment.sourceKey, assignment.identityId]));
    expect(voiceOf.get("0:B")).toBe(voiceOf.get("1:B"));
    expect(voiceOf.get("0:C")).toBe(voiceOf.get("1:C"));
    expect(voiceOf.get("0:B")).not.toBe(voiceOf.get("0:C"));
  });
});

describe("a provider label that mixes two people", () => {
  // Six samples per label. `voices` lists the voice of each sample of the label.
  function mixedBuild(parts: { label: string; voices: number[] }[][]) {
    const rng = random(11);
    return parts.flatMap((labels, chunkIndex) =>
      labels.flatMap(({ label, voices }) => voices.map((voice, n) => record(chunkIndex, label, voice, n, rng))),
    );
  }
  const pure = (voice: number) => Array.from({ length: 6 }, () => voice);
  const rules = { version: "test", withinPartMergeCosine: 0.9, floorCosine: 0.35, margin: 0.1 };
  const match = (embeddings: AcousticEmbeddingRecord[], purityMargin?: number | null) =>
    new Map(
      matchLabelsAcrossParts({ meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings }, undefined, { ...rules, purityMargin })
        .assignments.map((assignment) => [assignment.sourceKey, assignment]),
    );

  // In part 0 the provider put three passages of voice 1 under label A, which is otherwise voice 0.
  const mixed = mixedBuild([
    [{ label: "A", voices: [0, 0, 0, 1, 1, 1] }, { label: "B", voices: pure(1) }, { label: "C", voices: pure(2) }],
    [{ label: "A", voices: pure(0) }, { label: "B", voices: pure(1) }, { label: "C", voices: pure(2) }],
  ]);

  it("leaves the mixed label ungrouped and says why", () => {
    const result = match(mixed);
    expect(result.get("0:A")).toMatchObject({ state: "conflict", identityId: null });
    expect(result.get("0:A")?.reason).toMatch(/may mix two people/);
    // The clean labels are still matched across the parts.
    expect(result.get("0:B")?.identityId).toBeTruthy();
    expect(result.get("0:B")?.identityId).toBe(result.get("1:B")?.identityId);
    expect(result.get("0:C")?.identityId).toBe(result.get("1:C")?.identityId);
    expect(result.get("1:A")?.identityId).not.toBe(result.get("1:B")?.identityId);
  });

  it("would place the mixed label in a voice when the check is turned off", () => {
    const result = match(mixed, null);
    expect(result.get("0:A")?.state).not.toBe("conflict");
  });

  it("does not flag clean labels, including one person split into two labels", () => {
    const clean = mixedBuild([
      [{ label: "A", voices: pure(0) }, { label: "A2", voices: pure(0) }, { label: "B", voices: pure(1) }, { label: "C", voices: pure(2) }],
      [{ label: "A", voices: pure(0) }, { label: "B", voices: pure(1) }, { label: "C", voices: pure(2) }],
    ]);
    expect([...match(clean).values()].filter((assignment) => assignment.state === "conflict")).toEqual([]);
  });

  it("does not judge a label with fewer than four samples", () => {
    const few = mixedBuild([
      [{ label: "A", voices: [0, 1, 1] }, { label: "B", voices: pure(1) }, { label: "C", voices: pure(2) }],
      [{ label: "A", voices: pure(0) }, { label: "B", voices: pure(1) }, { label: "C", voices: pure(2) }],
    ]);
    expect(match(few).get("0:A")?.state).not.toBe("conflict");
  });

  it("accepts a mixed-looking label when a person confirmed its speaker", () => {
    const result = matchLabelsAcrossParts(
      { meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings: mixed, constraints: { mustLink: [["0:A", "1:A"]], cannotLink: [] } },
      undefined,
      rules,
    );
    const byKey = new Map(result.assignments.map((assignment) => [assignment.sourceKey, assignment]));
    expect(byKey.get("0:A")?.state).not.toBe("conflict");
    expect(byKey.get("0:A")?.identityId).toBe(byKey.get("1:A")?.identityId);
  });
});

describe("a head count that is too small", () => {
  // Four different people, two in each part. No voice appears twice.
  const four = () => build([
    [{ label: "A", voice: 0 }, { label: "B", voice: 1 }],
    [{ label: "A", voice: 2 }, { label: "B", voice: 3 }],
  ]);

  it("does not join clearly different voices to reach the number", () => {
    const result = run(four(), 2);
    expect(result.identities).toHaveLength(4);
    expect(new Set(result.assignments.map((assignment) => assignment.identityId)).size).toBe(4);
  });

  it("joined them before this safeguard, which the replay can still reproduce", () => {
    const forced = matchLabelsAcrossParts(
      { meetingId: "meeting", recordingHash: HASH, sourceRevision: 1, embeddings: four(), expectedVoices: 2 },
      undefined,
      { version: "test", withinPartMergeCosine: 0.9, floorCosine: 0.35, margin: 0.1, headCountFloorCosine: Number.NEGATIVE_INFINITY },
    );
    expect(forced.identities).toHaveLength(2);
  });
});
