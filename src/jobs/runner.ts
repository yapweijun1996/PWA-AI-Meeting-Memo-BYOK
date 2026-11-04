import { id, type Meeting, type Job } from "../domain/model";
import { replaceTranscript } from "../domain/operations";
import { getMeeting, saveMeeting, getAudio } from "../storage/repository";
import { generateMemo, transcribe, ProviderError } from "../providers/api";
import { getKey, getSpeechRate } from "../providers/credentials";
let controller: AbortController | undefined;
let activeMeetingId: string | undefined;
export const isProcessingMeeting = (id: string) =>
  !!controller && activeMeetingId === id;
export const isProcessing = () => !!controller;
export const cancelProcessing = () => controller?.abort();
export async function runJob(
  m: Meeting,
  stage: Job["stage"],
): Promise<Meeting> {
  if (controller)
    throw new Error("Finish the current request before starting another.");
  if (m.jobs.some((j) => j.state === "in_flight"))
    throw new Error(
      "A request is active or its outcome needs review. Resolve it before submitting again.",
    );
  if (m.jobs.length >= 100 || m.memos.length >= 30 || m.runs.length >= 30)
    throw new Error(
      "Meeting history limit reached. Back up this meeting and create a new one before further processing.",
    );
  const key = getKey(stage === "speech" ? "deepgram" : "openai");
  if (!key)
    throw new Error(
      `Add your ${stage === "speech" ? "Deepgram" : "OpenAI"} key in Settings first.`,
    );
  const audio = stage === "speech" ? await getAudio(m.id) : undefined;
  if (stage === "speech" && !audio)
    throw new Error("Attach the original recording before transcription.");
  if (
    stage === "memo" &&
    (!m.segments.length || JSON.stringify(m.segments).length > 120000)
  )
    throw new Error(
      "Add a supported transcript first; this meeting exceeds the supported memo limit if its text is too long.",
    );
  const execute = async () => {
    const current = await getMeeting(m.id);
    if (!current || current.version !== m.version)
      throw new Error(
        "This meeting changed. Reload before starting a request.",
      );
    const job: Job = {
      id: id(),
      stage,
      state: "in_flight",
      billing: "possibly_charged",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestId: null,
      message: "Request submitted. Keep this window open.",
      inputRevision: m.revision,
      estimateUsd:
        stage === "speech" && getSpeechRate() !== null && m.audio?.duration
          ? (getSpeechRate()! * m.audio.duration) / 60
          : null,
    };
    await saveMeeting({ ...m, jobs: [...m.jobs, job] });
    controller = new AbortController();
    activeMeetingId = m.id;
    window.dispatchEvent(new Event("memo-processing-changed"));
    const timer = setTimeout(() => controller?.abort(), 9 * 60 * 1000);
    let reportedUsage: Job["usage"] = null;
    let memoRequestId: string | null = null;
    try {
      const result =
        stage === "speech"
          ? await transcribe(audio!, key, controller.signal)
          : await generateMemo(
              m,
              key,
              controller.signal,
              (usage, requestId) => {
                reportedUsage = usage;
                memoRequestId = requestId;
              },
            );
      let latest = await getMeeting(m.id);
      if (!latest) throw new Error("The meeting was removed while processing.");
      let requestId: string | null = memoRequestId;
      if (stage === "speech" && !Array.isArray(result)) {
        requestId = result.requestId;
        reportedUsage = {
          inputTokens: null,
          outputTokens: null,
          seconds: result.duration,
        };
        if (latest.revision === m.revision)
          latest = replaceTranscript(
            latest,
            result.speakers,
            result.segments,
            "Deepgram",
            "nova-3 / diarizer v2",
          );
        else
          latest = {
            ...latest,
            runs: [
              ...latest.runs,
              {
                id: id(),
                provider: "Deepgram",
                model: "nova-3 / diarizer v2",
                createdAt: new Date().toISOString(),
                speakers: result.speakers,
                originalSegments: result.segments,
              },
            ],
          };
        if (latest.audio)
          latest.audio = { ...latest.audio, duration: result.duration };
      } else if (Array.isArray(result))
        latest = {
          ...latest,
          memos: [
            ...latest.memos,
            {
              id: id(),
              model: "gpt-6-luna",
              createdAt: new Date().toISOString(),
              sourceRevision: m.revision,
              items: result,
            },
          ],
        };
      latest.jobs = latest.jobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              state: "completed",
              billing: "provider_reported",
              requestId,
              usage: reportedUsage,
              updatedAt: new Date().toISOString(),
              message:
                latest!.revision !== m.revision && stage === "speech"
                  ? "Result saved in transcription history; source changed while processing."
                  : "Completed. Review the generated result.",
            }
          : j,
      );
      return await saveMeeting(latest);
    } catch (error) {
      const failure =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              "Completion could not be confirmed or saved. Review the provider account before another submission.",
              true,
            );
      const latest = await getMeeting(m.id);
      if (latest)
        await saveMeeting({
          ...latest,
          jobs: latest.jobs.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  usage: reportedUsage,
                  requestId: memoRequestId,
                  state: failure.uncertain ? "outcome_unknown" : "failed",
                  billing: failure.uncertain
                    ? "possibly_charged"
                    : failure.charged
                      ? "provider_reported"
                      : "not_submitted",
                  updatedAt: new Date().toISOString(),
                  message: failure.message,
                }
              : j,
          ),
        });
      throw failure;
    } finally {
      clearTimeout(timer);
      controller = undefined;
      activeMeetingId = undefined;
      window.dispatchEvent(new Event("memo-processing-changed"));
    }
  };
  if (navigator.locks)
    return navigator.locks.request(
      `meeting-memo-job:${m.id}`,
      { ifAvailable: true },
      (lock) => {
        if (!lock) throw new Error("Another tab is processing this meeting.");
        return execute();
      },
    );
  return execute();
}
