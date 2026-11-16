import { describe, expect, it } from "vitest";
import type { AcousticEmbeddingRecord } from "../src/domain/acoustic-speaker";
import { segment, type Meeting } from "../src/domain/model";
import { suggestVoiceMatches } from "../src/domain/voice-suggestions";

const HASH = "d".repeat(64);

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

/** A shared room component dominates; each voice adds a small distinct part; every sample is noisy. */
function vector(voice: number, rng: () => number): number[] {
  const values = Array.from({ length: 512 }, () => 0);
  values[0] = 3;
  values[1 + voice] = 1;
  for (let index = 10; index < 40; index += 1) values[index] = (rng() * 2 - 1) * 0.4;
  return values;
}

function record(chunkIndex: number, label: string, voice: number, start: number, length: number, rng: () => number, hash = HASH): AcousticEmbeddingRecord {
  const id = `sample:${chunkIndex}:${label}:${start.toFixed(3)}:${(start + length).toFixed(3)}`;
  return {
    id,
    meetingId: "meeting",
    recordingHash: hash,
    sourceRevision: 1,
    chunkIndex,
    sourceSpeakerId: label,
    sample: { id, chunkIndex, sourceSpeakerId: label, startSeconds: start, endSeconds: start + length, segmentIds: [] },
    modelId: "model",
    modelRevision: "revision",
    extractionVersion: "extraction",
    values: vector(voice, rng),
    createdAt: new Date().toISOString(),
  };
}

const speaker = (id: string, confirmed = false) => ({ id, name: id, confirmed, sourceLabels: [] as string[] });

/**
 * Each speaker talks in one 100-second block of one part and has three clean samples there.
 * `rows` lists [speakerId, part, voice].
 */
function fixture(rows: [string, number, number][], confirmed: string[] = []) {
  const rng = random(11);
  const speakers = rows.map(([id]) => speaker(id, confirmed.includes(id)));
  const segments = rows.map(([id], index) => segment(`s${index}`, [id], index * 100, index * 100 + 90));
  const embeddings = rows.flatMap(([id, part, voice], index) =>
    [0, 1, 2].map((n) => record(part, id, voice, index * 100 + n * 10, 2 + n, rng)),
  );
  const meeting = { speakers, segments, audio: { hash: HASH } } as unknown as Meeting;
  return { meeting, embeddings };
}

describe("voice suggestions for speaker review", () => {
  it("puts the speaker with the same voice in another part first, with a clear lead", () => {
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["b0", 0, 1], ["a1", 1, 0], ["b1", 1, 1], ["c1", 1, 2]]);
    const suggestions = suggestVoiceMatches(meeting, embeddings);
    expect(suggestions.get("a0")?.candidates[0]).toMatchObject({ speakerId: "a1", band: "high", sharesPart: false, fewSamples: false });
    expect(suggestions.get("b1")?.candidates[0]).toMatchObject({ speakerId: "b0", band: "high" });
    // The third voice has no partner: nothing reaches the pairing floor.
    expect(suggestions.get("c1")?.candidates.every((candidate) => candidate.band === "low")).toBe(true);
  });

  it("offers clean samples to play: the speaker's own and the candidate's longest", () => {
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["b0", 0, 1], ["a1", 1, 0]]);
    const a0 = suggestVoiceMatches(meeting, embeddings).get("a0")!;
    expect(a0.sample).toEqual({ start: 20, end: 24 });
    expect(a0.candidates[0]?.sample).toEqual({ start: 220, end: 224 });
  });

  it("flags and demotes a candidate that speaks in the same part", () => {
    // Two labels of one voice inside the same part: a provider over-split, or two similar people.
    // Other voices keep the recording average from being dominated by this one.
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["a0b", 0, 0], ["b0", 0, 1], ["c0", 0, 2], ["b1", 1, 1], ["c1", 1, 2]]);
    const first = suggestVoiceMatches(meeting, embeddings).get("a0")?.candidates[0];
    expect(first).toMatchObject({ speakerId: "a0b", sharesPart: true, band: "medium" });
  });

  it("never suggests two speakers a person confirmed separately", () => {
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["b0", 0, 1], ["a1", 1, 0]], ["a0", "a1"]);
    const suggestions = suggestVoiceMatches(meeting, embeddings);
    expect(suggestions.get("a0")?.candidates.some((candidate) => candidate.speakerId === "a1")).toBe(false);
    // An unconfirmed speaker may still be pointed at a confirmed one.
    expect(suggestions.get("b0")?.candidates.every((candidate) => ["a0", "a1"].includes(candidate.speakerId))).toBe(true);
  });

  it("follows the current attribution after a person merged speakers", () => {
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["b0", 0, 1], ["a1", 1, 0], ["b1", 1, 1]]);
    // A person merged a1 into a0: a1's passages now belong to a0.
    const merged = {
      ...meeting,
      speakers: meeting.speakers.filter((item) => item.id !== "a1"),
      segments: meeting.segments.map((item) => ({ ...item, speakerIds: item.speakerIds.map((id) => (id === "a1" ? "a0" : id)) })),
    } as Meeting;
    const suggestions = suggestVoiceMatches(merged, embeddings);
    expect(suggestions.has("a1")).toBe(false);
    expect(suggestions.get("b0")?.candidates[0]?.speakerId).toBe("b1");
    expect(suggestions.get("a0")?.candidates.every((candidate) => candidate.band === "low")).toBe(true);
  });

  it("ignores a sample whose time range now covers two speakers", () => {
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["b0", 0, 1], ["a1", 1, 0]]);
    const overlapped = {
      ...meeting,
      segments: [...meeting.segments, segment("extra", ["b0"], 200, 290)],
    } as Meeting;
    // Every a1 sample (200–224 s) now overlaps a b0 passage, so a1 has no clean evidence left.
    expect(suggestVoiceMatches(overlapped, embeddings).has("a1")).toBe(false);
  });

  it("marks thin evidence and does not call it a strong match", () => {
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["b0", 0, 1], ["a1", 1, 0], ["b1", 1, 1]]);
    const thin = embeddings.filter((embedding) => embedding.sourceSpeakerId !== "a1" || embedding.sample.startSeconds === 200);
    const first = suggestVoiceMatches(meeting, thin).get("a0")?.candidates[0];
    expect(first).toMatchObject({ speakerId: "a1", fewSamples: true });
    expect(first?.band).not.toBe("high");
  });

  it("returns nothing without comparable evidence", () => {
    const { meeting, embeddings } = fixture([["a0", 0, 0], ["b0", 0, 1]]);
    expect(suggestVoiceMatches(meeting, []).size).toBe(0);
    expect(suggestVoiceMatches(meeting, embeddings.filter((embedding) => embedding.sourceSpeakerId === "a0")).size).toBe(0);
    // Vectors of another recording are not evidence for this one.
    const other = embeddings.map((embedding) => ({ ...embedding, recordingHash: "f".repeat(64) }));
    expect(suggestVoiceMatches(meeting, other).size).toBe(0);
  });
});
