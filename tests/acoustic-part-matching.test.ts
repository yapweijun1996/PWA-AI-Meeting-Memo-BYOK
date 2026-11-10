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
