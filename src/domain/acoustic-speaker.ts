import type { NormalizedSpeech } from "../providers/api";
import { editMeeting } from "./operations";
import { ref, type Meeting } from "./model";

/**
 * The anonymous, meeting-scoped acoustic policy. These values are intentionally
 * uncalibrated; they are a conservative starting point for local evaluation,
 * not an accuracy claim.
 */
export const ACOUSTIC_POLICY = {
  version: "wavlm-sv-uncalibrated-v1",
  calibrationStatus: "uncalibrated",
  modelId: "Xenova/wavlm-base-plus-sv",
  modelRevision: "e61029603001bd11295c36d878698708bf59190f",
  dimensions: 512,
  minSampleSeconds: 1.5,
  maxSampleSeconds: 4,
  maxSamplesPerPart: 3,
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
      const candidates: { range: { start: number; end: number }; segmentIds: string[] }[] = [];
      // Long provider turns are the cleanest evidence.
      for (const value of ranges) {
        // A long clean turn can provide independent windows. Do not reuse the
        // same first four seconds for every sample or a continuous monologue
        // can never reach the multi-sample policy.
        for (
          let start = value.range.start;
          start + minSampleSeconds <= value.range.end + SAMPLE_EPSILON;
          start += maxSampleSeconds
        ) {
          const end = Math.min(value.range.end, start + maxSampleSeconds);
          if (end - start < minSampleSeconds) break;
          candidates.push({ range: { start, end }, segmentIds: [...value.segmentIds] });
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
            });
            break;
          }
        }
      }
      const seen = new Set<string>();
      const selected: AcousticSampleWindow[] = [];
      candidates
        .sort(
          (left, right) =>
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
    extractionVersion: input.embeddings[0]?.extractionVersion ?? policy.version,
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
export const PART_MATCH_POLICY = {
  version: `${ACOUSTIC_POLICY.version}+one-to-one-centered-v1`,
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
  evidence: AcousticEmbeddingRecord[];
  mean: number[];
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
  },
  policy: AcousticPolicy = ACOUSTIC_POLICY,
  rules: typeof PART_MATCH_POLICY = PART_MATCH_POLICY,
): RecordingClusterResult {
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
  const recordingAverage = averageVector([...grouped.values()].flat().map((embedding) => embedding.values));
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

  // 2. Inside a part, join labels whose averages are nearly identical (one person over-split).
  const units: MatchUnit[] = [];
  for (const [chunkIndex, partLabels] of [...byPart.entries()].sort((a, b) => a[0] - b[0])) {
    const parent = partLabels.map((_, index) => index);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    const agree = (a: number, b: number) => cosineSimilarity(partLabels[a]!.mean, partLabels[b]!.mean) >= rules.withinPartMergeCosine;
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
      units.push({
        chunkIndex,
        labels: members.map((index) => partLabels[index]!.evidence[0]!.sourceSpeakerId),
        evidence,
        mean: averageVector(evidence.map((entry) => centered(entry.values))),
      });
    }
  }

  // 3. Across parts: one voice per unit, one unit per voice per part, best pairs first.
  interface Voice { id: string; members: { unit: MatchUnit; score: number }[]; centroid: number[] }
  const voices: Voice[] = [];
  const expected = input.expectedVoices;
  if (expected !== undefined && (!Number.isInteger(expected) || expected < 1 || expected > 50)) {
    throw new RangeError("The expected number of speakers must be a whole number from 1 to 50.");
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
    const similarity = partUnits.map((unit) => existing.map((voice) => cosineSimilarity(unit.mean, voice.centroid)));
    const pairs = partUnits
      .flatMap((_, u) => existing.map((__, v) => ({ u, v, score: similarity[u]![v]! })))
      .filter((pair) => Number.isFinite(pair.score) && pair.score >= rules.floorCosine)
      .sort((left, right) => right.score - left.score);
    const takenUnits = new Set<number>();
    const takenVoices = new Set<number>();
    const placed: { unit: MatchUnit; voice: Voice; score: number }[] = [];
    for (const pair of pairs) {
      if (takenUnits.has(pair.u) || takenVoices.has(pair.v)) continue;
      takenUnits.add(pair.u);
      takenVoices.add(pair.v);
      const unit = partUnits[pair.u]!;
      const runnerUp = Math.max(Number.NEGATIVE_INFINITY, ...similarity[pair.u]!.filter((score, v) => v !== pair.v && Number.isFinite(score)));
      if (pair.score - runnerUp < rules.margin) {
        if (deferLeftovers) deferred.push(unit);
        else for (const label of unit.labels) state(labelEvidence(unit, label), "ambiguous", "The leading voices are too close to choose safely.");
        continue;
      }
      placed.push({ unit, voice: existing[pair.v]!, score: pair.score });
    }
    partUnits.forEach((unit, u) => {
      if (takenUnits.has(u)) return;
      const best = Math.max(Number.NEGATIVE_INFINITY, ...similarity[u]!.filter((score) => Number.isFinite(score)));
      if (!(best >= rules.floorCosine)) {
        voices.push(newVoice(unit));
        return;
      }
      if (deferLeftovers) deferred.push(unit);
      else for (const label of unit.labels) state(labelEvidence(unit, label), "ambiguous", "A better-matching label in this part already holds the closest voice; no merge was forced.");
    });
    // Apply the part's placements together so earlier pairs do not shift later ones.
    for (const { unit, voice, score } of placed) {
      voice.members.push({ unit, score });
      voice.centroid = averageVector(voice.members.map((member) => member.unit.mean));
    }
  }

  if (expected !== undefined) {
    for (const unit of deferred) voices.push(newVoice(unit));
    // Group further, most similar first, until the expected number remain.
    // Voices that share a part are penalised, not forbidden (a provider can over-split one person).
    const partsOf = (voice: Voice) => new Set(voice.members.map((member) => member.unit.chunkIndex));
    const SHARED_PART_PENALTY = 0.5;
    while (voices.length > expected) {
      let best: { a: number; b: number; value: number } | undefined;
      for (let a = 0; a < voices.length; a += 1) {
        for (let b = a + 1; b < voices.length; b += 1) {
          const score = cosineSimilarity(voices[a]!.centroid, voices[b]!.centroid);
          if (!Number.isFinite(score)) continue;
          const shared = [...partsOf(voices[a]!)].some((part) => partsOf(voices[b]!).has(part));
          const value = score - (shared ? SHARED_PART_PENALTY : 0);
          if (!best || value > best.value) best = { a, b, value };
        }
      }
      if (!best) break;
      const keep = voices[best.a]!;
      const drop = voices[best.b]!;
      keep.members.push(...drop.members.map((member) => ({ unit: member.unit, score: -1 })));
      keep.centroid = averageVector(keep.members.map((member) => member.unit.mean));
      voices.splice(best.b, 1);
    }
    for (const voice of voices) {
      // Report each joined label's similarity to its final voice.
      voice.members = voice.members.map((member, position) => ({
        unit: member.unit,
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

/** Apply only speaker attribution changes to the current meeting projection. */
export function applyAcousticAssignmentsToMeeting(
  meeting: Meeting,
  assignments: readonly AcousticAssignment[],
  identities: readonly AcousticIdentity[],
  sourceIdOf?: (assignment: AcousticAssignment) => string,
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
  const mappedById = new Map(mapped.segments.map((segment) => [segment.id, segment]));
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
  });
}

