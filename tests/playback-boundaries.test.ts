import { describe, expect, it, vi } from "vitest";
import { segment, type Segment } from "../src/domain/model";
import { speakerActivity } from "../src/domain/speaker-review";
import {
  NEXT_CAPTION_LOOKAHEAD,
  buildPlaybackCaptions,
  captionContextAtTime,
  captionsAtTime,
  fragmentsAtTime,
  playbackBoundaries,
  playbackCaptionWindowStart,
  snapToPlaybackInterval,
} from "../src/domain/playback";
import {
  COARSE_POSITION_SECONDS,
  createPlaybackClockStore,
  samePositionBucket,
} from "../src/features/usePlaybackClock";

function random(seed: number) {
  // mulberry32: deterministic, so a failure is reproducible.
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSegments(seed: number): Segment[] {
  const next = random(seed);
  const round = (value: number) => Math.round(value * 100) / 100;
  return Array.from({ length: 45 }, (_, index) => {
    const speakers = [["a"], ["b"], ["c"], ["a", "b"]][Math.floor(next() * 4)]!;
    const roll = next();
    if (roll < 0.06) return segment(`untimed ${index}`, speakers, null, null);
    const start = round(next() * 60);
    // A few zero-width segments: playback must never treat them as active speech.
    const end = roll < 0.12 ? start : round(start + 0.1 + next() * (roll > 0.9 ? 6 : 1.2));
    return segment(`word ${index}`, speakers, start, end);
  });
}

/** `tie` skips the two lookups that compare with ">" / "<=" against a derived value, which are float ties exactly on it. */
function derived(segments: Segment[], position: number, tie: boolean) {
  const captions = buildPlaybackCaptions(segments);
  return {
    current: captionsAtTime(captions, position).map((caption) => caption.id),
    context: captionContextAtTime(captions, position).map((caption) => caption.id),
    speakers: speakerActivity(segments, position).activeSpeakerIds,
    next: tie ? null : captions.find((caption) => caption.start > position + NEXT_CAPTION_LOOKAHEAD)?.id ?? null,
    fragments: captions.flatMap((caption) => caption.fragments)
      .filter((fragment) => fragmentsAtTime([fragment], position).length > 0)
      .map((fragment) => fragment.id),
    // A small limit forces the window logic to actually choose an anchor.
    windowStart: tie ? null : playbackCaptionWindowStart(captions, position, 4),
  };
}

describe("playback boundaries", () => {
  it("gives the same derived playback state for the real position and its boundary representative", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const segments = randomSegments(seed);
      const captions = buildPlaybackCaptions(segments);
      const boundaries = playbackBoundaries(segments, captions);
      // Landing exactly on a gap midpoint or a caption's lookahead point is a measure-zero tie for real playback
      // (the next sample resolves it); the representative is always strictly inside an interval.
      const ties = new Set([
        ...captions.slice(1).map((caption, index) => (captions[index]!.end + caption.start) / 2),
        ...captions.map((caption) => caption.start - NEXT_CAPTION_LOOKAHEAD),
      ]);
      const next = random(seed * 101);
      const samples = [
        ...Array.from({ length: 300 }, () => next() * 75 - 2),
        ...boundaries,
        ...boundaries.flatMap((boundary) => [boundary - 1e-4, boundary + 1e-4]),
      ];
      for (const position of samples) {
        const representative = snapToPlaybackInterval(boundaries, position);
        const tie = ties.has(position);
        expect(derived(segments, representative, tie), `seed ${seed} position ${position}`)
          .toEqual(derived(segments, position, tie));
      }
    }
  });

  it("changes the representative only when the playhead crosses a boundary", () => {
    const segments = randomSegments(11);
    const boundaries = playbackBoundaries(segments, buildPlaybackCaptions(segments));
    const seen = new Set<number>();
    let changes = 0;
    let previous: number | undefined;
    // 20 Hz sampling over the whole recording, like the playback clock.
    for (let position = 0; position < 70; position += 0.05) {
      const representative = snapToPlaybackInterval(boundaries, position);
      if (previous !== undefined && representative !== previous) changes += 1;
      previous = representative;
      seen.add(representative);
    }
    expect(boundaries).toEqual([...new Set(boundaries)].sort((a, b) => a - b));
    expect(changes).toBeLessThanOrEqual(boundaries.length);
    expect(changes).toBeLessThan(1400 / 2);
    expect(seen.size).toBeLessThanOrEqual(boundaries.length + 1);
  });

  it("handles no boundaries and positions before and after every boundary", () => {
    expect(snapToPlaybackInterval([], 12)).toBe(0);
    expect(playbackBoundaries([segment("x", ["a"], null, null)], [])).toEqual([]);
    expect(snapToPlaybackInterval([2, 4], 0)).toBeLessThan(2);
    expect(snapToPlaybackInterval([2, 4], 3)).toBe(3);
    expect(snapToPlaybackInterval([2, 4], 2)).toBe(3);
    expect(snapToPlaybackInterval([2, 4], 4)).toBeGreaterThan(4);
    expect(snapToPlaybackInterval([2, 4], 99)).toBeGreaterThan(4);
  });
});

describe("playback clock store", () => {
  it("notifies subscribers only when the position changes and stops after unsubscribe", () => {
    const store = createPlaybackClockStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getPosition()).toBe(0);
    store.set(0);
    expect(listener).not.toHaveBeenCalled();
    store.set(1.5);
    store.set(1.5);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getPosition()).toBe(1.5);
    unsubscribe();
    store.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("buckets coarse React positions so a 20 Hz clock renders about 4 times a second", () => {
    expect(samePositionBucket(1.01, 1.2)).toBe(true);
    expect(samePositionBucket(1.2, 1.26)).toBe(false);
    let republished = 0;
    let published = 0;
    for (let position = 0; position < 10; position += 0.05) {
      if (!samePositionBucket(published, position)) {
        published = position;
        republished += 1;
      }
    }
    expect(republished).toBeLessThanOrEqual(Math.ceil(10 / COARSE_POSITION_SECONDS) + 1);
    expect(republished).toBeGreaterThanOrEqual(Math.floor(10 / COARSE_POSITION_SECONDS) - 1);
  });
});
