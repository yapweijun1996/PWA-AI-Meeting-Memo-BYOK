import { describe, expect, it } from "vitest";
import type { Segment } from "../src/domain/model";
import { groupTranscript } from "../src/domain/transcript-groups";

function fragment(id: string, text: string, start: number | null, end: number | null, speakerIds = ["a"]): Segment {
  return { id, text, originalText: text, start, end, speakerIds, revision: 1, reviewed: false, parents: [] };
}

describe("transcript reading groups", () => {
  it("groups consecutive words and punctuation without changing their source", () => {
    const input = [fragment("1", "Hello", 0, 0.2), fragment("2", ",", 0.2, 0.3), fragment("3", "world", 0.3, 0.6), fragment("4", "!", 0.6, 0.7), fragment("5", "Next", 0.7, 1)];
    const before = structuredClone(input);
    const groups = groupTranscript(input);
    expect(groups.map((group) => group.text)).toEqual(["Hello, world!", "Next"]);
    expect(groups[0].segments.map((segment) => segment.id)).toEqual(["1", "2", "3", "4"]);
    expect(input).toEqual(before);
  });

  it("preserves Chinese text and separates gaps, overlap, speakers and unknown time", () => {
    const input = [fragment("1", "你好", 0, 0.2), fragment("2", "世界", 0.2, 0.4), fragment("3", "gap", 2, 2.2), fragment("4", "overlap", 2.1, 2.3), fragment("5", "other", 2.3, 2.5, ["b"]), fragment("6", "unknown", null, null, ["b"])];
    expect(groupTranscript(input).map((group) => group.text)).toEqual(["你好世界", "gap", "overlap", "other", "unknown"]);
  });

  it("keeps all source IDs in a long word-level transcript", () => {
    const input = Array.from({ length: 7217 }, (_, index) => fragment(String(index), "word", index, index + 0.5));
    const groups = groupTranscript(input);
    expect(groups.length).toBeLessThan(300);
    expect(groups.flatMap((group) => group.segments.map((segment) => segment.id))).toEqual(input.map((segment) => segment.id));
  });
});
