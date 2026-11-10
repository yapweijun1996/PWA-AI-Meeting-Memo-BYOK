import { applyAcousticAssignments } from "../domain/acoustic-speaker";
import { linkChunkSpeakers, mergeChunkSpeech, type ChunkSpeechInput } from "../domain/long-audio";
import { id, MAX_JOBS, type Job, type Meeting } from "../domain/model";
import { replaceTranscript } from "../domain/operations";
import { ProviderError, transcribe } from "../providers/api";
import { getKey, getSpeechEstimate, type Selection } from "../providers/credentials";
import { getChunkSpeech, listChunkSpeechIndexes, putChunkSpeech } from "../storage/chunk-speech-store";
import { getLongAudioChunk, getLongAudioManifest } from "../storage/long-audio-store";
import {
  listAcousticAssignments,
  listAcousticIdentities,
  getTranscriptPage,
  listChunkAttempts,
  putChunkAttempt,
  putTranscriptPage,
} from "../storage/acoustic-store";
import { getMeeting, saveMeeting } from "../storage/repository";
import { beginRequest, finishRequest, isProcessing } from "./runner";
import { runAcousticContinuity, type AcousticContinuityProgress } from "./acoustic-continuity";
import type { BrowserSpeakerEmbeddingProvider } from "../audio/speaker-embedding";

export async function getChunkedProgress(m: Meeting): Promise<{ total: number; done: number; nextIndex: number; blockedIndex: number | null }> {
  const total = m.audio?.chunked?.chunkCount ?? 0;
  const indexes = await listChunkSpeechIndexes(m.id);
  const stored = new Set(indexes);
  let nextIndex = 0;
  while (nextIndex < total && stored.has(nextIndex)) nextIndex += 1;
  const blockedIndex = m.jobs
    .filter((job) => job.chunk && !stored.has(job.chunk.index) && (job.state === "outcome_unknown" || job.state === "in_flight"))
    .sort((left, right) => left.chunk!.index - right.chunk!.index)[0]?.chunk?.index ?? null;
  return { total, done: indexes.length, nextIndex, blockedIndex };
}

type Confirmed = {
  selection: Selection;
  reviewedChunks?: number[];
  onProgress?: (progress: { done: number; total: number; index: number }) => void;
  acoustic?: {
    provider: BrowserSpeakerEmbeddingProvider;
    consent: boolean;
    onProgress?: (progress: AcousticContinuityProgress) => void;
    /** Optional, from a person: how many people spoke. */
    expectedVoices?: number;
  };
  /** Used by the UI to include explicit model preparation in the same cancelable run. */
  requestController?: AbortController;
};

export async function runChunkedSpeech(m: Meeting, confirmed: Confirmed): Promise<Meeting> {
  if (isProcessing() && !confirmed.requestController) throw new Error("Finish the current request before starting another.");
  if (m.jobs.some((job) => job.state === "in_flight" && !job.chunk))
    throw new Error("A request is active or its outcome needs review. Resolve it before submitting again.");
  const audioMeta = m.audio;
  if (!audioMeta?.chunked) throw new Error("This meeting has no chunked recording to transcribe.");
  if (m.jobs.length >= MAX_JOBS || m.memos.length >= 30 || m.runs.length >= 30)
    throw new Error("Meeting history limit reached. Back up this meeting and create a new one before further processing.");
  const selection = confirmed.selection;
  const provider = selection.provider === "openai" ? "OpenAI" : "OpenRouter";
  const key = getKey(selection.provider);
  if (!key) throw new Error(`Add your ${provider} key in Settings first.`);
  const manifest = await getLongAudioManifest(m.id);
  if (!manifest) throw new Error("The chunk manifest is missing. Reattach or restore the long recording before transcription.");
  if (manifest.manifestSha256 !== audioMeta.chunked.manifestSha256 || manifest.chunks.length !== audioMeta.chunked.chunkCount)
    throw new Error("The chunk manifest does not match this meeting's recording metadata.");
  if (manifest.format !== audioMeta.chunked.format || manifest.totalSeconds !== audioMeta.chunked.totalSeconds)
    throw new Error("The chunk manifest does not match this meeting's recording metadata.");

  const execute = async (): Promise<Meeting> => {
    const current = await getMeeting(m.id);
    if (!current || current.version !== m.version)
      throw new Error("This meeting changed. Reload before starting a request.");
    let working = current;
    const priorAttempt = (await listChunkAttempts(m.id))
      .filter((attempt) => attempt.recordingHash === audioMeta.hash && attempt.sourceRevision === m.revision)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const runId = priorAttempt?.runId ?? id();
    const requestController = confirmed.requestController ?? beginRequest(m.id);
    const ownsRequestController = confirmed.requestController === undefined;
    try {
    const storedIndexes = new Set(await listChunkSpeechIndexes(m.id));
    for (const meta of manifest.chunks) {
      if (storedIndexes.has(meta.index)) {
        const savedSpeech = await getChunkSpeech(m.id, meta.index);
        if (!savedSpeech) throw new Error(`Saved speech for chunk ${meta.index + 1} is missing.`);
        if (!(await getTranscriptPage(m.id, runId, meta.index))) {
          await putTranscriptPage({
            meetingId: m.id,
            runId,
            recordingHash: audioMeta.hash,
            sourceRevision: m.revision,
            pageIndex: meta.index,
            provider,
            model: selection.model,
            chunkIndex: meta.index,
            sourceStartSeconds: meta.ownStartSeconds,
            sourceEndSeconds: meta.ownStartSeconds + meta.ownDurationSeconds,
            original: savedSpeech,
            createdAt: new Date().toISOString(),
          });
        }
        const interrupted = [...working.jobs].reverse().find((job) => job.chunk?.index === meta.index && (job.state === "in_flight" || job.state === "outcome_unknown"));
        if (interrupted) {
          working = await saveMeeting({
            ...working,
            jobs: working.jobs.map((job) => job.id === interrupted.id
              ? { ...job, state: "completed", updatedAt: new Date().toISOString(), message: "Saved chunk speech recovered; no provider request was repeated." }
              : job),
          });
        }
        continue;
      }
      const unresolved = working.jobs.find((job) => job.chunk?.index === meta.index && (job.state === "outcome_unknown" || job.state === "in_flight"));
      if (unresolved && !confirmed.reviewedChunks?.includes(meta.index))
        throw new Error(`Chunk ${meta.index + 1} has an unresolved request outcome. Review billing before explicitly resubmitting it.`);
      if (working.jobs.length >= MAX_JOBS)
        throw new Error("Meeting history limit reached. Back up this meeting before further processing.");
      const estimate = getSpeechEstimate(meta.ownDurationSeconds + meta.leadInSeconds);
      const job: Job = {
        id: id(), stage: "speech", state: "in_flight", billing: "possibly_charged",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), requestId: null,
        message: "Request submitted. Keep this window open.", inputRevision: m.revision,
        provider: selection.provider, model: selection.model,
        estimateUsd: estimate?.amount ?? null,
        estimateDetails: estimate ? { rate: estimate.rate, seconds: estimate.seconds, source: estimate.source, date: estimate.date } : null,
        chunk: { index: meta.index, total: manifest.chunks.length },
      };
      const audio = await getLongAudioChunk(m.id, meta.index, { verify: true });
      working = await saveMeeting({ ...working, jobs: [...working.jobs, job] });
      const attemptStarted = new Date().toISOString();
      await putChunkAttempt({
        meetingId: m.id,
        runId,
        recordingHash: audioMeta.hash,
        sourceRevision: m.revision,
        chunkIndex: meta.index,
        provider,
        model: selection.model,
        state: "submitted",
        requestId: null,
        originalSaved: false,
        createdAt: attemptStarted,
        updatedAt: attemptStarted,
        message: "Speech request submitted; original result is retained separately from acoustic analysis.",
      });
      const timer = setTimeout(() => requestController.abort(), 9 * 60 * 1000);
      let reportedUsage: Job["usage"] = null;
      let requestId: string | null = null;
      let reportedCostUsd: number | null = null;
      try {
        const speech = await transcribe(audio, key, requestController.signal, selection, `recording-${String(meta.index + 1).padStart(4, "0")}.${manifest.format}`, (account) => {
          reportedUsage = account.usage;
          requestId = account.requestId;
          reportedCostUsd = account.cost;
        });
        await putChunkSpeech(m.id, meta.index, speech);
        // The paid provider result is durable before any local page/voice
        // analysis. A later local failure must never cause a paid resubmission.
        storedIndexes.add(meta.index);
        await putTranscriptPage({
          meetingId: m.id,
          runId,
          recordingHash: audioMeta.hash,
          sourceRevision: m.revision,
          pageIndex: meta.index,
          provider,
          model: selection.model,
          chunkIndex: meta.index,
          sourceStartSeconds: meta.ownStartSeconds,
          sourceEndSeconds: meta.ownStartSeconds + meta.ownDurationSeconds,
          original: speech,
          createdAt: new Date().toISOString(),
        });
        await putChunkAttempt({
          meetingId: m.id,
          runId,
          recordingHash: audioMeta.hash,
          sourceRevision: m.revision,
          chunkIndex: meta.index,
          provider,
          model: selection.model,
          state: "completed",
          requestId: requestId ?? speech.requestId,
          originalSaved: true,
          createdAt: attemptStarted,
          updatedAt: new Date().toISOString(),
          message: "Original provider output and source page saved.",
        });
        const latest = await getMeeting(m.id);
        if (!latest) throw new Error("The meeting was removed while processing.");
        const completedAt = new Date().toISOString();
        working = await saveMeeting({ ...latest, jobs: latest.jobs.map((saved) => saved.id === job.id ? {
          ...saved, state: "completed", billing: reportedCostUsd === null ? "possibly_charged" : "provider_reported",
          requestId: requestId ?? speech.requestId, usage: reportedUsage, reportedCostUsd,
          updatedAt: completedAt, message: "Chunk completed and saved.",
        } : saved) });
        confirmed.onProgress?.({ done: storedIndexes.size, total: manifest.chunks.length, index: meta.index });
      } catch (error) {
        const failure = error instanceof ProviderError ? error : new ProviderError(
          "Completion could not be confirmed or saved. Review the provider account before another submission.", true,
        );
        const latest = await getMeeting(m.id);
        if (latest) {
          const failedAt = new Date().toISOString();
          await saveMeeting({ ...latest, jobs: latest.jobs.map((saved) => saved.id === job.id ? {
            ...saved, usage: reportedUsage, reportedCostUsd, requestId,
            state: failure.uncertain ? "outcome_unknown" : failure.submitted ? "failed" : "failed_before_send",
            billing: reportedCostUsd !== null ? "provider_reported" : failure.uncertain || failure.charged || failure.submitted ? "possibly_charged" : "not_submitted",
            updatedAt: failedAt, message: failure.message,
          } : saved) });
        }
        await putChunkAttempt({
          meetingId: m.id,
          runId,
          recordingHash: audioMeta.hash,
          sourceRevision: m.revision,
          chunkIndex: meta.index,
          provider,
          model: selection.model,
          state: failure.uncertain ? "outcome_unknown" : "failed",
          requestId,
          originalSaved: storedIndexes.has(meta.index),
          createdAt: attemptStarted,
          updatedAt: new Date().toISOString(),
          message: failure.message,
        }).catch(() => undefined);
        throw failure;
      } finally {
        clearTimeout(timer);
      }
    }

    const inputs: ChunkSpeechInput[] = [];
    for (const meta of manifest.chunks) {
      const speech = await getChunkSpeech(m.id, meta.index);
      if (!speech) throw new Error(`Saved speech for chunk ${meta.index + 1} is missing.`);
      inputs.push({ chunk: meta, speech });
    }
    const merged = mergeChunkSpeech(inputs);
    const speakerLinks = linkChunkSpeakers(inputs).slice(0, 200);
    let speech = merged.speech;
    let acousticAssignments = await listAcousticAssignments(m.id);
    let acousticIdentities = await listAcousticIdentities(m.id);
    const analysisNotes: string[] = [];
    if (confirmed.acoustic) {
      try {
        await runAcousticContinuity({
          meetingId: m.id,
          recordingHash: audioMeta.hash,
          sourceRevision: m.revision,
          manifest,
          provider: confirmed.acoustic.provider,
          consent: confirmed.acoustic.consent,
          signal: requestController.signal,
          onProgress: confirmed.acoustic.onProgress,
          expectedVoices: confirmed.acoustic.expectedVoices,
        });
      } catch (error) {
        analysisNotes.push(`Local acoustic analysis is unresolved: ${error instanceof Error ? error.message : "retry the local analysis"}`);
      }
      acousticAssignments = await listAcousticAssignments(m.id);
      acousticIdentities = await listAcousticIdentities(m.id);
    }
    const latest = await getMeeting(m.id);
    if (!latest) throw new Error("The meeting was removed while processing.");
    if (latest.revision === m.revision) {
      speech = applyAcousticAssignments(
        speech,
        acousticAssignments,
        acousticIdentities,
        latest.speakers,
        { recordingHash: audioMeta.hash, sourceRevision: m.revision },
      );
    }
    let result = latest;
    if (latest.revision === m.revision) {
      result = replaceTranscript(latest, speech.speakers, speech.segments, provider, selection.model, {
        runId,
        originalSpeakers: merged.speech.speakers,
        originalSegments: merged.speech.segments,
      });
      result.speakerLinks = speakerLinks;
    } else result = {
      ...latest,
      runs: [...latest.runs, { id: runId, provider, model: selection.model, createdAt: new Date().toISOString(), speakers: merged.speech.speakers, originalSegments: merged.speech.segments }],
    };
    const lastJobId = [...result.jobs].reverse().find((job) => job.chunk)?.id;
    result.jobs = result.jobs.map((job) => job.id === lastJobId ? {
      ...job,
      message: `${latest.revision === m.revision ? "Completed. Review the generated result." : "Result saved in transcription history; source changed while processing."}${merged.notes.length ? ` ${merged.notes.join(" ")}` : ""}${analysisNotes.length ? ` ${analysisNotes.join(" ")}` : ""}`.slice(0, 1000),
    } : job);
    const saved = await saveMeeting(result);
    return saved;
    } finally {
      if (ownsRequestController) finishRequest(requestController);
    }
  };

  if (navigator.locks) {
    return navigator.locks.request(`meeting-memo-job:${m.id}`, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is already processing this meeting.");
      return execute();
    });
  }
  return execute();
}
