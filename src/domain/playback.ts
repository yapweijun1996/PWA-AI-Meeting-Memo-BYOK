import type { Segment } from "./model";

export type PlaybackFragment = {
  id: string;
  start: number | null;
  end: number | null;
  speakerIds: string[];
  text: string;
  untimed: boolean;
};

export function playbackFragment(segment: Segment): PlaybackFragment {
  return {
    id: segment.id,
    start: segment.start,
    end: segment.end,
    speakerIds: [...segment.speakerIds],
    text: segment.text,
    untimed: !timed(segment),
  };
}

export function fragmentsAtTime(fragments: PlaybackFragment[], position: number) {
  return fragments.filter((fragment) => !fragment.untimed &&
    fragment.start !== null && fragment.end !== null &&
    position >= fragment.start && position < fragment.end);
}

export type PlaybackCaption = {
  id: string;
  start: number;
  end: number;
  speakerIds: string[];
  text: string;
  sourceSegmentIds: string[];
  sourceIntervals: Array<{ start: number; end: number }>;
  fragments: PlaybackFragment[];
};

function timed(segment: Segment): segment is Segment & { start: number; end: number } {
  return (
    segment.start !== null &&
    segment.end !== null &&
    Number.isFinite(segment.start) &&
    Number.isFinite(segment.end) &&
    segment.end > segment.start
  );
}

function sameSpeakers(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Groups adjacent timed source segments for readable captions without changing
 * their source ranges. Gaps remain gaps; untimed segments are deliberately
 * excluded instead of inheriting a neighbour's time.
 */
export function buildPlaybackCaptions(
  segments: Segment[],
  maxCharacters = 220,
): PlaybackCaption[] {
  const ordered = segments
    .filter(timed)
    .map((segment) => ({ segment, start: segment.start, end: segment.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const captions: PlaybackCaption[] = [];
  for (const { segment, start, end } of ordered) {
    const previous = captions.at(-1);
    const canJoin =
      previous &&
      sameSpeakers(previous.speakerIds, segment.speakerIds) &&
      start >= previous.end &&
      start - previous.end <= 0.35 &&
      previous.text.length + segment.text.length + 1 <= maxCharacters;
    if (canJoin) {
      previous.end = end;
      previous.text = `${previous.text} ${segment.text}`.trim();
      previous.sourceSegmentIds.push(segment.id);
      previous.sourceIntervals.push({ start, end });
      previous.fragments.push(playbackFragment(segment));
    } else {
      captions.push({
        id: segment.id,
        start,
        end,
        speakerIds: [...segment.speakerIds],
        text: segment.text,
        sourceSegmentIds: [segment.id],
        sourceIntervals: [{ start, end }],
        fragments: [playbackFragment(segment)],
      });
    }
  }
  return captions;
}

export function captionsAtTime(captions: PlaybackCaption[], position: number) {
  return captions.filter(
    (caption) => fragmentsAtTime(caption.fragments, position).length > 0,
  );
}

/** Readable context only: never marks a source gap as active speech. */
export function captionContextAtTime(captions: PlaybackCaption[], position: number) {
  if (captionsAtTime(captions, position).length) return [];
  return captions.filter((caption) =>
    caption.sourceIntervals.some((interval, index, intervals) => {
      const next = intervals[index + 1];
      return next && next.start - interval.end <= 0.35 &&
        position >= interval.end && position < next.start;
    }),
  );
}

export function playbackCaptionWindow(
  captions: PlaybackCaption[],
  position: number,
  limit = 80,
) {
  const size = Math.max(1, Math.floor(limit));
  if (captions.length <= size) return captions;
  const start = playbackCaptionWindowStart(captions, position, size);
  return captions.slice(start, start + size);
}

export function playbackCaptionWindowStart(
  captions: PlaybackCaption[],
  position: number,
  limit = 80,
) {
  const size = Math.max(1, Math.floor(limit));
  if (!captions.length || captions.length <= size) return 0;
  const activeIndex = captions.findIndex((caption) =>
    caption.sourceIntervals.some(
      (interval) => position >= interval.start && position < interval.end,
    ),
  );
  const nextIndex = captions.findIndex((caption) => caption.start > position);
  const anchor =
    activeIndex >= 0
      ? activeIndex
      : nextIndex < 0
        ? captions.length - 1
        : nextIndex === 0
          ? 0
          : position - captions[nextIndex - 1].end <= captions[nextIndex].start - position
            ? nextIndex - 1
            : nextIndex;
  return Math.max(
    0,
    Math.min(anchor - Math.floor(size / 2), captions.length - size),
  );
}

export function hasValidTimedSegments(segments: Segment[]) {
  return segments.some(timed);
}

/** How far ahead of a caption the "next speech" lookup switches over (see PlaybackMode). */
export const NEXT_CAPTION_LOOKAHEAD = 0.05;

/**
 * Every playhead time at which something derived from the playhead can change:
 * segment/fragment starts and ends (active speech, speakers, between-words context),
 * the next-caption lookahead, and the midpoint between neighbouring captions (the
 * rule that picks the transcript window anchor inside a gap). Between two
 * neighbouring boundaries every derived value is constant, so a consumer only
 * needs to re-render when the playhead crosses one.
 */
export function playbackBoundaries(segments: Segment[], captions: PlaybackCaption[]): number[] {
  const points = new Set<number>();
  const add = (value: number | null) => {
    if (value !== null && Number.isFinite(value)) points.add(value);
  };
  for (const segment of segments) {
    add(segment.start);
    add(segment.end);
  }
  captions.forEach((caption, index) => {
    add(caption.start - NEXT_CAPTION_LOOKAHEAD);
    const previous = captions[index - 1];
    if (previous) add((previous.end + caption.start) / 2);
  });
  return [...points].sort((a, b) => a - b);
}

/**
 * Maps a playhead time to one representative time inside the same boundary
 * interval, so everything derived from the playhead gives the same answer for
 * the representative as for the real position. The result is the interior
 * midpoint of the interval, which keeps left-closed ranges (`position >= start`)
 * and right-open ranges (`position < end`) consistent. It is a primitive, so it
 * can be a useSyncExternalStore snapshot that only changes on a boundary.
 */
export function snapToPlaybackInterval(boundaries: number[], position: number): number {
  const count = boundaries.length;
  if (count === 0) return 0;
  // First boundary strictly after the position; the position is in [boundaries[next - 1], boundaries[next]).
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (boundaries[middle]! > position) high = middle;
    else low = middle + 1;
  }
  if (low === 0) return boundaries[0]! - 1;
  if (low === count) return boundaries[count - 1]! + 1;
  return (boundaries[low - 1]! + boundaries[low]!) / 2;
}
