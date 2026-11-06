import { describe, expect, it } from "vitest";
import { segment } from "../src/domain/model";
import { buildSpeakerWindows, speakerActivity } from "../src/domain/speaker-review";
import { resolvePlaybackStatus } from "../src/features/usePlaybackClock";
import {
  buildPlaybackCaptions,
  captionsAtTime,
  captionContextAtTime,
  playbackCaptionWindow,
  playbackCaptionWindowStart,
} from "../src/domain/playback";

describe("speaker listening workspace", () => {
  it("retains only short internal caption context without activating speech or altering source", () => {
    const source = [
      segment("first word", ["a"], 0, 0.8),
      segment("next word", ["a"], 0.95, 1.2),
      segment("reply", ["b"], 1.35, 1.7),
      segment("later", ["a"], 3, 4),
      segment("untimed", ["a"], null, null),
    ];
    const before = JSON.stringify(source);
    const captions = buildPlaybackCaptions(source);
    expect(captionContextAtTime(captions, 0.85)).toEqual([captions[0]]);
    expect(captionsAtTime(captions, 0.85)).toEqual([]);
    expect(speakerActivity(source, 0.85).activeSpeakerIds).toEqual([]);
    for (const position of [0.5, 0.95, 1.25, 1.4, 2, 5])
      expect(captionContextAtTime(captions, position)).toEqual([]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("keeps buffering through a timeupdate until a real resume transition", () => {
    const waitingState = { error: false, ended: false, playing: true, position: 1 };
    expect(resolvePlaybackStatus("buffering", undefined, waitingState)).toBe("buffering");
    expect(resolvePlaybackStatus("buffering", "playing", waitingState)).toBe("playing");
    expect(resolvePlaybackStatus("buffering", "paused", { ...waitingState, playing: false })).toBe("paused");
  });

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

  it("groups readable captions without mutating source timing or inventing untimed ranges", () => {
    const first = segment("first", ["11111111-1111-4111-8111-111111111111"], 0, 0.2);
    const second = segment("second", ["11111111-1111-4111-8111-111111111111"], 0.2, 0.6);
    const shortGap = segment("after gap", ["11111111-1111-4111-8111-111111111111"], 1, 1.2);
    const gap = segment("gap", ["11111111-1111-4111-8111-111111111111"], null, null);
    const other = segment("other", ["22222222-2222-4222-8222-222222222222"], 1.6, 1.8);
    const source = [first, second, shortGap, gap, other];
    const before = JSON.stringify(source);
    const captions = buildPlaybackCaptions(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(captions).toHaveLength(3);
    expect(captions[0]).toMatchObject({ start: 0, end: 0.6, text: "first second" });
    expect(captions[0].sourceSegmentIds).toEqual([first.id, second.id]);
    expect(captionsAtTime(captions, 0.4).map((item) => item.id)).toEqual([first.id]);
    expect(captionsAtTime(captions, 0.65)).toEqual([]);
    expect(captionsAtTime(captions, 1.1).map((item) => item.id)).toEqual([shortGap.id]);
    expect(captionsAtTime(captions, 1.4)).toEqual([]);
    expect(captionsAtTime(captions, 1.6).map((item) => item.id)).toEqual([other.id]);
  });

  it("groups word timing while keeping exact source intervals authoritative", () => {
    const speaker = "11111111-1111-4111-8111-111111111111";
    const words = [
      segment("one", [speaker], 2, 2.2),
      segment("two", [speaker], 2.3, 2.5),
      segment("three", [speaker], 2.6, 2.8),
    ];
    const before = JSON.stringify(words);
    const captions = buildPlaybackCaptions(words);

    expect(JSON.stringify(words)).toBe(before);
    expect(captions).toHaveLength(1);
    expect(captions[0]).toMatchObject({
      start: 2,
      end: 2.8,
      text: "one two three",
      sourceSegmentIds: words.map((word) => word.id),
      sourceIntervals: [
        { start: 2, end: 2.2 },
        { start: 2.3, end: 2.5 },
        { start: 2.6, end: 2.8 },
      ],
    });
    expect(captionsAtTime(captions, 2)).toHaveLength(1);
    expect(captionsAtTime(captions, 2.2)).toEqual([]);
    expect(captionsAtTime(captions, 2.3)).toHaveLength(1);
    expect(captionsAtTime(captions, 2.5)).toEqual([]);
    expect(captionsAtTime(captions, 2.6)).toHaveLength(1);
    expect(captionsAtTime(captions, 2.8)).toEqual([]);
  });

  it("keeps overlaps as simultaneous captions and bounds long playback lists", () => {
    const a = segment("a", ["11111111-1111-4111-8111-111111111111"], 1, 3);
    const b = segment("b", ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"], 2, 4);
    const many = Array.from({ length: 120 }, (_, index) =>
      segment(`x${index}`, ["11111111-1111-4111-8111-111111111111"], index + 10, index + 10.1),
    );
    const captions = buildPlaybackCaptions([a, b, ...many], 20);
    expect(captionsAtTime(captions, 2.5).map((item) => item.speakerIds)).toEqual([
      ["11111111-1111-4111-8111-111111111111"],
      ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
    ]);
    expect(playbackCaptionWindow(captions, 65, 20)).toHaveLength(20);
    expect(playbackCaptionWindow(captions, 65, 20).some((item) => item.start <= 65 && item.end > 65)).toBe(true);
    expect(playbackCaptionWindowStart(captions, -1, 20)).toBe(0);
    expect(playbackCaptionWindowStart(captions, 999, 20)).toBe(captions.length - 20);
  });
});
