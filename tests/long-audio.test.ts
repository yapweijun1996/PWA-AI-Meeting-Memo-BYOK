import { describe, expect, it } from "vitest";
import { splitMp3 } from "../src/audio/mp3-split";
import { mergeChunkSpeech, type ChunkSpeechInput } from "../src/domain/long-audio";
import type { normalizeSpeech } from "../src/providers/api";

type NormalizedSpeech = ReturnType<typeof normalizeSpeech>;
type SpeechSegment = NormalizedSpeech["segments"][number];

function makeSegment(id: string, text: string, start: number | null, end: number | null, speakerIds: string[] = []): SpeechSegment {
  return { id, revision: 1, start, end, speakerIds, originalText: text, text, reviewed: false, parents: [] };
}

function makeSpeech(segments: SpeechSegment[], speakers: NormalizedSpeech["speakers"] = []): NormalizedSpeech {
  return { speakers, segments, duration: 30, requestId: "request-id" };
}

function input(index: number, ownStartSeconds: number, ownDurationSeconds: number, leadInSeconds: number, speech: NormalizedSpeech): ChunkSpeechInput {
  return { chunk: { index, ownStartSeconds, ownDurationSeconds, leadInSeconds }, speech };
}

function frame(): Uint8Array {
  const data = new Uint8Array(104);
  data.set([0xff, 0xf3, 0x40, 0xc0]);
  return data;
}

function mp3FrameStream(count: number): Uint8Array {
  const result = new Uint8Array(count * 104);
  const sample = frame();
  for (let offset = 0; offset < result.length; offset += sample.length) result.set(sample, offset);
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("mergeChunkSpeech", () => {
  it("converts chunk-relative times and preserves null times", () => {
    const result = mergeChunkSpeech([
      input(0, 0, 20, 0, makeSpeech([])),
      input(1, 20, 10, 10, makeSpeech([
        makeSegment("a", "timed", 6, 7),
        makeSegment("b", "unknown", null, null),
      ])),
    ]);
    expect(result.speech.segments.map(({ start, end }) => [start, end])).toEqual([[16, 17], [null, null]]);
    expect(result.untimedSegments).toBe(1);
  });

  it("selects overlap words at the midpoint and replaces a cut word", () => {
    const result = mergeChunkSpeech([
      input(0, 0, 20, 0, makeSpeech([
        makeSegment("a", "previous-side", 14, 14.3),
        makeSegment("b", "duplicate-loser", 16, 16.2),
        makeSegment("c", "garbled-cut", 18, 18.3),
      ])),
      input(1, 20, 20, 10, makeSpeech([
        makeSegment("a", "duplicate-loser", 4, 4.2),
        makeSegment("b", "duplicate-winner", 6, 6.2),
        makeSegment("c", "complete-word", 8, 8.4),
      ])),
    ]);
    expect(result.speech.segments.map(({ text }) => text)).toEqual(["previous-side", "duplicate-winner", "complete-word"]);
    expect(result.droppedOverlapSegments).toBe(3);
  });

  it("supports the first, middle, and last chunk boundaries", () => {
    const result = mergeChunkSpeech([
      input(0, 0, 10, 0, makeSpeech([makeSegment("a", "first", 1, 1.2)])),
      input(1, 10, 10, 4, makeSpeech([makeSegment("b", "middle", 5, 5.2)])),
      input(2, 20, 10, 4, makeSpeech([makeSegment("c", "last", 6, 6.2)])),
    ]);
    expect(result.speech.segments.map(({ text }) => text)).toEqual(["first", "middle", "last"]);
    expect(result.speech.duration).toBeCloseTo(22.2);
    expect(result.speech.requestId).toBeNull();
  });

  it("keeps speakers distinct and rewrites speaker references per chunk", () => {
    const makeSpeaker = (id: string) => ({ id, name: "Speaker 1", confirmed: true, sourceLabels: ["run:1"] });
    const result = mergeChunkSpeech([
      input(0, 0, 10, 0, makeSpeech([makeSegment("a", "one", 1, 1.2, ["speaker"])], [makeSpeaker("speaker")])),
      input(1, 10, 10, 0, makeSpeech([makeSegment("b", "two", 1, 1.2, ["speaker"])], [makeSpeaker("speaker")])),
    ]);
    expect(result.speech.speakers.map(({ id }) => id)).toEqual(["part-0:speaker", "part-1:speaker"]);
    expect(new Set(result.speech.speakers.flatMap(({ sourceLabels }) => sourceLabels)).size).toBe(2);
    expect(new Set(result.speech.speakers.map(({ name }) => name)).size).toBe(2);
    expect(result.speech.speakers.every(({ confirmed }) => confirmed)).toBe(true);
    expect(result.speech.segments.map(({ speakerIds }) => speakerIds)).toEqual([["part-0:speaker"], ["part-1:speaker"]]);
  });

  it("remaps colliding segment ids and sorts by absolute time", () => {
    const result = mergeChunkSpeech([
      input(0, 0, 10, 0, makeSpeech([
        makeSegment("same", "later", 5, 5.2),
        makeSegment("first-id", "earlier", 2, 2.2),
      ])),
      input(1, 10, 10, 0, makeSpeech([
        makeSegment("same", "next", 1, 1.2),
        { ...makeSegment("child", "child", 2, 2.2), parents: ["same"] },
      ])),
    ]);
    expect(result.speech.segments.map(({ text }) => text)).toEqual(["earlier", "later", "next", "child"]);
    expect(new Set(result.speech.segments.map(({ id }) => id)).size).toBe(4);
    expect(result.speech.segments[3]?.parents).toEqual(["part-1:same"]);
  });

  it("keeps untimed segments after their chunk's timed segments and reports them", () => {
    const result = mergeChunkSpeech([
      input(0, 0, 10, 0, makeSpeech([
        makeSegment("a", "timed", 1, 1.2),
        makeSegment("b", "untimed", null, null),
      ])),
    ]);
    expect(result.speech.segments.map(({ text }) => text)).toEqual(["timed", "untimed"]);
    expect(result.untimedSegments).toBe(1);
    expect(result.notes).toHaveLength(1);
  });

  it("rejects unsorted or non-contiguous inputs without mutating them", () => {
    const first = deepFreeze(input(0, 0, 10, 0, makeSpeech([makeSegment("a", "one", 1, 1.2)])));
    const second = deepFreeze(input(1, 10, 10, 0, makeSpeech([makeSegment("b", "two", 1, 1.2)])));
    expect(() => mergeChunkSpeech([second, first])).toThrow(new RangeError("Chunk speech inputs must be sorted and contiguous."));
    expect(() => mergeChunkSpeech([first, input(1, 11, 10, 0, makeSpeech([]))])).toThrow(RangeError);
    expect(mergeChunkSpeech([first, second]).speech.segments.map(({ text }) => text)).toEqual(["one", "two"]);
  });

  it("merges known words exactly once after splitting synthetic MP3 audio", () => {
    const result = splitMp3(mp3FrameStream(1100), { targetSeconds: 5, maxBytes: 1000000, minLeadInSeconds: 10 });
    expect(result.chunks.length).toBeGreaterThan(2);
    const words = Array.from({ length: 50 }, (_, index) => ({ text: `word-${index}`, start: index * 0.5 }));
    const inputs = result.chunks.map((chunk): ChunkSpeechInput => {
      const segments = words
        .filter(({ start }) => start >= chunk.ownStartSeconds - chunk.leadInSeconds && start < chunk.ownStartSeconds + chunk.ownDurationSeconds)
        .map(({ text, start }, index) => makeSegment(`part-${chunk.index}-${index}`, text, start - chunk.ownStartSeconds + chunk.leadInSeconds, start - chunk.ownStartSeconds + chunk.leadInSeconds + 0.1));
      return { chunk, speech: makeSpeech(segments) };
    });
    const merged = mergeChunkSpeech(inputs);
    expect(merged.speech.segments.map(({ text }) => text)).toEqual(words.map(({ text }) => text));
    expect(new Set(merged.speech.segments.map(({ text }) => text)).size).toBe(words.length);
  });
});
