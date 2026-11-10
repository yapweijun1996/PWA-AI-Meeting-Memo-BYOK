import {
  ACOUSTIC_POLICY,
  acousticSourceKey,
  applyAcousticAssignmentsToMeeting,
  clusterRecordingSources,
  selectAcousticSamples,
  type AcousticAssignment,
  type AcousticEmbeddingRecord,
  type AcousticSourcePart,
} from "../domain/acoustic-speaker";
import type { Meeting } from "../domain/model";
import type { NormalizedSpeech } from "../providers/api";
import type { BrowserSpeakerEmbeddingProvider } from "../audio/speaker-embedding";
import { decodeAcousticWindow } from "../audio/acoustic-audio";
import {
  deleteAcousticAssignments,
  deleteAcousticIdentities,
  getAcousticEmbedding,
  putAcousticAssignment,
  putAcousticCheckpoint,
  putAcousticEmbedding,
  putAcousticIdentity,
} from "../storage/acoustic-store";
import { getAudio, getMeeting } from "../storage/repository";

export interface SingleRecordingVoiceOptions {
  provider: BrowserSpeakerEmbeddingProvider;
  consent: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: { phase: "model" | "sample" | "assignment"; done: number; total: number }) => void;
}

export interface SingleRecordingVoiceSummary {
  /** Provider speaker labels that had enough clean evidence to compare. */
  comparedLabels: number;
  /** Labels folded into another label because their voices matched. */
  mergedLabels: number;
  /** Labels left as-is because evidence was missing, contradictory or ambiguous. */
  unresolvedLabels: number;
}

/** A recording that fits one provider request is a single "part" with no lead-in. */
export function singleRecordingFormat(audio: { name: string; type: string }): "mp3" | "mp4" | undefined {
  const extension = audio.name.toLowerCase().split(".").pop() ?? "";
  const mime = audio.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (["mp3", "mpeg", "mpga"].includes(extension) || ["audio/mpeg", "audio/mp3", "audio/mpga"].includes(mime)) return "mp3";
  if (["m4a", "mp4"].includes(extension) || ["audio/mp4", "audio/x-m4a", "audio/m4a"].includes(mime)) return "mp4";
  return undefined;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Find voices inside one non-chunked recording using local acoustic evidence.
 * Provider labels are the starting point only; labels are grouped when their
 * audio agrees. Provider output and human edits are preserved: the change is a
 * single undoable speaker-attribution revision, and nothing is sent anywhere.
 */
export async function analyzeSingleRecordingVoices(
  meeting: Meeting,
  options: SingleRecordingVoiceOptions,
): Promise<{ meeting: Meeting; summary: SingleRecordingVoiceSummary }> {
  const { provider, signal } = options;
  if (!options.consent) throw new Error("Local speaker model consent is required before acoustic analysis.");
  const audio = meeting.audio;
  if (!audio?.present || audio.chunked) throw new Error("This meeting has no single recording for local voice analysis.");
  const format = singleRecordingFormat(audio);
  if (!format) {
    throw new Error("Local voice detection supports MP3 and M4A/MP4 recordings. Convert the recording or keep the provider's speaker labels.");
  }
  const blob = await getAudio(meeting.id);
  if (!blob) throw new Error("Attach the original recording before local voice analysis.");
  const bytes = await blob.arrayBuffer();
  if ((await sha256Hex(bytes)) !== audio.hash) {
    throw new Error("The stored recording does not match this meeting. Reattach the original recording before local voice analysis.");
  }

  // Provider evidence: the latest immutable run, never the human-edited view.
  const latestRun = [...meeting.runs].reverse().find((run) => run.originalSegments.length > 0);
  const speech: Pick<NormalizedSpeech, "segments"> = {
    segments: latestRun?.originalSegments ?? meeting.segments,
  };
  const maxEnd = Math.max(0, ...speech.segments.map((segment) => segment.end ?? 0));
  const duration = Math.max(audio.duration ?? 0, maxEnd);
  if (!(duration > 0)) {
    throw new Error("This transcript has no timestamps, so voice samples cannot be located. Use a model that returns speaker labels and timestamps.");
  }
  const part: AcousticSourcePart = { index: 0, ownStartSeconds: 0, ownDurationSeconds: duration, leadInSeconds: 0 };
  const selection = selectAcousticSamples([{ chunk: part, speech }]);
  if (!selection.samples.length) {
    throw new Error("No clean, timed single-speaker passages were found. The transcript may lack speaker labels or timestamps, or the speakers overlap.");
  }

  await provider.load({
    consent: options.consent,
    signal,
    onProgress: (model) => options.onProgress?.({ phase: "model", done: model.loaded ?? 0, total: model.total ?? 0 }),
  });
  const embeddings: AcousticEmbeddingRecord[] = [];
  let done = 0;
  for (const sample of selection.samples) {
    abortIfRequested(signal);
    let embedding = await getAcousticEmbedding(meeting.id, sample.id);
    if (
      embedding &&
      (embedding.recordingHash !== audio.hash ||
        embedding.sourceRevision !== meeting.revision ||
        embedding.chunkIndex !== sample.chunkIndex ||
        embedding.sourceSpeakerId !== sample.sourceSpeakerId ||
        embedding.modelId !== ACOUSTIC_POLICY.modelId ||
        embedding.modelRevision !== ACOUSTIC_POLICY.modelRevision ||
        embedding.extractionVersion !== ACOUSTIC_POLICY.version)
    ) {
      embedding = undefined;
    }
    if (!embedding) {
      const pcm = await decodeAcousticWindow(bytes, part, sample, { format, signal });
      const values = await provider.embed(pcm, 16000, signal);
      embedding = {
        id: sample.id,
        meetingId: meeting.id,
        recordingHash: audio.hash,
        sourceRevision: meeting.revision,
        chunkIndex: sample.chunkIndex,
        sourceSpeakerId: sample.sourceSpeakerId,
        sample,
        modelId: ACOUSTIC_POLICY.modelId,
        modelRevision: ACOUSTIC_POLICY.modelRevision,
        extractionVersion: ACOUSTIC_POLICY.version,
        values,
        createdAt: new Date().toISOString(),
      };
      await putAcousticEmbedding(embedding);
    }
    embeddings.push(embedding);
    done += 1;
    options.onProgress?.({ phase: "sample", done, total: selection.samples.length });
  }

  const clustered = clusterRecordingSources({
    meetingId: meeting.id,
    recordingHash: audio.hash,
    sourceRevision: meeting.revision,
    embeddings,
  });
  // Identities and assignments are derived; replace the previous run's.
  await deleteAcousticAssignments(meeting.id);
  await deleteAcousticIdentities(meeting.id);
  for (const identity of clustered.identities) await putAcousticIdentity(identity);
  const assignments: AcousticAssignment[] = [];
  for (const value of clustered.assignments) {
    const assignment: AcousticAssignment = { ...value, id: `${meeting.id}:${value.sourceKey}`, updatedAt: new Date().toISOString() };
    await putAcousticAssignment(assignment);
    assignments.push(assignment);
  }
  const now = new Date().toISOString();
  await putAcousticCheckpoint({
    id: meeting.id,
    meetingId: meeting.id,
    recordingHash: audio.hash,
    sourceRevision: meeting.revision,
    modelId: ACOUSTIC_POLICY.modelId,
    modelRevision: ACOUSTIC_POLICY.modelRevision,
    extractionVersion: ACOUSTIC_POLICY.version,
    thresholdVersion: ACOUSTIC_POLICY.version,
    calibrationStatus: ACOUSTIC_POLICY.calibrationStatus,
    state: "completed",
    nextChunkIndex: 1,
    nextSpeakerKey: null,
    completedChunkCount: 1,
    lastCompletedChunkIndex: 0,
    processedEmbeddingCount: embeddings.length,
    error: null,
    updatedAt: now,
  });
  options.onProgress?.({ phase: "assignment", done: assignments.length, total: assignments.length });

  const latest = await getMeeting(meeting.id);
  if (!latest) throw new Error("The meeting was deleted while local voice analysis was running.");
  if (latest.audio?.hash !== audio.hash || latest.revision !== meeting.revision) {
    throw new Error("The meeting changed while local voice analysis was running. Reload before retrying.");
  }
  // Re-key only labels that actually grouped with another label. A label that
  // stands alone keeps its provider speaker, so unchanged speakers are not
  // rewritten into new revisions.
  const perIdentity = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.identityId && (assignment.state === "matched" || assignment.state === "new_identity")) {
      perIdentity.set(assignment.identityId, (perIdentity.get(assignment.identityId) ?? 0) + 1);
    }
  }
  const grouped = assignments.filter((assignment) => assignment.identityId && (perIdentity.get(assignment.identityId) ?? 0) > 1);
  const projected = applyAcousticAssignmentsToMeeting(
    latest,
    grouped,
    clustered.identities,
    (assignment) => assignment.sourceSpeakerId,
  );
  const compared = new Set(assignments.map((assignment) => acousticSourceKey(assignment.chunkIndex, assignment.sourceSpeakerId))).size;
  const mergedLabels = grouped.length - new Set(grouped.map((assignment) => assignment.identityId)).size;
  return {
    meeting: projected,
    summary: {
      comparedLabels: compared,
      mergedLabels,
      unresolvedLabels: assignments.filter((assignment) => !assignment.identityId).length,
    },
  };
}
