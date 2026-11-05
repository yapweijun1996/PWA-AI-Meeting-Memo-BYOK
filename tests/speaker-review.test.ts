import { describe, expect, it } from "vitest";
import { segment } from "../src/domain/model";
import { buildSpeakerWindows, speakerActivity } from "../src/domain/speaker-review";

describe("speaker listening workspace", () => {
  it("builds bounded windows from distinct turns instead of individual words", () => {
    const first = segment("hello", ["11111111-1111-4111-8111-111111111111"], 0, 0.4);
    const second = segment("there", ["11111111-1111-4111-8111-111111111111"], 0.4, 1.2);
    const other = segment("reply", ["22222222-2222-4222-8222-222222222222"], 8, 10);
    const third = segment("again", ["11111111-1111-4111-8111-111111111111"], 14, 16);
    const windows = buildSpeakerWindows(
      [first, second, other, third],
      "11111111-1111-4111-8111-111111111111",
      20,
      30,
    );
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows[0].start).toBe(0);
    expect(windows[0].end).toBe(20);
    expect(windows[0].segments).toContain(other);
    expect(windows[0].sourceEnd).toBe(1.2);
  });

  it("reports overlap and gaps without inventing a speaker", () => {
    const a = segment("a", ["11111111-1111-4111-8111-111111111111"], 1, 3);
    const b = segment(
      "b",
      ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
      2, 4,
    );
    const overlap = speakerActivity([a, b], 2.5);
    expect(overlap.activeSpeakerIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(speakerActivity([a], 5).hasGap).toBe(true);
  });

  it("caps the requested window at the recording end and keeps interjections separate", () => {
    const speaker = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const first = segment("first", [speaker], 0, 40);
    const interjection = segment("aside", [other], 40.2, 41);
    const second = segment("second", [speaker], 41.2, 42);
    const windows = buildSpeakerWindows(
      [first, interjection, second],
      speaker,
      20,
      45,
    );
    expect(windows[0].end - windows[0].start).toBe(20);
    expect(windows[0].sourceEnd).toBe(40);
    expect(windows.at(-1)!.end).toBe(45);
    expect(windows.at(-1)!.end).toBeLessThanOrEqual(45);
  });
});
