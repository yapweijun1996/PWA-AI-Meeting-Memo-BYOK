import type { NormalizedSpeech } from "../providers/api";
import { editMeeting, remapVoiceDecisions } from "./operations";
import { ref, type Meeting } from "./model";

export const MAX_EXPECTED_SPEAKERS = 50;

export function isValidExpectedSpeakerCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= MAX_EXPECTED_SPEAKERS;
}

/**
 * The anonymous, meeting-scoped acoustic policy. These values are intentionally
 * uncalibrated; they are a conservative starting point for local evaluation,
 * not an accuracy claim.
 */
export const ACOUSTIC_POLICY = {
  version: "wavlm-sv-uncalibrated-v1",
  /**
   * How a voice vector is produced (window decode, 16 kHz mono, model input).
   * Separate from `version`, which names the decision thresholds: recalibrating
   * thresholds must not discard saved vectors. Change this only when the audio
   * preparation or model input changes. v2 (2026-11-16): band-limited 16 kHz
   * conversion replaced linear interpolation, so earlier vectors are recomputed.
   */
  extractionVersion: "wavlm-sv-bandlimited-16k-v2",
  calibrationStatus: "uncalibrated",
  modelId: "Xenova/wavlm-base-plus-sv",
  modelRevision: "e61029603001bd11295c36d878698708bf59190f",
  dimensions: 512,
  minSampleSeconds: 1.5,
  maxSampleSeconds: 4,
  /** Raised from 3 on 2026-11-16: single samples are noisy, so a label's average needs more of them. */
  maxSamplesPerPart: 6,
  minSamplesForAssignment: 2,
  acceptCosine: 0.86,
  acceptMargin: 0.06,
  conflictCosine: 0.72,
  maxRepresentativesPerIdentity: 8,
  maxResidentEmbeddings: 64,
} as const;

export type AcousticPolicy = typeof ACOUSTIC_POLICY & {
  acceptCosine: number;
  acceptMargin: number;
  conflictCosine: number;
  minSamplesForAssignment: number;
};

export type AcousticAssignmentState =
  | "matched"
  | "new_identity"
  | "ambiguous"
  | "unresolved"
  | "conflict"
  | "stale";

export type AcousticCheckpointState =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed_local"
  | "storage_exhausted"
  | "stale";

export interface AcousticSourcePart {
  index: number;
  ownStartSeconds: number;
  ownDurationSeconds: number;
  leadInSeconds: number;
}

export interface AcousticSampleWindow {
  id: string;
  chunkIndex: number;
  sourceSpeakerId: string;
  startSeconds: number;
  endSeconds: number;
  segmentIds: string[];
}

export interface AcousticSampleSelection {
  samples: AcousticSampleWindow[];
  excluded: number;
}

export interface AcousticEmbeddingRecord {
  id: string;
  meetingId: string;
  recordingHash: string;
  sourceRevision: number;
  chunkIndex: number;
  sourceSpeakerId: string;
  sample: AcousticSampleWindow;
  modelId: string;
  modelRevision: string;
  extractionVersion: string;
  values: number[];
  createdAt: string;
}

export interface AcousticIdentity {
  id: string;
  meetingId: string;
  recordingHash: string;
  sourceRevision: number;
  modelRevision: string;
  extractionVersion: string;
  centroid: number[];
  /** Stable seed vectors used to prevent centroid drift across many parts. */
  anchors: number[][];
  representativeEmbeddingIds: string[];
  sourceKeys: string[];
  sourceCount: number;
  sampleCount: number;
  /** Set only by an explicit human mapping; never inferred from a name. */
  confirmedSpeakerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcousticCandidateScore {
  identityId: string;
  mean: number;
  minimum: number;
  support: number;
}

export interface AcousticAssignment {
  id: string;
  meetingId: string;
  recordingHash: string;
  sourceRevision: number;
  sourceKey: string;
  chunkIndex: number;
  sourceSpeakerId: string;
  state: AcousticAssignmentState;
  identityId: string | null;
  scores: AcousticCandidateScore[];
  evidenceEmbeddingIds: string[];
  reason: string;
  thresholdVersion: string;
  calibrationStatus: "uncalibrated" | "calibrated";
  updatedAt: string;
}

export interface AcousticCheckpoint {
  id: string;
  meetingId: string;
  recordingHash: string;
  sourceRevision: number;
  modelId: string;
  modelRevision: string;
  extractionVersion: string;
  thresholdVersion: string;
  calibrationStatus: "uncalibrated" | "calibrated";
  state: AcousticCheckpointState;
  nextChunkIndex: number;
  nextSpeakerKey: string | null;
  completedChunkCount: number;
  lastCompletedChunkIndex: number | null;
  processedEmbeddingCount: number;
  error: string | null;
  updatedAt: string;
}

type SpeechSegment = NormalizedSpeech["segments"][number];

export interface AcousticChunkInput {
  chunk: AcousticSourcePart;
  speech: Pick<NormalizedSpeech, "segments">;
}

const DEFAULT_MAX_GAP_SECONDS = 0.35;
/**
 * Stay this far inside a long provider turn. Turn edges are where the provider's
 * speaker change is least exact, so they are the likeliest place for another voice.
 */
const EDGE_TRIM_SECONDS = 0.25;
const SAMPLE_EPSILON = 1e-6;

function validRange(start: number | null, end: number | null): start is number {
  return (
    start !== null &&
    end !== null &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end - start >= SAMPLE_EPSILON
  );
}

function absoluteRange(segment: SpeechSegment, chunk: AcousticSourcePart) {
  if (!validRange(segment.start, segment.end) || segment.start === null || segment.end === null) return null;
  const offset = chunk.ownStartSeconds - chunk.leadInSeconds;
  return { start: offset + segment.start, end: offset + segment.end };
}

function withinOwnRange(
  range: { start: number; end: number },
  chunk: AcousticSourcePart,
): boolean {
  const ownEnd = chunk.ownStartSeconds + chunk.ownDurationSeconds;
  // Anything in the lead-in is duplicate boundary evidence and is not a clean
  // sample for identity continuity.
  return (
    range.start >= chunk.ownStartSeconds - SAMPLE_EPSILON &&
    range.end <= ownEnd + SAMPLE_EPSILON &&
    range.end > range.start
  );
}

function sampleId(
  chunkIndex: number,
  sourceSpeakerId: string,
  startSeconds: number,
  endSeconds: number,
): string {
  return [
    "sample",
    chunkIndex,
    sourceSpeakerId,
    startSeconds.toFixed(3),
    endSeconds.toFixed(3),
  ].join(":");
}

/**
 * Select clean bounded windows from provider segments. It only considers
 * single-speaker, timed segments in the chunk's own interval. Lead-in overlap,
 * unknown time, multi-speaker ranges and duplicate windows are excluded.
 */
export function selectAcousticSamples(
  inputs: readonly AcousticChunkInput[],
  options: {
    minSampleSeconds?: number;
    maxSampleSeconds?: number;
    maxSamplesPerPart?: number;
    maxGapSeconds?: number;
  } = {},
): AcousticSampleSelection {
  const minSampleSeconds = options.minSampleSeconds ?? ACOUSTIC_POLICY.minSampleSeconds;
  const maxSampleSeconds = options.maxSampleSeconds ?? ACOUSTIC_POLICY.maxSampleSeconds;
  const maxSamplesPerPart = options.maxSamplesPerPart ?? ACOUSTIC_POLICY.maxSamplesPerPart;
  const maxGapSeconds = options.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS;
  if (
    !Number.isFinite(minSampleSeconds) ||
    minSampleSeconds <= 0 ||
    !Number.isFinite(maxSampleSeconds) ||
    maxSampleSeconds < minSampleSeconds ||
    !Number.isInteger(maxSamplesPerPart) ||
    maxSamplesPerPart < 1 ||
    !Number.isFinite(maxGapSeconds) ||
    maxGapSeconds < 0
  ) {
    throw new RangeError("Invalid acoustic sample selection options.");
  }

  const samples: AcousticSampleWindow[] = [];
  let excluded = 0;
  for (const input of inputs) {
    const ownEnd = input.chunk.ownStartSeconds + input.chunk.ownDurationSeconds;
    const timedIntervals: { range: { start: number; end: number }; speakerIds: string[] }[] = [];
    const bySpeaker = new Map<
      string,
      { range: { start: number; end: number }; segmentIds: string[] }[]
    >();
    for (const segment of input.speech.segments) {
      const range = absoluteRange(segment, input.chunk);
      if (range && range.end > input.chunk.ownStartSeconds && range.start < ownEnd) {
        timedIntervals.push({ range, speakerIds: [...segment.speakerIds] });
      }
      if (segment.speakerIds.length !== 1 || !range || !withinOwnRange(range, input.chunk)) {
        excluded += 1;
        continue;
      }
      const sourceSpeakerId = segment.speakerIds[0];
      if (!sourceSpeakerId) {
        excluded += 1;
        continue;
      }
      const values = bySpeaker.get(sourceSpeakerId) ?? [];
      values.push({ range, segmentIds: [segment.id] });
      bySpeaker.set(sourceSpeakerId, values);
    }

    for (const [sourceSpeakerId, ranges] of bySpeaker) {
      ranges.sort((left, right) => left.range.start - right.range.start);
      // `slice` is the window's position inside its turn: 0 for the first window.
      const candidates: { range: { start: number; end: number }; segmentIds: string[]; slice: number }[] = [];
      // Long provider turns are the cleanest evidence.
      for (const value of ranges) {
        const turnLength = value.range.end - value.range.start;
        const trim = turnLength >= minSampleSeconds + 2 * EDGE_TRIM_SECONDS ? EDGE_TRIM_SECONDS : 0;
        const turnStart = value.range.start + trim;
        const turnEnd = value.range.end - trim;
        // A long clean turn can provide independent windows. Do not reuse the
        // same first four seconds for every sample or a continuous monologue
        // can never reach the multi-sample policy.
        let slice = 0;
        for (
          let start = turnStart;
          start + minSampleSeconds <= turnEnd + SAMPLE_EPSILON;
          start += maxSampleSeconds
        ) {
          const end = Math.min(turnEnd, start + maxSampleSeconds);
          if (end - start < minSampleSeconds) break;
          candidates.push({ range: { start, end }, segmentIds: [...value.segmentIds], slice });
          slice += 1;
        }
      }
      // When a speaker has brief turns, combine only adjacent turns from that
      // same provider label. We never cross another attributed speaker or the
      // chunk's own boundary.
      for (let index = 0; index < ranges.length; index += 1) {
        const first = ranges[index];
        if (!first) continue;
        let end = first.range.end;
        const segmentIds = [...first.segmentIds];
        for (let next = index + 1; next < ranges.length; next += 1) {
          const current = ranges[next];
          if (!current || current.range.start - end > maxGapSeconds) break;
          if (current.range.end - first.range.start > maxSampleSeconds) break;
          end = current.range.end;
          segmentIds.push(...current.segmentIds);
          if (end - first.range.start >= minSampleSeconds) {
            candidates.push({
              range: { start: first.range.start, end },
              segmentIds: [...segmentIds],
              slice: 0,
            });
            break;
          }
        }
      }
      const seen = new Set<string>();
      const selected: AcousticSampleWindow[] = [];
      // Take one window from each turn before a second window from any turn, so the
      // samples are spread over the part instead of being slices of one monologue.
      candidates
        .sort(
          (left, right) =>
            left.slice - right.slice ||
            right.range.end - right.range.start - (left.range.end - left.range.start) ||
            left.range.start - right.range.start,
        )
        .forEach((candidate) => {
          const start = Math.max(input.chunk.ownStartSeconds, candidate.range.start);
          const end = Math.min(
            input.chunk.ownStartSeconds + input.chunk.ownDurationSeconds,
            candidate.range.end,
          );
          if (end - start < minSampleSeconds) return;
          const hasOtherTimedEvidence = timedIntervals.some((interval) =>
            interval.range.start < end && interval.range.end > start &&
            (interval.speakerIds.length !== 1 || interval.speakerIds[0] !== sourceSpeakerId),
          );
          if (hasOtherTimedEvidence) {
            excluded += 1;
            return;
          }
          const id = sampleId(input.chunk.index, sourceSpeakerId, start, end);
          if (seen.has(id)) return;
          seen.add(id);
          // Prefer independent turns. Overlapping alternatives are redundant
          // evidence and should not inflate support counts.
          if (
            selected.some(
              (existing) => start < existing.endSeconds && end > existing.startSeconds,
            )
          )
            return;
          selected.push({
            id,
            chunkIndex: input.chunk.index,
            sourceSpeakerId,
            startSeconds: start,
            endSeconds: end,
            segmentIds: [...candidate.segmentIds],
          });
        });
      samples.push(...selected.slice(0, maxSamplesPerPart));
    }
  }
  samples.sort(
    (left, right) =>
      left.chunkIndex - right.chunkIndex ||
      left.startSeconds - right.startSeconds ||
      left.sourceSpeakerId.localeCompare(right.sourceSpeakerId),
  );
  return { samples, excluded };
}

export function acousticSourceKey(chunkIndex: number, sourceSpeakerId: string): string {
  return `${chunkIndex}:${sourceSpeakerId}`;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return Number.NaN;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? Number.NaN;
    const b = right[index] ?? Number.NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return Number.NaN;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function normalizeEmbedding(
  values: readonly number[],
  dimensions: number = ACOUSTIC_POLICY.dimensions,
): number[] {
  if (values.length !== dimensions || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding must contain ${dimensions} finite values.`);
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
    throw new Error("Embedding has zero magnitude.");
  }
  return values.map((value) => value / norm);
}

function mean(values: readonly number[][]): number[] {
  const first = values[0];
  if (!first) throw new Error("At least one embedding is required.");
  const totals = Array.from({ length: first.length }, () => 0);
  for (const value of values) {
    if (value.length !== first.length) throw new Error("Embedding dimensions do not match.");
    value.forEach((entry, index) => {
      totals[index] = (totals[index] ?? 0) + entry;
    });
  }
  return normalizeEmbedding(totals.map((value) => value / values.length), first.length);
}

function identityId(): string {
  // Meeting speakers use the shared UUID transcript-key contract. The
  // meeting-scoped identity store already carries the anonymous voice role;
  // adding a non-key prefix here would make the derived speaker unpersistable.
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface AcousticAssignmentResult {
  assignment: Omit<AcousticAssignment, "id" | "updatedAt">;
  identity?: AcousticIdentity;
}

/**
 * Compare independent samples for one provider speaker against existing
 * meeting identities. A single high score never forces a merge. Existing
 * human mappings are carried on their identity and are not overwritten.
 */
export function chooseAcousticAssignment(
  input: {
    meetingId: string;
    recordingHash: string;
    sourceRevision: number;
    chunkIndex: number;
    sourceSpeakerId: string;
    embeddings: readonly AcousticEmbeddingRecord[];
    expectedModelId?: string;
    expectedModelRevision?: string;
    expectedExtractionVersion?: string;
  },
  identities: readonly AcousticIdentity[],
  policy: AcousticPolicy = ACOUSTIC_POLICY,
): AcousticAssignmentResult {
  const uniqueEmbeddings = new Map<string, AcousticEmbeddingRecord>();
  const expectedModelId = input.expectedModelId ?? policy.modelId;
  const expectedModelRevision = input.expectedModelRevision ?? policy.modelRevision;
  for (const embedding of input.embeddings) {
    const sameContext =
      embedding.meetingId === input.meetingId &&
      embedding.recordingHash === input.recordingHash &&
      embedding.sourceRevision === input.sourceRevision &&
      embedding.chunkIndex === input.chunkIndex &&
      embedding.sourceSpeakerId === input.sourceSpeakerId &&
      embedding.modelId === expectedModelId &&
      embedding.modelRevision === expectedModelRevision &&
      (input.expectedExtractionVersion === undefined || embedding.extractionVersion === input.expectedExtractionVersion);
    if (!sameContext) {
      throw new Error("Acoustic evidence belongs to a different meeting, recording, revision, or source speaker.");
    }
    if (embedding.values.length !== policy.dimensions || embedding.values.some((value) => !Number.isFinite(value))) {
      throw new Error("Acoustic evidence has an invalid model dimension or non-finite value.");
    }
    const previous = uniqueEmbeddings.get(embedding.id);
    if (previous && JSON.stringify(previous.values) !== JSON.stringify(embedding.values)) {
      throw new Error("Duplicate acoustic evidence has conflicting vectors.");
    }
    uniqueEmbeddings.set(embedding.id, embedding);
  }
  const evidence = [...uniqueEmbeddings.values()];
  const evidenceEmbeddingIds = evidence.map((embedding) => embedding.id);
  const sourceKey = acousticSourceKey(input.chunkIndex, input.sourceSpeakerId);
  const base = {
    meetingId: input.meetingId,
    recordingHash: input.recordingHash,
    sourceRevision: input.sourceRevision,
    sourceKey,
    chunkIndex: input.chunkIndex,
    sourceSpeakerId: input.sourceSpeakerId,
    evidenceEmbeddingIds,
    thresholdVersion: policy.version,
    calibrationStatus: policy.calibrationStatus as "uncalibrated" | "calibrated",
  };
  const pairwise = evidence.flatMap((left, leftIndex) =>
    evidence.slice(leftIndex + 1).map((right) => cosineSimilarity(left.values, right.values)),
  );
  const selfConsistency = pairwise.length ? Math.min(...pairwise) : 1;
  if (pairwise.some((score) => !Number.isFinite(score) || score < policy.conflictCosine)) {
    return {
      assignment: {
        ...base,
        state: "conflict",
        identityId: null,
        scores: [],
        reason: "Independent acoustic samples contradict one another; no identity was forced.",
      },
    };
  }
  if (evidence.length < policy.minSamplesForAssignment) {
    return {
      assignment: {
        ...base,
        state: "unresolved",
        identityId: null,
        scores: [],
        reason: "Not enough independent acoustic samples for an automatic association.",
      },
    };
  }
  // A pair of samples that is merely above the contradiction floor is not
  // enough to establish a prototype. Keep the result explicit rather than
  // creating a new identity from evidence in the uncalibrated middle band.
  if (selfConsistency < policy.acceptCosine) {
    return {
      assignment: {
        ...base,
        state: "ambiguous",
        identityId: null,
        scores: [],
        reason: "Independent acoustic samples are not cohesive enough for an automatic identity decision.",
      },
    };
  }
  const eligibleIdentities = identities.filter(
    (identity) =>
      identity.meetingId === input.meetingId &&
      identity.recordingHash === input.recordingHash &&
      identity.sourceRevision === input.sourceRevision &&
      identity.modelRevision === expectedModelRevision &&
      (input.expectedExtractionVersion === undefined || identity.extractionVersion === input.expectedExtractionVersion) &&
      identity.centroid.length === policy.dimensions &&
      identity.centroid.every((value) => Number.isFinite(value)),
  );
  const scores: AcousticCandidateScore[] = eligibleIdentities
    .map((identity) => {
      const anchors = identity.anchors.length ? identity.anchors : [identity.centroid];
      const values = evidence.map((embedding) =>
        // Always retain a fixed seed anchor. Matching only a drifting centroid
        // or one newly-added representative would permit transitive false
        // merges across a long meeting.
        cosineSimilarity(embedding.values, anchors[0]!),
      );
      const finite = values.filter((value) => Number.isFinite(value));
      const support = finite.filter((value) => value >= policy.acceptCosine).length;
      return {
        identityId: identity.id,
        mean: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN,
        minimum: finite.length ? Math.min(...finite) : Number.NaN,
        support,
      };
    })
    .filter((score) => Number.isFinite(score.mean) && Number.isFinite(score.minimum))
    .sort((left, right) => right.mean - left.mean || right.minimum - left.minimum);
  const best = scores[0];
  const runnerUp = scores[1];
  const margin = best && runnerUp ? best.mean - runnerUp.mean : Number.POSITIVE_INFINITY;
  const bestIsAcceptable = Boolean(
    best &&
      best.support >= policy.minSamplesForAssignment &&
      best.minimum >= policy.acceptCosine,
  );
  if (bestIsAcceptable && best && margin >= policy.acceptMargin) {
    return {
      assignment: {
        ...base,
        state: "matched",
        identityId: best.identityId,
        scores,
        reason: "Multiple independent samples support one meeting-scoped identity.",
      },
    };
  }
  if (bestIsAcceptable && best && runnerUp && margin < policy.acceptMargin) {
    return {
      assignment: {
        ...base,
        state: "ambiguous",
        identityId: null,
        scores,
        reason: "The leading acoustic candidates are too close to choose safely.",
      },
    };
  }
  const timestamp = now();
  const identity: AcousticIdentity = {
    id: identityId(),
    meetingId: input.meetingId,
    recordingHash: input.recordingHash,
    sourceRevision: input.sourceRevision,
    modelRevision: input.embeddings[0]?.modelRevision ?? policy.modelRevision,
    extractionVersion: input.embeddings[0]?.extractionVersion ?? policy.extractionVersion,
    centroid: mean(evidence.map((embedding) => embedding.values)),
    anchors: evidence
      .slice(0, policy.maxRepresentativesPerIdentity)
      .map((embedding) => [...embedding.values]),
    representativeEmbeddingIds: evidence
      .slice(0, policy.maxRepresentativesPerIdentity)
      .map((embedding) => embedding.id),
    sourceKeys: [sourceKey],
    sourceCount: 1,
    sampleCount: evidence.length,
    confirmedSpeakerId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    assignment: {
      ...base,
      state: "new_identity",
      identityId: identity.id,
      scores,
      reason: "No existing identity met the automatic association policy; a new anonymous identity was created.",
    },
    identity,
  };
}

export interface RecordingClusterResult {
  identities: AcousticIdentity[];
  assignments: Omit<AcousticAssignment, "id" | "updatedAt">[];
}

function crossSimilarity(
  left: readonly AcousticEmbeddingRecord[],
  right: readonly AcousticEmbeddingRecord[],
  threshold: number,
): { mean: number; minimum: number; support: number } {
  const scores = left.flatMap((a) => right.map((b) => cosineSimilarity(a.values, b.values)));
  if (!scores.length || scores.some((score) => !Number.isFinite(score))) {
    return { mean: Number.NaN, minimum: Number.NaN, support: 0 };
  }
  return {
    mean: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    minimum: Math.min(...scores),
    support: scores.filter((score) => score >= threshold).length,
  };
}

/**
 * Group the provider speaker labels of ONE recording by voice. A provider can
 * split one person into several labels; this joins labels only when every
 * cross-label sample pair clears the acceptance cosine and the whole group is
 * mutually consistent. Anything short of that (too few samples, contradiction,
 * a chain where A~B and A~C but B!~C) is left unmerged and reported, never
 * forced. Names, labels and transcript words are not used as evidence.
 */
export function clusterRecordingSources(
  input: {
    meetingId: string;
    recordingHash: string;
    sourceRevision: number;
    embeddings: readonly AcousticEmbeddingRecord[];
  },
  policy: AcousticPolicy = ACOUSTIC_POLICY,
): RecordingClusterResult {
  const bySource = new Map<string, AcousticEmbeddingRecord[]>();
  for (const embedding of input.embeddings) {
    const list = bySource.get(embedding.sourceSpeakerId) ?? [];
    list.push(embedding);
    bySource.set(embedding.sourceSpeakerId, list);
  }
  const firstStart = (list: readonly AcousticEmbeddingRecord[]) =>
    Math.min(...list.map((embedding) => embedding.sample.startSeconds));
  const sources = [...bySource.entries()].sort(
    (left, right) => firstStart(left[1]) - firstStart(right[1]) || left[0].localeCompare(right[0]),
  );

  const assignments: RecordingClusterResult["assignments"] = [];
  const identities: AcousticIdentity[] = [];
  const ready: {
    speakerId: string;
    evidence: AcousticEmbeddingRecord[];
    assignment: AcousticAssignmentResult["assignment"];
    identity: AcousticIdentity;
  }[] = [];
  for (const [sourceSpeakerId, list] of sources) {
    const first = list[0];
    if (!first) continue;
    // Reuse the per-label gate (validation, self-consistency, minimum samples).
    const result = chooseAcousticAssignment(
      {
        meetingId: input.meetingId,
        recordingHash: input.recordingHash,
        sourceRevision: input.sourceRevision,
        chunkIndex: first.chunkIndex,
        sourceSpeakerId,
        embeddings: list,
        expectedModelId: first.modelId,
        expectedModelRevision: first.modelRevision,
        expectedExtractionVersion: first.extractionVersion,
      },
      [],
      policy,
    );
    if (!result.identity) {
      assignments.push(result.assignment);
      continue;
    }
    const ids = new Set(result.assignment.evidenceEmbeddingIds);
    const evidence = [...new Map(list.filter((e) => ids.has(e.id)).map((e) => [e.id, e])).values()];
    ready.push({ speakerId: sourceSpeakerId, evidence, assignment: result.assignment, identity: result.identity });
  }

  const mergeable = (a: number, b: number): boolean => {
    const left = ready[a];
    const right = ready[b];
    if (!left || !right) return false;
    const score = crossSimilarity(left.evidence, right.evidence, policy.acceptCosine);
    return Number.isFinite(score.minimum) && score.minimum >= policy.acceptCosine;
  };
  const visited = new Set<number>();
  for (let start = 0; start < ready.length; start += 1) {
    if (visited.has(start)) continue;
    // Connected component over "mergeable" edges.
    const component: number[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (let other = 0; other < ready.length; other += 1) {
        if (!visited.has(other) && mergeable(current, other)) {
          visited.add(other);
          stack.push(other);
        }
      }
    }
    component.sort((left, right) => left - right);
    const members = component.map((index) => ready[index]!);
    if (members.length === 1) {
      const only = members[0]!;
      identities.push(only.identity);
      assignments.push(only.assignment);
      continue;
    }
    const isClique = component.every((a, i) => component.slice(i + 1).every((b) => mergeable(a, b)));
    if (!isClique) {
      for (const member of members) {
        assignments.push({
          ...member.assignment,
          state: "ambiguous",
          identityId: null,
          scores: [],
          reason: "This provider label resembles more than one other label, and those labels do not resemble each other; no merge was forced.",
        });
      }
      continue;
    }
    const all = members.flatMap((member) => member.evidence);
    const head = members[0]!;
    const merged: AcousticIdentity = {
      ...head.identity,
      centroid: mean(all.map((embedding) => embedding.values)),
      anchors: all.slice(0, policy.maxRepresentativesPerIdentity).map((embedding) => [...embedding.values]),
      representativeEmbeddingIds: all.slice(0, policy.maxRepresentativesPerIdentity).map((embedding) => embedding.id),
      sourceKeys: members.map((member) => member.assignment.sourceKey).slice(0, 64),
      sourceCount: members.length,
      sampleCount: all.length,
    };
    identities.push(merged);
    members.forEach((member, position) => {
      const score = position === 0 ? undefined : crossSimilarity(head.evidence, member.evidence, policy.acceptCosine);
      assignments.push({
        ...member.assignment,
        state: position === 0 ? "new_identity" : "matched",
        identityId: merged.id,
        scores: score ? [{ identityId: merged.id, mean: score.mean, minimum: score.minimum, support: score.support }] : [],
        reason: "Independent acoustic samples from different provider labels in this recording are mutually consistent; they were grouped as one anonymous voice.",
      });
    });
  }
  assignments.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  return { identities, assignments };
}

/**
 * Rules for matching provider labels across the parts of one recording, on
 * vectors with the recording's average voice removed. Uncalibrated starting
 * values chosen from one real recording (see docs/ACOUSTIC-SPEAKER-CONTINUITY.md);
 * they must be measured on more meeting audio before any accuracy claim.
 */
export interface PartMatchRules {
  version: string;
  withinPartMergeCosine: number;
  floorCosine: number;
  margin: number;
  /**
   * Which average is removed from every vector before comparing.
   * - "samples": the average of all samples (the default, and the only one with
   *   an observation on a real recording). A person with more samples pulls it
   *   toward their own voice.
   * - "labels": the average of label averages, so each label counts once.
   * - "voices": group once with "labels", then use the average of the voices
   *   found, so each voice counts once however many parts it speaks in.
   * The alternatives exist to be measured (`scripts/evaluate-voice-matching.mjs
   * --replay`); do not change the default without a result on real recordings.
   */
  centre?: "samples" | "labels" | "voices";
  /**
   * A label is treated as mixing two people when at least two of its samples are
   * closer, by this much, to another label of the same part than to the label's
   * own other samples, while at least two samples are not. `null` turns the
   * check off. Uncalibrated.
   */
  purityMargin?: number | null;
  /**
   * With a head count, voices are joined only while they are at least this
   * similar. Zero means "no less alike than two unrelated voices of this
   * recording", so a wrong count cannot join clearly different voices.
   */
  headCountFloorCosine?: number;
}

/** A label needs this many samples before its purity can be judged (two on each side). */
const MIN_SAMPLES_FOR_PURITY = 4;

export const PART_MATCH_POLICY = {
  version: `${ACOUSTIC_POLICY.version}+one-to-one-centered-v3`,
  purityMargin: 0.2,
  headCountFloorCosine: 0,
  /** Two labels in one part join only when their averages are nearly identical. */
  withinPartMergeCosine: 0.9,
  /** Least similarity between a label and a voice for them to be paired. */
  floorCosine: 0.35,
  /** Required lead over the label's next-best voice, otherwise it stays ambiguous. */
  margin: 0.1,
} as const;

function averageVector(vectors: readonly (readonly number[])[]): number[] {
  const first = vectors[0];
  const totals = Array.from({ length: first?.length ?? 0 }, () => 0);
  for (const vector of vectors) vector.forEach((value, index) => { totals[index] = (totals[index] ?? 0) + value / vectors.length; });
  return totals;
}

interface MatchUnit {
  chunkIndex: number;
  labels: string[];
  /** Source keys ("part:label") of the labels, for human constraints. */
  keys: string[];
  /** Indexes of the human-confirmed groups these labels belong to. */
  groups: Set<number>;
  evidence: AcousticEmbeddingRecord[];
  mean: number[];
}

/**
 * What a person established by listening, expressed on provider labels
 * ("part:label" source keys). These are hard constraints: similarity never
 * overrides them. See `buildVoiceConstraints`.
 */
export interface VoiceConstraints {
  /** Each group holds labels that belong to one human-confirmed speaker. */
  mustLink: readonly (readonly string[])[];
  /** Pairs of labels that belong to different people. */
  cannotLink: readonly (readonly [string, string])[];
}

/**
 * Match provider labels across the parts of ONE recording. The recording's
 * average vector is subtracted first so a shared room/channel component does
 * not make everyone look alike. Within a part, labels are different people
 * unless their averages are nearly identical. Across parts each unit is paired
 * with at most one voice per part, best pairs first; a unit with no pair above
 * the floor starts a new voice. A unit near two voices, or one whose best voice
 * was taken by a better match, is not placed and says why. Labels with too few
 * samples are left out.
 */
export function matchLabelsAcrossParts(
  input: {
    meetingId: string;
    recordingHash: string;
    sourceRevision: number;
    embeddings: readonly AcousticEmbeddingRecord[];
    /**
     * Optional, supplied by a person: how many people spoke. When set, voices are
     * grouped further, most similar first, until that many remain. Labels that share
     * a part are avoided as partners but may still be joined, because a provider
     * can split one person into two labels.
     */
    expectedVoices?: number;
    /** Optional, from a person's review: labels that must or must not share a voice. */
    constraints?: VoiceConstraints;
  },
  policy: AcousticPolicy = ACOUSTIC_POLICY,
  rules: PartMatchRules = PART_MATCH_POLICY,
  /** Internal: the vector to remove, when a first pass has already chosen it. */
  centreOverride?: readonly number[],
): RecordingClusterResult {
  if (rules.centre === "voices" && !centreOverride) {
    const firstPass = matchLabelsAcrossParts(input, policy, { ...rules, centre: "labels" });
    const byLabel = new Map<string, number[][]>();
    for (const embedding of input.embeddings) {
      const key = acousticSourceKey(embedding.chunkIndex, embedding.sourceSpeakerId);
      byLabel.set(key, [...(byLabel.get(key) ?? []), embedding.values]);
    }
    const labelMean = (key: string) => averageVector(byLabel.get(key)!);
    const placed = new Set<string>();
    const voiceMeans = firstPass.identities
      .map((identity) => identity.sourceKeys.filter((key) => byLabel.has(key)))
      .filter((keys) => keys.length > 0)
      .map((keys) => {
        keys.forEach((key) => placed.add(key));
        return averageVector(keys.map(labelMean));
      });
    // A label the first pass did not place counts as a voice of its own.
    const unplaced = [...byLabel.keys()].filter((key) => !placed.has(key)).map(labelMean);
    if (!voiceMeans.length && !unplaced.length) return firstPass;
    return matchLabelsAcrossParts(input, policy, rules, averageVector([...voiceMeans, ...unplaced]));
  }
  const groupOf = new Map<string, number>();
  (input.constraints?.mustLink ?? []).forEach((group, index) => group.forEach((key) => groupOf.set(key, index)));
  const forbiddenPairs = new Set<string>();
  for (const [left, right] of input.constraints?.cannotLink ?? []) {
    forbiddenPairs.add(`${left}\u0000${right}`);
    forbiddenPairs.add(`${right}\u0000${left}`);
  }
  const forbidden = (left: readonly string[], right: readonly string[]) =>
    forbiddenPairs.size > 0 && left.some((a) => right.some((b) => forbiddenPairs.has(`${a}\u0000${b}`)));
  const base = (embedding: AcousticEmbeddingRecord, evidence: readonly AcousticEmbeddingRecord[]) => ({
    meetingId: input.meetingId,
    recordingHash: input.recordingHash,
    sourceRevision: input.sourceRevision,
    sourceKey: acousticSourceKey(embedding.chunkIndex, embedding.sourceSpeakerId),
    chunkIndex: embedding.chunkIndex,
    sourceSpeakerId: embedding.sourceSpeakerId,
    evidenceEmbeddingIds: evidence.map((entry) => entry.id),
    thresholdVersion: rules.version,
    calibrationStatus: policy.calibrationStatus as "uncalibrated" | "calibrated",
  });
  const assignments: RecordingClusterResult["assignments"] = [];
  const state = (
    evidence: readonly AcousticEmbeddingRecord[],
    value: Exclude<AcousticAssignmentState, "matched" | "new_identity" | "stale">,
    reason: string,
  ) => assignments.push({ ...base(evidence[0]!, evidence), state: value, identityId: null, scores: [], reason });

  // 1. Group and validate; remove the recording's average vector.
  const grouped = new Map<string, AcousticEmbeddingRecord[]>();
  for (const embedding of input.embeddings) {
    if (
      embedding.meetingId !== input.meetingId ||
      embedding.recordingHash !== input.recordingHash ||
      embedding.sourceRevision !== input.sourceRevision ||
      embedding.values.length !== policy.dimensions ||
      embedding.values.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Acoustic evidence belongs to a different recording or has an invalid vector.");
    }
    const key = acousticSourceKey(embedding.chunkIndex, embedding.sourceSpeakerId);
    grouped.set(key, [...(grouped.get(key) ?? []), embedding]);
  }
  if (!grouped.size) return { identities: [], assignments: [] };
  const recordingAverage =
    centreOverride ??
    (rules.centre === "labels"
      ? averageVector([...grouped.values()].map((list) => averageVector(list.map((embedding) => embedding.values))))
      : averageVector([...grouped.values()].flat().map((embedding) => embedding.values)));
  const centered = (values: readonly number[]) => values.map((value, index) => value - (recordingAverage[index] ?? 0));
  const labels = [...grouped.values()]
    .map((list) => [...new Map(list.map((entry) => [entry.id, entry])).values()])
    .sort(
      (left, right) =>
        left[0]!.chunkIndex - right[0]!.chunkIndex ||
        Math.min(...left.map((e) => e.sample.startSeconds)) - Math.min(...right.map((e) => e.sample.startSeconds)) ||
        left[0]!.sourceSpeakerId.localeCompare(right[0]!.sourceSpeakerId),
    );
  const byPart = new Map<number, { evidence: AcousticEmbeddingRecord[]; mean: number[] }[]>();
  for (const evidence of labels) {
    if (evidence.length < policy.minSamplesForAssignment) {
      state(evidence, "unresolved", "Not enough independent acoustic samples for an automatic association.");
      continue;
    }
    const chunkIndex = evidence[0]!.chunkIndex;
    byPart.set(chunkIndex, [
      ...(byPart.get(chunkIndex) ?? []),
      { evidence, mean: averageVector(evidence.map((entry) => centered(entry.values))) },
    ]);
  }

  // 1b. Leave out a label whose samples disagree about who is speaking. A provider can put
  // two people under one label; averaging them would give a point between both voices.
  const purityMargin = rules.purityMargin === undefined ? PART_MATCH_POLICY.purityMargin : rules.purityMargin;
  if (purityMargin !== null) {
    for (const [chunkIndex, partLabels] of byPart) {
      if (partLabels.length < 2) continue;
      const mixed = new Set<number>();
      partLabels.forEach((label, index) => {
        if (label.evidence.length < MIN_SAMPLES_FOR_PURITY) return;
        // A person confirmed this label's speaker: their judgement stands.
        if (groupOf.has(acousticSourceKey(chunkIndex, label.evidence[0]!.sourceSpeakerId))) return;
        const samples = label.evidence.map((entry) => centered(entry.values));
        let foreign = 0;
        samples.forEach((sample, position) => {
          const own = cosineSimilarity(sample, averageVector(samples.filter((_, other) => other !== position)));
          const other = Math.max(
            ...partLabels.filter((_, otherIndex) => otherIndex !== index).map((entry) => cosineSimilarity(sample, entry.mean)),
          );
          if (Number.isFinite(own) && Number.isFinite(other) && other - own >= purityMargin) foreign += 1;
        });
        if (foreign >= 2 && samples.length - foreign >= 2) mixed.add(index);
      });
      if (!mixed.size) continue;
      for (const index of mixed) {
        state(
          partLabels[index]!.evidence,
          "conflict",
          "Some samples under this provider label sound like another speaker in the same part. The label may mix two people, so it was not grouped.",
        );
      }
      byPart.set(chunkIndex, partLabels.filter((_, index) => !mixed.has(index)));
    }
  }

  // 2. Inside a part, join labels whose averages are nearly identical (one person over-split).
  const units: MatchUnit[] = [];
  for (const [chunkIndex, partLabels] of [...byPart.entries()].sort((a, b) => a[0] - b[0])) {
    const parent = partLabels.map((_, index) => index);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    const keyAt = (index: number) => acousticSourceKey(chunkIndex, partLabels[index]!.evidence[0]!.sourceSpeakerId);
    const agree = (a: number, b: number) => {
      const left = keyAt(a);
      const right = keyAt(b);
      if (forbidden([left], [right])) return false;
      if (groupOf.has(left) && groupOf.get(left) === groupOf.get(right)) return true;
      return cosineSimilarity(partLabels[a]!.mean, partLabels[b]!.mean) >= rules.withinPartMergeCosine;
    };
    for (let a = 0; a < partLabels.length; a += 1) {
      for (let b = a + 1; b < partLabels.length; b += 1) if (agree(a, b)) parent[find(b)] = find(a);
    }
    const groups = new Map<number, number[]>();
    partLabels.forEach((_, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), index]));
    for (const members of groups.values()) {
      if (!members.every((a, i) => members.slice(i + 1).every((b) => agree(a, b)))) {
        for (const index of members) state(partLabels[index]!.evidence, "ambiguous", "This label resembles more than one other label in its part, and those labels do not resemble each other.");
        continue;
      }
      const evidence = members.flatMap((index) => partLabels[index]!.evidence);
      const keys = members.map(keyAt);
      units.push({
        chunkIndex,
        labels: members.map((index) => partLabels[index]!.evidence[0]!.sourceSpeakerId),
        keys,
        groups: new Set(keys.flatMap((key) => (groupOf.has(key) ? [groupOf.get(key)!] : []))),
        evidence,
        mean: averageVector(evidence.map((entry) => centered(entry.values))),
      });
    }
  }

  // 3. Across parts: one voice per unit, one unit per voice per part, best pairs first.
  interface Voice { id: string; members: { unit: MatchUnit; score: number; human?: boolean }[]; centroid: number[] }
  const voices: Voice[] = [];
  const voiceKeys = (voice: Voice) => voice.members.flatMap((member) => member.unit.keys);
  const sharesGroup = (groups: ReadonlySet<number>, voice: Voice) =>
    groups.size > 0 && voice.members.some((member) => [...member.unit.groups].some((group) => groups.has(group)));
  const expected = input.expectedVoices;
  if (expected !== undefined && !isValidExpectedSpeakerCount(expected)) {
    throw new RangeError(`The expected number of speakers must be a whole number from 1 to ${MAX_EXPECTED_SPEAKERS}.`);
  }
  const deferLeftovers = expected !== undefined;
  const deferred: MatchUnit[] = [];
  const newVoice = (unit: MatchUnit): Voice => ({ id: crypto.randomUUID(), members: [{ unit, score: 1 }], centroid: unit.mean });
  const labelEvidence = (unit: MatchUnit, label: string) => unit.evidence.filter((entry) => entry.sourceSpeakerId === label);
  for (const chunkIndex of [...new Set(units.map((unit) => unit.chunkIndex))].sort((a, b) => a - b)) {
    const partUnits = units.filter((unit) => unit.chunkIndex === chunkIndex);
    if (!voices.length) {
      partUnits.forEach((unit) => voices.push(newVoice(unit)));
      continue;
    }
    const existing = [...voices];
    // A voice holding a label this unit must stay apart from is not a candidate at all.
    const similarity = partUnits.map((unit) =>
      existing.map((voice) => (forbidden(unit.keys, voiceKeys(voice)) ? Number.NaN : cosineSimilarity(unit.mean, voice.centroid))),
    );
    const takenUnits = new Set<number>();
    const takenVoices = new Set<number>();
    const placed: { unit: MatchUnit; voice: Voice; score: number; human?: boolean }[] = [];
    // A unit a person confirmed as the speaker of an existing voice joins it first, whatever the similarity.
    partUnits.forEach((unit, u) => {
      const v = existing.findIndex((voice, index) => !takenVoices.has(index) && sharesGroup(unit.groups, voice));
      if (v < 0) return;
      takenUnits.add(u);
      takenVoices.add(v);
      placed.push({ unit, voice: existing[v]!, score: cosineSimilarity(unit.mean, existing[v]!.centroid), human: true });
    });
    const leaveAmbiguous = (unit: MatchUnit, reason: string) => {
      if (deferLeftovers) deferred.push(unit);
      else for (const label of unit.labels) state(labelEvidence(unit, label), "ambiguous", reason);
    };
    const contenders = existing.map(() => [] as { unit: MatchUnit; score: number }[]);
    partUnits.forEach((unit, u) => {
      if (takenUnits.has(u)) return;
      const ranked = similarity[u]!
        .map((score, v) => ({ score, v }))
        .filter(({ score }) => Number.isFinite(score))
        .sort((left, right) => right.score - left.score);
      const best = ranked[0];
      if (!best || best.score < rules.floorCosine) {
        voices.push(newVoice(unit));
      } else if (ranked[1] && best.score - ranked[1].score < rules.margin) {
        leaveAmbiguous(unit, "The leading voices are too close to choose safely.");
      } else if (takenVoices.has(best.v)) {
        leaveAmbiguous(unit, "A human-confirmed label in this part already holds the closest voice.");
      } else {
        contenders[best.v]!.push({ unit, score: best.score });
      }
    });
    // A voice is awarded only among labels that independently prefer it.
    // Otherwise the ordering of two labels can turn a tie into an assignment.
    contenders.forEach((entries, v) => {
      entries.sort((left, right) => right.score - left.score);
      const winner = entries[0];
      if (!winner) return;
      const clear = !entries[1] || winner.score - entries[1].score >= rules.margin;
      for (const contender of entries) {
        if (clear && contender === winner) placed.push({ ...contender, voice: existing[v]! });
        else leaveAmbiguous(contender.unit, clear
          ? "A better-matching label in this part already holds the closest voice."
          : "Two labels in this part compete for the same voice without a clear lead.");
      }
    });
    // Apply the part's placements together so earlier pairs do not shift later ones.
    for (const { unit, voice, score, human } of placed) {
      voice.members.push({ unit, score, human });
      voice.centroid = averageVector(voice.members.map((member) => member.unit.mean));
    }
  }

  const joinVoices = (keepIndex: number, dropIndex: number, human: boolean) => {
    const keep = voices[keepIndex]!;
    const drop = voices[dropIndex]!;
    keep.members.push(...drop.members.map((member) => ({ unit: member.unit, score: -1, human: human || member.human })));
    keep.centroid = averageVector(keep.members.map((member) => member.unit.mean));
    voices.splice(dropIndex, 1);
  };
  // Voices that hold labels of one human-confirmed speaker are one voice.
  if (groupOf.size) {
    for (let a = 0; a < voices.length; a += 1) {
      for (let b = a + 1; b < voices.length; b += 1) {
        const groups = new Set(voices[b]!.members.flatMap((member) => [...member.unit.groups]));
        if (!sharesGroup(groups, voices[a]!) || forbidden(voiceKeys(voices[a]!), voiceKeys(voices[b]!))) continue;
        joinVoices(a, b, true);
        b -= 1;
      }
    }
  }

  if (expected !== undefined) {
    for (const unit of deferred) voices.push(newVoice(unit));
    // Group further, most similar first, until the expected number remain or no pair is
    // similar enough. The head count is a person's estimate: it justifies joining voices
    // the similarity rules left apart, but not voices that are plainly unlike each other.
    // Voices that share a part are penalised, not forbidden (a provider can over-split one person).
    const headCountFloor = rules.headCountFloorCosine ?? PART_MATCH_POLICY.headCountFloorCosine;
    const partsOf = (voice: Voice) => new Set(voice.members.map((member) => member.unit.chunkIndex));
    const SHARED_PART_PENALTY = 0.5;
    while (voices.length > expected) {
      let best: { a: number; b: number; value: number } | undefined;
      for (let a = 0; a < voices.length; a += 1) {
        for (let b = a + 1; b < voices.length; b += 1) {
          const score = cosineSimilarity(voices[a]!.centroid, voices[b]!.centroid);
          if (!Number.isFinite(score) || score < headCountFloor) continue;
          // A head count never joins voices a person judged to be different people.
          if (forbidden(voiceKeys(voices[a]!), voiceKeys(voices[b]!))) continue;
          const shared = [...partsOf(voices[a]!)].some((part) => partsOf(voices[b]!).has(part));
          const value = score - (shared ? SHARED_PART_PENALTY : 0);
          if (!best || value > best.value) best = { a, b, value };
        }
      }
      if (!best) break;
      joinVoices(best.a, best.b, false);
    }
  }
  if (expected !== undefined || groupOf.size) {
    for (const voice of voices) {
      // Report each joined label's similarity to its final voice.
      voice.members = voice.members.map((member, position) => ({
        ...member,
        score: position === 0 ? 1 : cosineSimilarity(member.unit.mean, voice.centroid),
      }));
    }
  }

  // 4. Persistable voices and assignments.
  const identities: AcousticIdentity[] = [];
  const timestamp = now();
  for (const voice of voices) {
    const all = voice.members.flatMap((member) => member.unit.evidence);
    const first = all[0]!;
    const sourceKeys = [...new Set(all.map((entry) => acousticSourceKey(entry.chunkIndex, entry.sourceSpeakerId)))];
    identities.push({
      id: voice.id,
      meetingId: input.meetingId,
      recordingHash: input.recordingHash,
      sourceRevision: input.sourceRevision,
      modelRevision: first.modelRevision,
      extractionVersion: first.extractionVersion,
      centroid: mean(all.map((entry) => entry.values)),
      anchors: all.slice(0, policy.maxRepresentativesPerIdentity).map((entry) => [...entry.values]),
      representativeEmbeddingIds: all.slice(0, policy.maxRepresentativesPerIdentity).map((entry) => entry.id),
      sourceKeys: sourceKeys.slice(0, 64),
      sourceCount: sourceKeys.length,
      sampleCount: all.length,
      confirmedSpeakerId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    voice.members.forEach((member, position) => {
      for (const label of member.unit.labels) {
        const evidence = labelEvidence(member.unit, label);
        assignments.push({
          ...base(evidence[0]!, evidence),
          state: position === 0 ? "new_identity" : "matched",
          identityId: voice.id,
          scores: position === 0 ? [] : [{ identityId: voice.id, mean: member.score, minimum: member.score, support: evidence.length }],
          reason: position === 0
            ? "First label of a new anonymous voice in this recording."
            : member.human
              ? "Joined this voice because a person confirmed these passages as one speaker."
            : expected !== undefined
              ? "Joined this voice by acoustic similarity, including grouping to reach the expected number of speakers."
              : "Paired one-to-one with this voice using acoustic similarity and a clear lead over the next candidate.",
        });
      }
    });
  }
  assignments.sort((left, right) => left.chunkIndex - right.chunkIndex || left.sourceKey.localeCompare(right.sourceKey));
  return { identities, assignments };
}

export function updateAcousticIdentity(
  identity: AcousticIdentity,
  embeddings: readonly AcousticEmbeddingRecord[],
  policy: AcousticPolicy = ACOUSTIC_POLICY,
): AcousticIdentity {
  if (!embeddings.length) return identity;
  const values = [identity.centroid, ...embeddings.map((embedding) => embedding.values)];
  const representativeEmbeddingIds = [
    ...identity.representativeEmbeddingIds,
    ...embeddings.map((embedding) => embedding.id),
  ].slice(-policy.maxRepresentativesPerIdentity);
  return {
    ...identity,
    centroid: mean(values),
    anchors: identity.anchors.length
      ? identity.anchors.map((anchor) => [...anchor])
      : [identity.centroid.map((value) => value)],
    representativeEmbeddingIds,
    sourceKeys: [...new Set([...identity.sourceKeys, ...embeddings.map((embedding) => acousticSourceKey(embedding.chunkIndex, embedding.sourceSpeakerId))])].slice(-64),
    sourceCount:
      identity.sourceCount +
      new Set(embeddings.map((embedding) => acousticSourceKey(embedding.chunkIndex, embedding.sourceSpeakerId))).size,
    sampleCount: identity.sampleCount + embeddings.length,
    updatedAt: now(),
  };
}

/** Speaker ID used by merged chunked transcripts for a provider label in one part. */
function partSourceId(assignment: AcousticAssignment): string {
  return `part-${assignment.chunkIndex}:${assignment.sourceSpeakerId}`;
}

/** A projected voice cannot replace distinct speakers active at the same time. */
function withholdOverlappingMerges(speech: NormalizedSpeech, accepted: Map<string, string>): void {
  const sourcesPerTarget = new Map<string, number>();
  for (const { id } of speech.speakers) {
    const target = accepted.get(id) ?? id;
    sourcesPerTarget.set(target, (sourcesPerTarget.get(target) ?? 0) + 1);
  }
  const merging = new Set([...sourcesPerTarget].filter(([, count]) => count > 1).map(([target]) => target));
  if (!merging.size) return;
  const conflicted = new Set<string>();
  const active = new Map<string, { source: string; end: number }>();
  const ordered = [...speech.segments].sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
  for (const segment of ordered) {
    const inPassage = new Set<string>();
    for (const source of new Set(segment.speakerIds)) {
      const target = accepted.get(source) ?? source;
      if (!merging.has(target) || conflicted.has(target)) continue;
      if (inPassage.has(target)) conflicted.add(target);
      inPassage.add(target);
      if (segment.start === null || segment.end === null || segment.end <= segment.start) continue;
      const previous = active.get(target);
      if (previous && previous.source !== source && previous.end > segment.start) conflicted.add(target);
      // A short nested passage must not erase a longer active interval.
      if (!previous || segment.end > previous.end) active.set(target, { source, end: segment.end });
    }
  }
  for (const [source, target] of accepted) {
    if (conflicted.has(target)) accepted.delete(source);
  }
}

/**
 * Apply only persisted, non-ambiguous anonymous assignments to the merged
 * transcript projection. Raw provider speaker IDs remain in the paged source
 * records; unresolved/overlap assignments keep their part-scoped IDs.
 */
export function applyAcousticAssignments(
  speech: NormalizedSpeech,
  assignments: readonly AcousticAssignment[],
  identities: readonly AcousticIdentity[],
  confirmedSpeakers: readonly { id: string; name: string; confirmed: boolean; sourceLabels: string[] }[] = [],
  context?: { recordingHash: string; sourceRevision: number },
  sourceIdOf: (assignment: AcousticAssignment) => string = partSourceId,
  /** Current speaker id -> original source labels, for speakers an earlier run already re-keyed. */
  aliases: ReadonlyMap<string, readonly string[]> = new Map(),
): NormalizedSpeech {
  const accepted = new Map<string, string>();
  const confirmedSourceIds = new Set([
    ...speech.speakers.filter((speaker) => speaker.confirmed).map((speaker) => speaker.id),
    ...confirmedSpeakers
      .filter((speaker) => speaker.confirmed)
      .flatMap((speaker) => [speaker.id, ...speaker.sourceLabels]),
  ]);
  const usable = (assignment: AcousticAssignment) =>
    (assignment.state === "matched" || assignment.state === "new_identity") &&
    Boolean(assignment.identityId) &&
    !(context && (assignment.recordingHash !== context.recordingHash || assignment.sourceRevision !== context.sourceRevision));
  // A human-confirmed speaker that shares a voice with other labels absorbs them,
  // so a confirmed name follows its voice across parts. Two different confirmed
  // speakers in one voice mean the human distinguished them: that voice is not applied.
  const humansInVoice = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!usable(assignment)) continue;
    const sourceId = sourceIdOf(assignment);
    const human = [...speech.speakers, ...confirmedSpeakers].find(
      (speaker) => speaker.confirmed && (speaker.id === sourceId || speaker.id === assignment.sourceSpeakerId),
    );
    if (human) humansInVoice.set(assignment.identityId!, new Set([...(humansInVoice.get(assignment.identityId!) ?? []), human.id]));
  }
  // A confirmed speaker an earlier run re-keyed still belongs to the voices of its original labels.
  const assignmentBySource = new Map(assignments.filter(usable).map((assignment) => [sourceIdOf(assignment), assignment]));
  for (const speaker of [...speech.speakers, ...confirmedSpeakers]) {
    if (!speaker.confirmed) continue;
    for (const source of aliases.get(speaker.id) ?? []) {
      const assignment = assignmentBySource.get(source);
      if (assignment) humansInVoice.set(assignment.identityId!, new Set([...(humansInVoice.get(assignment.identityId!) ?? []), speaker.id]));
    }
  }
  for (const assignment of assignments) {
    if (!usable(assignment)) continue;
    const sourceId = sourceIdOf(assignment);
    if (confirmedSourceIds.has(sourceId) || confirmedSourceIds.has(assignment.sourceSpeakerId)) continue;
    const identity = identities.find((candidate) => candidate.id === assignment.identityId);
    if (!identity) continue;
    if (context && (identity.recordingHash !== context.recordingHash || identity.sourceRevision !== context.sourceRevision)) continue;
    const humans = humansInVoice.get(assignment.identityId!);
    if (humans && humans.size > 1) continue;
    const humanTarget = humans?.size === 1 ? [...humans][0] : undefined;
    accepted.set(sourceId, humanTarget ?? identity.confirmedSpeakerId ?? assignment.identityId!);
  }
  // A speaker an earlier run already re-keyed follows its original labels' decision,
  // but only when every one of those labels is decided to the same voice.
  for (const [alias, sources] of aliases) {
    if (confirmedSourceIds.has(alias) || accepted.has(alias)) continue;
    const targets = new Set(sources.map((source) => accepted.get(source)));
    const [target] = [...targets];
    if (targets.size === 1 && target && target !== alias) accepted.set(alias, target);
  }
  withholdOverlappingMerges(speech, accepted);
  if (!accepted.size) return speech;
  const speakersById = new Map<string, typeof speech.speakers[number]>();
  for (const speaker of speech.speakers) {
    const targetId = accepted.get(speaker.id) ?? speaker.id;
    const confirmed = confirmedSpeakers.find((candidate) => candidate.id === targetId);
    const candidate = {
      ...(confirmed ?? speaker),
      id: targetId,
      name: confirmed?.name ?? speaker.name,
      sourceLabels: [...new Set([...(confirmed?.sourceLabels ?? []), ...speaker.sourceLabels])].slice(0, 100),
    };
    const existing = speakersById.get(targetId);
    if (existing) {
      speakersById.set(targetId, {
        ...existing,
        sourceLabels: [...new Set([...existing.sourceLabels, ...candidate.sourceLabels])].slice(0, 100),
      });
    } else {
      speakersById.set(targetId, candidate);
    }
  }
  const segments = speech.segments.map((segment) => ({
    ...segment,
    speakerIds: [...new Set(segment.speakerIds.map((speakerId) => accepted.get(speakerId) ?? speakerId))],
  }));
  return {
    ...speech,
    speakers: [...speakersById.values()],
    segments,
  };
}

/** Resolve the acoustic anchor against the final projection after label grouping. */
export function applyRecoveredTurnAnchors(segments: NormalizedSpeech["segments"], anchors: ReadonlyMap<string, string>) {
  if (!anchors.size) return segments;
  const byId = new Map(segments.map(s => [s.id, s]));
  return segments.map((s, index) => {
    const anchorId = anchors.get(s.id);
    const anchor = anchorId ? byId.get(anchorId) : undefined;
    if (!anchor || anchor.speakerIds.length !== 1 || s.speakerIds.length || s.reviewed) return s;
    const [speaker] = anchor.speakerIds;
    const adjacent = [segments[index - 1], segments[index + 1]];
    if (adjacent.some(turn => turn?.speakerIds.some(id => id !== speaker))) return s;
    return { ...s, speakerIds: [speaker!] };
  });
}

/** Apply only speaker attribution changes to the current meeting projection. */
export function applyAcousticAssignmentsToMeeting(
  meeting: Meeting,
  assignments: readonly AcousticAssignment[],
  identities: readonly AcousticIdentity[],
  sourceIdOf?: (assignment: AcousticAssignment) => string,
  recoveredTurns?: ReadonlyMap<string, string>,
): Meeting {
  const projection: NormalizedSpeech = {
    speakers: meeting.speakers,
    segments: meeting.segments,
    duration: meeting.audio?.duration ?? null,
    requestId: null,
  };
  // Speakers re-keyed by an earlier run lost their original label id. Recover it
  // from the immutable provider run, but only when every one of the speaker's
  // current segments has a provider original (a segment a human moved in from elsewhere is
  // still compared, so a mixed speaker only follows when all its origins agree).
  const aliases = new Map<string, string[]>();
  const latestRun = [...meeting.runs].reverse().find((run) => run.originalSegments.length > 0);
  if (latestRun) {
    const original = new Map(latestRun.originalSegments.map((segment) => [segment.id, segment.speakerIds]));
    const origins = new Map<string, Set<string>>();
    const comparable = new Map<string, number>();
    const total = new Map<string, number>();
    for (const segment of meeting.segments) {
      for (const id of segment.speakerIds) total.set(id, (total.get(id) ?? 0) + 1);
      const source = original.get(segment.id);
      if (segment.speakerIds.length !== 1 || !source || source.length !== 1) continue;
      const current = segment.speakerIds[0]!;
      comparable.set(current, (comparable.get(current) ?? 0) + 1);
      origins.set(current, new Set([...(origins.get(current) ?? []), source[0]!]));
    }
    for (const [current, sources] of origins) {
      // Alias only when every segment of this speaker has a provider original to compare with.
      // A raw label id that still stands for itself needs no alias.
      if (comparable.get(current) !== total.get(current)) continue;
      if (sources.size === 1 && sources.has(current)) continue;
      aliases.set(current, [...sources]);
    }
  }
  const mapped = applyAcousticAssignments(projection, assignments, identities, meeting.speakers, {
    recordingHash: meeting.audio?.hash ?? "",
    sourceRevision: meeting.revision,
  }, sourceIdOf, aliases);
  const finalSegments = recoveredTurns ? applyRecoveredTurnAnchors(mapped.segments, recoveredTurns) : mapped.segments;
  const mappedById = new Map(finalSegments.map((segment) => [segment.id, segment]));
  if (mapped.speakers.every((speaker, index) => speaker.id === meeting.speakers[index]?.id) &&
      meeting.segments.every((segment) => segment.speakerIds.join("\u0000") === mappedById.get(segment.id)?.speakerIds.join("\u0000"))) {
    return meeting;
  }
  const historicalMaxRevision = new Map<string, number>();
  for (const historical of meeting.history) {
    historicalMaxRevision.set(
      historical.id,
      Math.max(historicalMaxRevision.get(historical.id) ?? 0, historical.revision),
    );
  }
  return editMeeting(meeting, (draft) => {
    draft.speakers = mapped.speakers;
    draft.segments = draft.segments.map((segment) => {
      const next = mappedById.get(segment.id);
      if (!next || next.speakerIds.join("\u0000") === segment.speakerIds.join("\u0000")) return segment;
      const revision = Math.max(segment.revision, historicalMaxRevision.get(segment.id) ?? 0) + 1;
      return {
        ...segment,
        speakerIds: next.speakerIds,
        revision,
        reviewed: false,
        parents: [ref(segment)],
      };
    });
    draft.speakerLinks = undefined;
    // Speakers were re-keyed: keep "not the same" decisions pointing at the speakers that now hold those passages.
    const replacements = new Map<string, string>();
    for (const segment of meeting.segments) {
      const next = mappedById.get(segment.id);
      const [before] = segment.speakerIds;
      const [after] = next?.speakerIds ?? [];
      if (segment.speakerIds.length === 1 && next?.speakerIds.length === 1 && before && after && before !== after) {
        replacements.set(before, after);
      }
    }
    draft.voiceDecisions = remapVoiceDecisions(
      draft.voiceDecisions,
      replacements,
      new Set(mapped.speakers.map((speaker) => speaker.id)),
    );
  });
}

