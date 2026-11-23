import { z } from "zod";
import type { Meeting, Segment } from "./model";

export const OverlapEvidenceSchema = z.object({
  source: z.string().trim().min(1).max(120).refine(s => !/\p{Cc}|\p{Cf}/u.test(s)),
  audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  intervals: z.array(z.object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
  }).strict()).min(1).max(20000),
}).strict().refine(evidence => evidence.intervals.every((interval, i, all) =>
  interval.end > interval.start && (i === 0 || interval.start >= all[i - 1]!.end)),
  "Overlap intervals must be ordered, positive and disjoint.");
export type OverlapEvidence = z.infer<typeof OverlapEvidenceSchema>;
type Audio = NonNullable<Meeting["audio"]>;

export function recordingOverlap(audio: Meeting["audio"]): OverlapEvidence | undefined {
  if (!audio) return undefined;
  const evidence = audio.overlapEvidence;
  return evidence && evidence.audioSha256 === audio.hash &&
    (!audio.chunked || audio.chunked.manifestSha256 === audio.hash) ? evidence : undefined;
}

/** Carry observations only across verified attachment of the same recording. */
export function retainRecordingOverlap(previous: Meeting["audio"], next: Audio): Audio {
  const evidence = recordingOverlap(previous);
  if (!evidence || evidence.audioSha256 !== next.hash) {
    if (!next.overlapEvidence || next.overlapEvidence.audioSha256 === next.hash) return next;
    const clean = { ...next };
    delete clean.overlapEvidence;
    return clean;
  }
  const duration = next.duration ?? previous!.duration;
  const intervals = evidence.intervals.filter(range => duration !== null && range.end <= duration);
  return { ...next, duration, overlapEvidence: intervals.length ? { ...evidence, intervals } : undefined };
}

/** First interval ending after start; touching endpoints do not overlap. */
export function detectedOverlap(evidence: OverlapEvidence | undefined, start: number | null, end?: number | null): boolean {
  if (!evidence || start === null || !Number.isFinite(start) ||
      (end !== undefined && (end === null || !Number.isFinite(end) || end <= start))) return false;
  const ranges = evidence.intervals;
  let lo = 0, hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid]!.end <= start) lo = mid + 1;
    else hi = mid;
  }
  const hit = ranges[lo];
  return !!hit && (end === undefined ? hit.start <= start : hit.start < end!);
}

/** A relationship between two working passages, independent of the middle words' identity. */
export function matchingOverlapNeighbors(m: Meeting, target: Segment, index: number): string | undefined {
  if (m.segments[index]?.id !== target.id || target.speakerIds.length ||
      !detectedOverlap(recordingOverlap(m.audio),target.start,target.end)) return undefined;
  const left = m.segments[index - 1], right = m.segments[index + 1];
  if (!left || !right || left.speakerIds.length !== 1 || right.speakerIds.length !== 1 ||
      left.speakerIds[0] !== right.speakerIds[0] || left.end === null || right.start === null ||
      left.end > target.start! || right.start < target.end!) return undefined;
  return m.speakers.find(s => s.id === left.speakerIds[0])?.name;
}
