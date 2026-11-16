import {
  ACOUSTIC_POLICY,
  PART_MATCH_POLICY,
  cosineSimilarity,
  type AcousticEmbeddingRecord,
} from "./acoustic-speaker";
import type { Meeting } from "./model";

/**
 * Relative closeness of two voices under the uncalibrated matching policy.
 * It is a review hint for a person, not a probability or an accuracy claim.
 */
export type VoiceSuggestionBand = "high" | "medium" | "low";

export interface VoiceSampleRange {
  start: number;
  end: number;
}

export interface VoiceSuggestion {
  speakerId: string;
  /** Cosine of the two speakers' average vectors after removing the recording's average voice. */
  score: number;
  band: VoiceSuggestionBand;
  /** Both speakers have clean samples in the same recording part, which argues against one person. */
  sharesPart: boolean;
  /** Either side has fewer samples than the automatic policy needs. */
  fewSamples: boolean;
  /** A clean single-speaker sample of the candidate, in recording seconds. */
  sample: VoiceSampleRange;
}

export interface SpeakerVoiceSuggestions {
  /** A clean single-speaker sample of this speaker, in recording seconds. */
  sample: VoiceSampleRange;
  candidates: VoiceSuggestion[];
}

const OVERLAP_EPSILON = 1e-3;

function average(vectors: readonly (readonly number[])[], length: number): number[] {
  const totals = Array.from({ length }, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < length; index += 1) totals[index]! += (vector[index] ?? 0) / vectors.length;
  }
  return totals;
}

/**
 * Rank, for every current speaker, the other speakers whose saved voice vectors
 * are closest. Read-only: it never changes the meeting or the saved analysis.
 *
 * A saved sample counts for a speaker only when every current transcript
 * passage in the sample's time range is attributed to that speaker alone, so
 * merges, splits and reassignments made by a person are respected. As in
 * `matchLabelsAcrossParts`, the recording's average vector is removed first.
 * Two speakers a person confirmed separately are never suggested to each other.
 */
export function suggestVoiceMatches(
  meeting: Pick<Meeting, "speakers" | "segments" | "audio">,
  embeddings: readonly AcousticEmbeddingRecord[],
  options: { limit?: number } = {},
): Map<string, SpeakerVoiceSuggestions> {
  const result = new Map<string, SpeakerVoiceSuggestions>();
  const limit = options.limit ?? 2;
  const dimensions = ACOUSTIC_POLICY.dimensions;
  const usable = embeddings.filter(
    (embedding) =>
      embedding.recordingHash === meeting.audio?.hash &&
      embedding.values.length === dimensions &&
      embedding.values.every((value) => Number.isFinite(value)),
  );
  if (usable.length < 2 || meeting.speakers.length < 2) return result;

  const known = new Set(meeting.speakers.map((speaker) => speaker.id));
  const timed = meeting.segments.filter(
    (segment) => segment.start !== null && segment.end !== null && segment.end > segment.start,
  );
  const recordingAverage = average(usable.map((embedding) => embedding.values), dimensions);
  const bySpeaker = new Map<string, { vectors: number[][]; parts: Set<number>; samples: VoiceSampleRange[] }>();
  const seen = new Set<string>();
  for (const embedding of usable) {
    if (seen.has(embedding.id)) continue;
    seen.add(embedding.id);
    const start = embedding.sample.startSeconds;
    const end = embedding.sample.endSeconds;
    const owners = new Set<string>();
    for (const segment of timed) {
      if (segment.start! < end - OVERLAP_EPSILON && segment.end! > start + OVERLAP_EPSILON) {
        for (const speakerId of segment.speakerIds) owners.add(speakerId);
        if (!segment.speakerIds.length) owners.add("");
      }
    }
    const [owner] = [...owners];
    if (owners.size !== 1 || !owner || !known.has(owner)) continue;
    const entry = bySpeaker.get(owner) ?? { vectors: [], parts: new Set<number>(), samples: [] };
    entry.vectors.push(embedding.values.map((value, index) => value - (recordingAverage[index] ?? 0)));
    entry.parts.add(embedding.chunkIndex);
    entry.samples.push({ start, end });
    bySpeaker.set(owner, entry);
  }
  if (bySpeaker.size < 2) return result;

  const profiles = [...bySpeaker.entries()].map(([speakerId, entry]) => ({
    speakerId,
    confirmed: meeting.speakers.find((speaker) => speaker.id === speakerId)?.confirmed ?? false,
    mean: average(entry.vectors, dimensions),
    parts: entry.parts,
    count: entry.vectors.length,
    // The longest clean sample is the easiest to judge by ear.
    sample: [...entry.samples].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0]!,
  }));
  const minimum = ACOUSTIC_POLICY.minSamplesForAssignment;
  for (const profile of profiles) {
    const ranked = profiles
      .filter((other) => other.speakerId !== profile.speakerId && !(other.confirmed && profile.confirmed))
      .map((other) => ({ other, score: cosineSimilarity(profile.mean, other.mean) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score || left.other.speakerId.localeCompare(right.other.speakerId));
    const candidates: VoiceSuggestion[] = ranked
      .filter((entry) => entry.score > 0)
      .slice(0, limit)
      .map((entry, position) => {
        const sharesPart = [...entry.other.parts].some((part) => profile.parts.has(part));
        const fewSamples = profile.count < minimum || entry.other.count < minimum;
        const runnerUp = ranked[1]?.score ?? Number.NEGATIVE_INFINITY;
        const clearLead = position === 0 && entry.score - runnerUp >= PART_MATCH_POLICY.margin;
        const band: VoiceSuggestionBand =
          entry.score < PART_MATCH_POLICY.floorCosine
            ? "low"
            : clearLead && !sharesPart && !fewSamples
              ? "high"
              : "medium";
        return { speakerId: entry.other.speakerId, score: entry.score, band, sharesPart, fewSamples, sample: entry.other.sample };
      });
    result.set(profile.speakerId, { sample: profile.sample, candidates });
  }
  return result;
}
