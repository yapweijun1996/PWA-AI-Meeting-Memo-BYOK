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
): NormalizedSpeech {
  const accepted = new Map<string, string>();
  const confirmedSourceIds = new Set([
    ...speech.speakers.filter((speaker) => speaker.confirmed).map((speaker) => speaker.id),
    ...confirmedSpeakers
      .filter((speaker) => speaker.confirmed)
      .flatMap((speaker) => [speaker.id, ...speaker.sourceLabels]),
  ]);
  for (const assignment of assignments) {
    if ((assignment.state !== "matched" && assignment.state !== "new_identity") || !assignment.identityId) continue;
    if (context && (assignment.recordingHash !== context.recordingHash || assignment.sourceRevision !== context.sourceRevision)) continue;
    const sourceId = `part-${assignment.chunkIndex}:${assignment.sourceSpeakerId}`;
    if (confirmedSourceIds.has(sourceId) || confirmedSourceIds.has(assignment.sourceSpeakerId)) continue;
    const identity = identities.find((candidate) => candidate.id === assignment.identityId);
    if (!identity) continue;
    if (context && (identity.recordingHash !== context.recordingHash || identity.sourceRevision !== context.sourceRevision)) continue;
    accepted.set(
      `part-${assignment.chunkIndex}:${assignment.sourceSpeakerId}`,
      identity.confirmedSpeakerId ?? assignment.identityId,
    );
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
): Meeting {
  const projection: NormalizedSpeech = {
    speakers: meeting.speakers,
    segments: meeting.segments,
    duration: meeting.audio?.duration ?? null,
    requestId: null,
  };
  const mapped = applyAcousticAssignments(projection, assignments, identities, meeting.speakers, {
    recordingHash: meeting.audio?.hash ?? "",
    sourceRevision: meeting.revision,
  });
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
