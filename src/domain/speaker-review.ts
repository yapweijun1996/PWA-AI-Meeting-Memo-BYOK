import type { Segment } from "./model";

export type SpeakerWindow = {
  speakerId: string;
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  segments: Segment[];
};

export type SpeakerActivity = {
  activeSpeakerIds: string[];
  hasGap: boolean;
  hasUntimed: boolean;
};

function sameSpeakers(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Build bounded, listenable windows from timed transcript passages. A window
 * may contain neighbouring speakers; `sourceStart/sourceEnd` marks the actual
 * attributed turn so the UI can state that the surrounding context is not a
 * voice-identification result.
 */
export function buildSpeakerWindows(
  segments: Segment[],
  speakerId: string,
  windowSeconds = 20,
  duration?: number | null,
  limit = 3,
): SpeakerWindow[] {
  const length = Math.max(10, Math.min(30, Math.round(windowSeconds)));
  const timed = segments
    .filter(
      (segment) =>
        segment.start !== null &&
        segment.end !== null &&
        segment.end > segment.start &&
        segment.speakerIds.includes(speakerId),
    )
    .sort((a, b) => (a.start as number) - (b.start as number));
  if (!timed.length) return [];

  const ordered = segments
    .filter(
      (segment) =>
        segment.start !== null &&
        segment.end !== null &&
        segment.end > segment.start,
    )
    .sort((a, b) => (a.start as number) - (b.start as number));
  const turns: Segment[][] = [];
  for (const segment of ordered) {
    const previous = turns.at(-1)?.at(-1);
    if (
      previous &&
      sameSpeakers(previous.speakerIds, segment.speakerIds) &&
      (segment.start as number) - (previous.end as number) <= 1.5
    ) {
      turns.at(-1)!.push(segment);
    } else turns.push([segment]);
  }

  // Three samples should cover the recording rather than three adjacent words.
  const candidates = turns.filter((turn) =>
    turn.some((segment) => segment.speakerIds.includes(speakerId)),
  );
  const chosen: Segment[][] = [];
  const stride = Math.max(1, Math.ceil(candidates.length / limit));
  for (let index = 0; index < candidates.length && chosen.length < limit; index += stride)
    chosen.push(candidates[index]);
  if (chosen.length < limit) {
    for (const turn of candidates)
      if (!chosen.includes(turn) && chosen.length < limit) chosen.push(turn);
  }

  return chosen.map((turn) => {
    const sourceStart = turn[0].start as number;
    const sourceEnd = turn.at(-1)!.end as number;
    const total = Number.isFinite(duration ?? NaN) ? (duration as number) : undefined;
    const maxEnd = total === undefined ? Number.POSITIVE_INFINITY : total;
    let start = Math.max(0, Math.min(sourceStart, maxEnd));
    let end = Math.min(maxEnd, start + length);
    if (Number.isFinite(maxEnd) && maxEnd - start < length)
      start = Math.max(0, maxEnd - length);
    end = Math.min(maxEnd, start + length);
    if (end <= start) return null;
    return {
      speakerId,
      start,
      end,
      sourceStart,
      sourceEnd,
      segments: segments
        .filter(
          (segment) =>
            segment.start !== null &&
            segment.end !== null &&
            segment.end > start &&
            segment.start < end,
        )
        .sort((a, b) => (a.start as number) - (b.start as number)),
    };
  }).filter((window): window is SpeakerWindow => window !== null);
}

export function speakerActivity(
  segments: Segment[],
  position: number,
): SpeakerActivity {
  const activeSpeakerIds = [
    ...new Set(
      segments
        .filter(
          (segment) =>
            segment.start !== null &&
            segment.end !== null &&
            position >= segment.start &&
            position < segment.end,
        )
        .flatMap((segment) => segment.speakerIds),
    ),
  ];
  const hasUntimed = segments.some(
    (segment) =>
      segment.start === null || segment.end === null,
  );
  return { activeSpeakerIds, hasGap: activeSpeakerIds.length === 0, hasUntimed };
}
