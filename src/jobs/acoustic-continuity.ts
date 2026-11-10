import {
  ACOUSTIC_POLICY,
  acousticSourceKey,
  chooseAcousticAssignment,
  clusterRecordingSources,
  cosineSimilarity,
  matchLabelsAcrossParts,
  selectAcousticSamples,
  updateAcousticIdentity,
  applyAcousticAssignmentsToMeeting,
  type AcousticAssignment,
  type AcousticAssignmentState,
  type AcousticCheckpoint,
  type AcousticChunkInput,
  type AcousticEmbeddingRecord,
} from "../domain/acoustic-speaker";
import type { Meeting } from "../domain/model";
import type { NormalizedSpeech } from "../providers/api";
import type { BrowserSpeakerEmbeddingProvider, SpeakerModelProgress } from "../audio/speaker-embedding";
import { decodeAcousticWindow } from "../audio/acoustic-audio";
import type { LongAudioManifest } from "../storage/long-audio-store";
import { getLongAudioChunk } from "../storage/long-audio-store";
import { getChunkSpeech } from "../storage/chunk-speech-store";
import {
  deleteAcousticAssignments,
  deleteAcousticIdentities,
  getAcousticAssignment,
  getAcousticCheckpoint,
  getAcousticEmbedding,
  listAcousticAssignments,
  listAcousticEmbeddings,
  listAcousticIdentities,
  listTranscriptPages,
  putAcousticAssignment,
  putAcousticCheckpoint,
  putAcousticEmbedding,
  putAcousticIdentity,
} from "../storage/acoustic-store";
import { getMeeting } from "../storage/repository";

export interface AcousticContinuityProgress {
  phase: "model" | "sample" | "assignment";
  done: number;
  total: number;
  chunkIndex?: number;
  sourceKey?: string;
  model?: SpeakerModelProgress;
}

export interface AcousticContinuityOptions {
  meetingId: string;
  recordingHash: string;
  sourceRevision: number;
  manifest: LongAudioManifest;
  provider: BrowserSpeakerEmbeddingProvider;
  consent: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: AcousticContinuityProgress) => void;
  fallbackParts?: ReadonlyMap<number, NormalizedSpeech>;
  /** Discard saved decisions and re-decide every part; cached vectors are kept. */
  restart?: boolean;
  /** Optional, from a person: how many people spoke. Used only for multi-part grouping. */
  expectedVoices?: number;
}

function now(): string {
  return new Date().toISOString();
}

function checkpointValue(
  options: AcousticContinuityOptions,
  value: Partial<AcousticCheckpoint> = {},
): AcousticCheckpoint {
  return {
    id: options.meetingId,
    meetingId: options.meetingId,
    recordingHash: options.recordingHash,
    sourceRevision: options.sourceRevision,
    modelId: ACOUSTIC_POLICY.modelId,
    modelRevision: ACOUSTIC_POLICY.modelRevision,
    extractionVersion: ACOUSTIC_POLICY.version,
    thresholdVersion: ACOUSTIC_POLICY.version,
    calibrationStatus: ACOUSTIC_POLICY.calibrationStatus,
    state: "running",
    nextChunkIndex: 0,
    nextSpeakerKey: null,
    completedChunkCount: 0,
    lastCompletedChunkIndex: null,
    processedEmbeddingCount: 0,
    error: null,
    updatedAt: now(),
    ...value,
  };
}

function sourceEmbeddings(
  embeddings: readonly AcousticEmbeddingRecord[],
  chunkIndex: number,
  sourceSpeakerId: string,
): AcousticEmbeddingRecord[] {
  return embeddings.filter(
    (embedding) =>
      embedding.chunkIndex === chunkIndex && embedding.sourceSpeakerId === sourceSpeakerId,
  );
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

async function savedPartSpeech(meetingId: string, chunkIndex: number, fallbackParts?: ReadonlyMap<number, NormalizedSpeech>) {
  const direct = await getChunkSpeech(meetingId, chunkIndex);
  if (direct) return direct;
  const pages = (await listTranscriptPages(meetingId))
    .filter((page) => page.chunkIndex === chunkIndex)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return pages[0]?.original ?? fallbackParts?.get(chunkIndex);
}

function localLegacyId(value: string, chunkIndex: number): string {
  const prefix = `part-${chunkIndex}:`;
  if (value.startsWith(prefix)) return value.slice(prefix.length);
  const match = /^part-\d+:(.+)$/.exec(value);
  return match?.[1] ?? value;
}

/** Rebuild a local page from the immutable raw run kept by older chunk runs. */
export function deriveLegacyPartSpeech(meeting: Meeting, manifest: LongAudioManifest): Map<number, NormalizedSpeech> {
  const latestRun = [...meeting.runs].reverse().find((run) => run.originalSegments.length > 0);
  const sourceSegments = latestRun?.originalSegments ?? meeting.segments;
  const sourceSpeakers = latestRun?.speakers ?? meeting.speakers;
  const result = new Map<number, NormalizedSpeech>();
  for (const chunk of manifest.chunks) {
    const sourceStart = chunk.ownStartSeconds - chunk.leadInSeconds;
    const sourceEnd = chunk.ownStartSeconds + chunk.ownDurationSeconds;
    const selected = sourceSegments.filter((segment) => {
      if (segment.start === null || segment.end === null) return chunk.index === 0;
      return segment.start < sourceEnd && segment.end > sourceStart;
    });
    const speakerIds = new Set(selected.flatMap((segment) => segment.speakerIds));
    const speakers = [...speakerIds].map((speakerId) => {
      const source = sourceSpeakers.find((speaker) => speaker.id === speakerId) ??
        sourceSpeakers.find((speaker) => speaker.sourceLabels.includes(speakerId));
      const localId = localLegacyId(speakerId, chunk.index);
      return {
        id: localId,
        name: source?.name ?? localId,
        confirmed: source?.confirmed ?? false,
        sourceLabels: [...new Set([...(source?.sourceLabels ?? []), speakerId])].slice(0, 100),
      };
    });
    const usedIds = new Set<string>();
    const segments = selected.map((segment, position) => {
      const baseId = localLegacyId(segment.id, chunk.index) || `legacy-${position}`;
      let localId = baseId;
      let suffix = 2;
      while (usedIds.has(localId)) localId = `${baseId}:${suffix++}`;
      usedIds.add(localId);
      return {
        ...segment,
        id: localId,
        start: segment.start === null ? null : Math.max(0, segment.start - sourceStart),
        end: segment.end === null ? null : Math.max(0, segment.end - sourceStart),
        speakerIds: segment.speakerIds.map((speakerId) => localLegacyId(speakerId, chunk.index)),
      };
    });
    result.set(chunk.index, {
      speakers,
      segments,
      duration: Math.max(chunk.leadInSeconds + chunk.ownDurationSeconds, ...segments.map((segment) => segment.end ?? 0)),
      requestId: null,
    });
  }
  return result;
}

/**
 * Run meeting-scoped acoustic continuity in bounded sequential parts. Every
 * local vector and assignment is saved before advancing the cursor. This stage
 * never calls a speech provider and therefore never repeats a paid request.
 */
export async function runAcousticContinuity(
  options: AcousticContinuityOptions,
): Promise<{ checkpoint: AcousticCheckpoint; assignments: AcousticAssignment[] }> {
  const { meetingId, manifest, provider, signal } = options;
  if (!options.consent) throw new Error("Local speaker model consent is required before acoustic analysis.");
  const existing = await getAcousticCheckpoint(meetingId);
  if (options.restart) {
    // An explicit re-analysis recomputes derived decisions (cached vectors for
    // this revision are reused) so improved grouping applies to old results.
    await deleteAcousticAssignments(meetingId);
    await deleteAcousticIdentities(meetingId);
  }
  const compatible = !options.restart && existing &&
    existing.recordingHash === options.recordingHash &&
    existing.sourceRevision === options.sourceRevision &&
    existing.modelId === ACOUSTIC_POLICY.modelId &&
    existing.modelRevision === ACOUSTIC_POLICY.modelRevision &&
    existing.extractionVersion === ACOUSTIC_POLICY.version &&
    existing.thresholdVersion === ACOUSTIC_POLICY.version &&
    existing.calibrationStatus === ACOUSTIC_POLICY.calibrationStatus;
  let checkpoint = compatible
    ? { ...existing, state: "running" as const, error: null, updatedAt: now() }
    : checkpointValue(options);
  await putAcousticCheckpoint(checkpoint);
  try {
    await provider.load({
      consent: options.consent,
      signal,
      onProgress: (model) => options.onProgress?.({ phase: "model", done: model.loaded ?? 0, total: model.total ?? 0, model }),
    });
    const allAssignments: AcousticAssignment[] = [];
    let processedEmbeddingCount = checkpoint.processedEmbeddingCount;
    const totalChunks = manifest.chunks.length;
    for (const meta of manifest.chunks) {
      abortIfRequested(signal);
      if (meta.index < checkpoint.nextChunkIndex) continue;
      const speech = await savedPartSpeech(meetingId, meta.index, options.fallbackParts);
      if (!speech) throw new Error(`Saved speech for chunk ${meta.index + 1} is missing.`);
      const input: AcousticChunkInput = { chunk: meta, speech };
      const selection = selectAcousticSamples([input]);
      const sourceKeys = [...new Set(selection.samples.map((sample) => acousticSourceKey(sample.chunkIndex, sample.sourceSpeakerId)))];
      const identities = await listAcousticIdentities(meetingId);
      const localEmbeddings: AcousticEmbeddingRecord[] = [];
      const usedIdentityIds = new Set<string>();
      for (const sample of selection.samples) {
        abortIfRequested(signal);
        let embedding = await getAcousticEmbedding(meetingId, sample.id);
        if (embedding && (
          embedding.recordingHash !== options.recordingHash ||
          embedding.sourceRevision !== options.sourceRevision ||
          embedding.chunkIndex !== sample.chunkIndex ||
          embedding.sourceSpeakerId !== sample.sourceSpeakerId ||
          embedding.modelId !== ACOUSTIC_POLICY.modelId ||
          embedding.modelRevision !== ACOUSTIC_POLICY.modelRevision ||
          embedding.extractionVersion !== ACOUSTIC_POLICY.version
        )) {
          embedding = undefined;
        }
        if (!embedding) {
          const chunkBlob = await getLongAudioChunk(meetingId, meta.index, { verify: true });
          const pcm = await decodeAcousticWindow(await chunkBlob.arrayBuffer(), meta, sample, { format: manifest.format, signal });
          const values = await provider.embed(pcm, 16000, signal);
          embedding = {
            id: sample.id,
            meetingId,
            recordingHash: options.recordingHash,
            sourceRevision: options.sourceRevision,
            chunkIndex: sample.chunkIndex,
            sourceSpeakerId: sample.sourceSpeakerId,
            sample,
            modelId: ACOUSTIC_POLICY.modelId,
            modelRevision: ACOUSTIC_POLICY.modelRevision,
            extractionVersion: ACOUSTIC_POLICY.version,
            values,
            createdAt: now(),
          };
          await putAcousticEmbedding(embedding);
          processedEmbeddingCount += 1;
        }
        localEmbeddings.push(embedding);
        options.onProgress?.({ phase: "sample", done: processedEmbeddingCount, total: totalChunks, chunkIndex: meta.index, sourceKey: acousticSourceKey(sample.chunkIndex, sample.sourceSpeakerId) });
      }
      // A provider can split one person into several labels inside one part.
      // Labels whose samples all agree (see clusterRecordingSources) are decided
      // together: the first is the lead, the rest follow its identity.
      const followersOf = new Map<string, string[]>();
      const leadOf = new Map<string, string>();
      if (localEmbeddings.length) {
        const byIdentity = new Map<string, string[]>();
        for (const grouped of clusterRecordingSources({
          meetingId,
          recordingHash: options.recordingHash,
          sourceRevision: options.sourceRevision,
          embeddings: localEmbeddings,
        }).assignments) {
          if (grouped.identityId && (grouped.state === "matched" || grouped.state === "new_identity")) {
            byIdentity.set(grouped.identityId, [...(byIdentity.get(grouped.identityId) ?? []), grouped.sourceKey]);
          }
        }
        for (const keys of byIdentity.values()) {
          const ordered = sourceKeys.filter((key) => keys.includes(key));
          const [lead, ...followers] = ordered;
          if (!lead || !followers.length) continue;
          followersOf.set(lead, followers);
          for (const follower of followers) leadOf.set(follower, lead);
        }
      }
      for (const sourceKey of sourceKeys) {
        abortIfRequested(signal);
        const [chunkIndexText, ...speakerParts] = sourceKey.split(":");
        const sourceSpeakerId = speakerParts.join(":");
        const chunkIndex = Number(chunkIndexText);
        if (!Number.isInteger(chunkIndex) || !sourceSpeakerId) continue;
        const embeddings = sourceEmbeddings(localEmbeddings, chunkIndex, sourceSpeakerId);
        if (!embeddings.length) continue;
        const previous = await getAcousticAssignment(meetingId, sourceKey);
        if (
          previous &&
          previous.recordingHash === options.recordingHash &&
          previous.sourceRevision === options.sourceRevision &&
          previous.thresholdVersion === ACOUSTIC_POLICY.version &&
          previous.calibrationStatus === ACOUSTIC_POLICY.calibrationStatus &&
          previous.state !== "stale"
        ) {
          if (previous.identityId && (previous.state === "matched" || previous.state === "new_identity")) {
            usedIdentityIds.add(previous.identityId);
          }
          allAssignments.push(previous);
          continue;
        }
        const leadKey = leadOf.get(sourceKey);
        const leadAssignment = leadKey ? allAssignments.find((candidate) => candidate.sourceKey === leadKey) : undefined;
        if (leadAssignment) {
          // Follower label: same voice as the lead, so it shares the lead's decision.
          const follower: AcousticAssignment = {
            ...leadAssignment,
            id: `${meetingId}:${sourceKey}`,
            sourceKey,
            sourceSpeakerId,
            evidenceEmbeddingIds: embeddings.map((embedding) => embedding.id),
            state: leadAssignment.state === "new_identity" ? "matched" : leadAssignment.state,
            reason: "Another provider label in this part has the same voice, so both share one anonymous identity.",
            updatedAt: now(),
          };
          await putAcousticAssignment(follower);
          allAssignments.push(follower);
          options.onProgress?.({ phase: "assignment", done: allAssignments.length, total: totalChunks, chunkIndex, sourceKey });
          continue;
        }
        const followerEmbeddings = (followersOf.get(sourceKey) ?? []).flatMap((key) => {
          const [, ...parts] = key.split(":");
          return sourceEmbeddings(localEmbeddings, chunkIndex, parts.join(":"));
        });
        const result = chooseAcousticAssignment(
          {
            meetingId,
            recordingHash: options.recordingHash,
            sourceRevision: options.sourceRevision,
            chunkIndex,
            sourceSpeakerId,
            embeddings,
            expectedModelRevision: ACOUSTIC_POLICY.modelRevision,
            expectedExtractionVersion: ACOUSTIC_POLICY.version,
          },
          identities,
        );
        if (result.assignment.identityId && usedIdentityIds.has(result.assignment.identityId)) {
          result.assignment.state = "ambiguous";
          result.assignment.identityId = null;
          result.assignment.reason = "Two provider labels in the same part claimed one identity; the association remains unresolved.";
        } else if (result.assignment.identityId) {
          usedIdentityIds.add(result.assignment.identityId);
        }
        const assignment: AcousticAssignment = {
          ...result.assignment,
          id: `${meetingId}:${sourceKey}`,
          updatedAt: now(),
        };
        await putAcousticAssignment(assignment);
        if (result.identity) await putAcousticIdentity(updateAcousticIdentity(result.identity, followerEmbeddings));
        else if (assignment.identityId && assignment.state === "matched") {
          const identity = identities.find((candidate) => candidate.id === assignment.identityId);
          if (identity) await putAcousticIdentity(updateAcousticIdentity(identity, [...embeddings, ...followerEmbeddings]));
        }
        allAssignments.push(assignment);
        options.onProgress?.({ phase: "assignment", done: allAssignments.length, total: totalChunks, chunkIndex, sourceKey });
      }
      checkpoint = checkpointValue(options, {
        state: "running",
        nextChunkIndex: meta.index + 1,
        lastCompletedChunkIndex: meta.index,
        completedChunkCount: Math.max(checkpoint.completedChunkCount, meta.index + 1),
        processedEmbeddingCount,
      });
      await putAcousticCheckpoint(checkpoint);
    }
    if (totalChunks > 1) {
      // Every part's vectors are saved now. Decide across the whole recording at
      // once: per-part decisions above are interim and are replaced here.
      const embeddings = (await listAcousticEmbeddings(meetingId)).filter(
        (embedding) =>
          embedding.recordingHash === options.recordingHash &&
          embedding.sourceRevision === options.sourceRevision &&
          embedding.modelId === ACOUSTIC_POLICY.modelId &&
          embedding.modelRevision === ACOUSTIC_POLICY.modelRevision &&
          embedding.extractionVersion === ACOUSTIC_POLICY.version,
      );
      // Removing the recording's average voice only helps when the recording has
      // different voices to tell apart: some part must contain 2+ labels. With one
      // label per part everything is the same voice, so keep the per-part decisions.
      const labelsPerPart = new Map<number, Set<string>>();
      for (const embedding of embeddings) {
        labelsPerPart.set(embedding.chunkIndex, (labelsPerPart.get(embedding.chunkIndex) ?? new Set()).add(embedding.sourceSpeakerId));
      }
      if (embeddings.length && [...labelsPerPart.values()].some((labels) => labels.size >= 2)) {
        const decided = matchLabelsAcrossParts({
          meetingId,
          recordingHash: options.recordingHash,
          sourceRevision: options.sourceRevision,
          embeddings,
          expectedVoices: options.expectedVoices,
        });
        await deleteAcousticAssignments(meetingId);
        await deleteAcousticIdentities(meetingId);
        for (const identity of decided.identities) await putAcousticIdentity(identity);
        allAssignments.length = 0;
        for (const value of decided.assignments) {
          const assignment: AcousticAssignment = { ...value, id: `${meetingId}:${value.sourceKey}`, updatedAt: now() };
          await putAcousticAssignment(assignment);
          allAssignments.push(assignment);
        }
        options.onProgress?.({ phase: "assignment", done: allAssignments.length, total: allAssignments.length });
      }
    }
    checkpoint = { ...checkpoint, state: "completed", error: null, updatedAt: now() };
    await putAcousticCheckpoint(checkpoint);
    return { checkpoint, assignments: allAssignments };
  } catch (error) {
    checkpoint = {
      ...checkpoint,
      state: "failed_local",
      error: error instanceof Error ? error.message.slice(0, 1000) : "Local acoustic analysis failed.",
      updatedAt: now(),
    };
    await putAcousticCheckpoint(checkpoint);
    throw error;
  }
}

export interface AcousticStateSummary {
  checkpointState: string | null;
  error: string | null;
  /** Voice samples embedded so far. */
  samples: number;
  /** Provider speaker labels that have a saved decision. */
  labels: number;
  /** Distinct anonymous voices those labels resolved to. */
  voices: number;
  byState: Record<AcousticAssignmentState, number>;
  /**
   * For each label, the cosine to its closest label in a DIFFERENT part (mean
   * vector per label). Shows whether the acceptance threshold or the model is
   * the limiting factor. Not an accuracy measure: the labels are unverified.
   */
  crossPart: { labels: number; strong: number; middle: number; weak: number; median: number | null };
  /**
   * Pair similarity of samples under the SAME provider label vs different labels
   * in the same part. If the two look alike, the vectors do not separate voices
   * (alignment, audio or model problem); if same-label is clearly higher, a few
   * impure labels are the issue.
   */
  pairs: {
    sameLabel: { count: number; median: number | null; p10: number | null };
    otherLabelSamePart: { count: number; median: number | null; p90: number | null };
  };
  /** The same two measurements after removing the recording's average vector. */
  centered: { pairs: AcousticStateSummary["pairs"]; closestOtherPartMedian: number | null };
}

/**
 * The same vectors after subtracting the recording's average vector. A shared
 * channel/room component can make every voice look alike; removing it is a
 * standard step. Diagnostic only for now: nothing is matched on these values.
 */
function centerEmbeddings(embeddings: readonly AcousticEmbeddingRecord[]): AcousticEmbeddingRecord[] {
  const first = embeddings[0];
  if (!first) return [];
  const average = Array.from({ length: first.values.length }, () => 0);
  for (const embedding of embeddings) embedding.values.forEach((value, index) => { average[index] = (average[index] ?? 0) + value / embeddings.length; });
  return embeddings.map((embedding) => ({ ...embedding, values: embedding.values.map((value, index) => value - (average[index] ?? 0)) }));
}

function quantile(sorted: readonly number[], fraction: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))] ?? null;
}

function pairStatistics(embeddings: readonly AcousticEmbeddingRecord[]): AcousticStateSummary["pairs"] {
  const same: number[] = [];
  const other: number[] = [];
  for (let i = 0; i < embeddings.length; i += 1) {
    for (let j = i + 1; j < embeddings.length; j += 1) {
      const left = embeddings[i]!;
      const right = embeddings[j]!;
      if (left.chunkIndex !== right.chunkIndex) continue;
      const score = cosineSimilarity(left.values, right.values);
      if (!Number.isFinite(score)) continue;
      (left.sourceSpeakerId === right.sourceSpeakerId ? same : other).push(score);
    }
  }
  same.sort((a, b) => a - b);
  other.sort((a, b) => a - b);
  return {
    sameLabel: { count: same.length, median: quantile(same, 0.5), p10: quantile(same, 0.1) },
    otherLabelSamePart: { count: other.length, median: quantile(other, 0.5), p90: quantile(other, 0.9) },
  };
}

function crossPartSimilarity(
  embeddings: readonly AcousticEmbeddingRecord[],
): AcousticStateSummary["crossPart"] {
  const sums = new Map<string, { chunk: number; sum: number[] }>();
  for (const embedding of embeddings) {
    const key = acousticSourceKey(embedding.chunkIndex, embedding.sourceSpeakerId);
    const entry = sums.get(key) ?? { chunk: embedding.chunkIndex, sum: Array.from({ length: embedding.values.length }, () => 0) };
    embedding.values.forEach((value, index) => { entry.sum[index] = (entry.sum[index] ?? 0) + value; });
    sums.set(key, entry);
  }
  const labels = [...sums.values()];
  const best: number[] = [];
  for (const left of labels) {
    let top = Number.NEGATIVE_INFINITY;
    for (const right of labels) {
      if (right.chunk === left.chunk) continue;
      const score = cosineSimilarity(left.sum, right.sum);
      if (Number.isFinite(score) && score > top) top = score;
    }
    if (Number.isFinite(top)) best.push(top);
  }
  best.sort((a, b) => a - b);
  const mid = Math.floor(best.length / 2);
  return {
    labels: best.length,
    strong: best.filter((score) => score >= ACOUSTIC_POLICY.acceptCosine).length,
    middle: best.filter((score) => score >= ACOUSTIC_POLICY.conflictCosine && score < ACOUSTIC_POLICY.acceptCosine).length,
    weak: best.filter((score) => score < ACOUSTIC_POLICY.conflictCosine).length,
    median: best.length ? (best.length % 2 ? best[mid]! : (best[mid - 1]! + best[mid]!) / 2) : null,
  };
}

/** Read-only summary of saved local voice analysis, so results are visible after the fact. */
export async function describeAcousticState(meetingId: string): Promise<AcousticStateSummary> {
  const [checkpoint, assignments, allEmbeddings] = await Promise.all([
    getAcousticCheckpoint(meetingId),
    listAcousticAssignments(meetingId),
    listAcousticEmbeddings(meetingId),
  ]);
  const current = checkpoint
    ? allEmbeddings.filter(
        (embedding) =>
          embedding.recordingHash === checkpoint.recordingHash &&
          embedding.sourceRevision === checkpoint.sourceRevision &&
          embedding.modelRevision === checkpoint.modelRevision &&
          embedding.extractionVersion === checkpoint.extractionVersion,
      )
    : [];
  const byState: Record<AcousticAssignmentState, number> = { matched: 0, new_identity: 0, ambiguous: 0, unresolved: 0, conflict: 0, stale: 0 };
  for (const assignment of assignments) byState[assignment.state] += 1;
  return {
    checkpointState: checkpoint?.state ?? null,
    error: checkpoint?.error ?? null,
    // Count vectors in use, not only newly computed ones (a re-run reuses cached vectors).
    samples: current.length,
    labels: assignments.length,
    voices: new Set(assignments.filter((a) => a.identityId && (a.state === "matched" || a.state === "new_identity")).map((a) => a.identityId)).size,
    byState,
    crossPart: crossPartSimilarity(current),
    pairs: pairStatistics(current),
    centered: (() => {
      const flat = centerEmbeddings(current);
      return { pairs: pairStatistics(flat), closestOtherPartMedian: crossPartSimilarity(flat).median };
    })(),
  };
}

/**
 * Re-project an already transcribed meeting using saved local assignments.
 * This entry point does not need a provider key or paid speech request and is
 * also usable after a reload when only paged source pages remain.
 */
export async function analyzeExistingMeetingAcoustics(
  meeting: Meeting,
  options: Omit<AcousticContinuityOptions, "meetingId" | "recordingHash" | "sourceRevision" | "manifest"> & { manifest: LongAudioManifest },
): Promise<Meeting> {
  if (!meeting.audio?.chunked) throw new Error("This meeting has no chunked recording for local speaker analysis.");
  const fallbackParts = deriveLegacyPartSpeech(meeting, options.manifest);
  await runAcousticContinuity({
    ...options,
    meetingId: meeting.id,
    recordingHash: meeting.audio.hash,
    sourceRevision: meeting.revision,
    manifest: options.manifest,
    fallbackParts,
    restart: true,
  });
  for (const meta of options.manifest.chunks) {
    const speech = await savedPartSpeech(meeting.id, meta.index, fallbackParts);
    if (!speech) throw new Error(`Saved transcript source for part ${meta.index + 1} is missing.`);
  }
  const latest = await getMeeting(meeting.id);
  if (!latest) throw new Error("The meeting was deleted while local speaker analysis was running.");
  if (latest.audio?.hash !== meeting.audio.hash || latest.revision !== meeting.revision) {
    throw new Error("The meeting changed while local speaker analysis was running. Reload before retrying local matching.");
  }
  const assignments = await listAcousticAssignments(latest.id);
  const identities = await listAcousticIdentities(latest.id);
  // Keep current text, segment IDs, revisions, reviewed flags, memo sources,
  // and human edits intact. Only the speaker attribution projection changes;
  // editMeeting records one undo snapshot and invalidates derived citations.
  return applyAcousticAssignmentsToMeeting(latest, assignments, identities);
}

