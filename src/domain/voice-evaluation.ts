import {
  ACOUSTIC_POLICY,
  PART_MATCH_POLICY,
  type AcousticAssignment,
  type AcousticEmbeddingRecord,
} from "./acoustic-speaker";
import type { Meeting } from "./model";
import { buildVoiceConstraints } from "./voice-constraints";
import { cleanSampleOwner } from "./voice-suggestions";

export const VOICE_EVALUATION_KIND = "voice-evaluation-export";

export interface VoiceEvaluationSample {
  id: string;
  part: number;
  /** Provider speaker label inside its part. */
  label: string;
  start: number;
  end: number;
  /**
   * Pseudonym of the speaker a person confirmed for this passage, or null when
   * the passage has no single confirmed speaker. This is the reference answer.
   */
  reference: string | null;
  values: number[];
}

export interface VoiceEvaluationDecision {
  part: number;
  label: string;
  state: AcousticAssignment["state"];
  /** Pseudonym of the anonymous voice the app placed this label in, or null. */
  voice: string | null;
}

/**
 * Saved voice vectors of one meeting with a person's confirmed speakers as the
 * reference, for offline measurement. Holds no transcript text, no titles, no
 * speaker names and no recording hash. The vectors are derived from voices:
 * keep the file private and out of source control.
 */
export interface VoiceEvaluationExport {
  schemaVersion: 1;
  kind: typeof VOICE_EVALUATION_KIND;
  exportedAt: string;
  model: { id: string; revision: string; extractionVersion: string };
  policy: { thresholdVersion: string; floorCosine: number; margin: number; withinPartMergeCosine: number };
  recording: { parts: number; durationSeconds: number | null };
  reference: { source: "human-confirmed-speakers"; speakers: number; confirmedSpeakers: number };
  samples: VoiceEvaluationSample[];
  decisions: VoiceEvaluationDecision[];
  /**
   * Pairs of "part:label" a person judged to be different people: two confirmed
   * speakers, or two speakers marked "not the same" in review.
   */
  differentLabelPairs: [string, string][];
}

function pseudonym(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(2, "0")}`;
}

/**
 * Build the evaluation export. A sample gets a reference only when every current
 * transcript passage in its time range belongs to one speaker and a person
 * confirmed that speaker; anything else stays null rather than guessed.
 */
export function buildVoiceEvaluationExport(
  meeting: Pick<Meeting, "speakers" | "segments" | "audio"> & Partial<Pick<Meeting, "voiceDecisions">>,
  embeddings: readonly AcousticEmbeddingRecord[],
  assignments: readonly AcousticAssignment[],
  exportedAt: string = new Date().toISOString(),
): VoiceEvaluationExport {
  const confirmed = meeting.speakers.filter((speaker) => speaker.confirmed);
  const referenceOf = new Map(confirmed.map((speaker, index) => [speaker.id, pseudonym("P", index)]));
  const usable = [...new Map(
    embeddings
      .filter(
        (embedding) =>
          embedding.recordingHash === meeting.audio?.hash &&
          embedding.values.length === ACOUSTIC_POLICY.dimensions &&
          embedding.values.every((value) => Number.isFinite(value)),
      )
      .map((embedding) => [embedding.id, embedding]),
  ).values()].sort(
    (left, right) =>
      left.chunkIndex - right.chunkIndex ||
      left.sample.startSeconds - right.sample.startSeconds ||
      left.id.localeCompare(right.id),
  );
  const samples: VoiceEvaluationSample[] = usable.map((embedding) => {
    const owner = cleanSampleOwner(meeting.segments, embedding.sample.startSeconds, embedding.sample.endSeconds);
    return {
      id: embedding.id,
      part: embedding.chunkIndex,
      label: embedding.sourceSpeakerId,
      start: embedding.sample.startSeconds,
      end: embedding.sample.endSeconds,
      reference: (owner && referenceOf.get(owner)) ?? null,
      values: embedding.values.map((value) => Math.round(value * 1e6) / 1e6),
    };
  });
  const current = assignments
    .filter((assignment) => assignment.recordingHash === meeting.audio?.hash && assignment.state !== "stale")
    .sort((left, right) => left.chunkIndex - right.chunkIndex || left.sourceSpeakerId.localeCompare(right.sourceSpeakerId));
  const voiceOf = new Map<string, string>();
  const decisions: VoiceEvaluationDecision[] = current.map((assignment) => {
    const decided = assignment.identityId && (assignment.state === "matched" || assignment.state === "new_identity");
    if (decided && !voiceOf.has(assignment.identityId!)) voiceOf.set(assignment.identityId!, pseudonym("V", voiceOf.size));
    return {
      part: assignment.chunkIndex,
      label: assignment.sourceSpeakerId,
      state: assignment.state,
      voice: decided ? voiceOf.get(assignment.identityId!)! : null,
    };
  });
  const first = usable[0];
  return {
    schemaVersion: 1,
    kind: VOICE_EVALUATION_KIND,
    exportedAt,
    model: {
      id: first?.modelId ?? ACOUSTIC_POLICY.modelId,
      revision: first?.modelRevision ?? ACOUSTIC_POLICY.modelRevision,
      extractionVersion: first?.extractionVersion ?? ACOUSTIC_POLICY.extractionVersion,
    },
    policy: {
      thresholdVersion: current[0]?.thresholdVersion ?? PART_MATCH_POLICY.version,
      floorCosine: PART_MATCH_POLICY.floorCosine,
      margin: PART_MATCH_POLICY.margin,
      withinPartMergeCosine: PART_MATCH_POLICY.withinPartMergeCosine,
    },
    recording: {
      parts: meeting.audio?.chunked?.chunkCount ?? 1,
      durationSeconds: meeting.audio?.duration ?? null,
    },
    reference: { source: "human-confirmed-speakers", speakers: meeting.speakers.length, confirmedSpeakers: confirmed.length },
    samples,
    decisions,
    differentLabelPairs: buildVoiceConstraints(meeting, usable).cannotLink.map(([left, right]) => [left, right]),
  };
}
