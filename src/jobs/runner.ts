import {
  runMemoPipeline,
  pipelineActive,
  cancelPipeline,
} from "./memo-pipeline";
import type { MemoPipeline } from "../providers/memo-plan";
import type { Selection } from "../providers/credentials";
import { id, type Meeting, type Job } from "../domain/model";
import { replaceTranscript } from "../domain/operations";
import { getMeeting, saveMeeting, getAudio } from "../storage/repository";
import { generateMemo, transcribe, ProviderError } from "../providers/api";
import {
  getKey,
  getSelection,
  getSpeechEstimate,
} from "../providers/credentials";
import { buildMemoInput } from "../providers/memo-input";
let controller: AbortController | undefined;
let activeMeetingId: string | undefined;
export const isProcessingMeeting = (id: string) =>
  (!!controller && activeMeetingId === id) || pipelineActive(id);
export const isProcessing = () => !!controller || pipelineActive();
export const cancelProcessing = () => {
  controller?.abort();
  cancelPipeline();
};
export async function runJob(
  m: Meeting,
  stage: Job["stage"],
  confirmed?: {
    selection: Selection;
    plan?: MemoPipeline | null;
    reviewedRetry?: boolean;
    onCheckpoint?: (m: Meeting) => void;
  },
): Promise<Meeting> {
  if (isProcessing())
    throw new Error("Finish the current request before starting another.");
  if (m.jobs.some((j) => j.state === "in_flight"))
    throw new Error(
      "A request is active or its outcome needs review. Resolve it before submitting again.",
    );
  if (m.jobs.length >= 100 || m.memos.length >= 30 || m.runs.length >= 30)
    throw new Error(
      "Meeting history limit reached. Back up this meeting and create a new one before further processing.",
    );
  const selection = confirmed?.selection ?? getSelection(stage);
  if (stage === "memo" && confirmed?.plan)
    return runMemoPipeline(
      m,
      selection,
      confirmed.plan,
      confirmed.reviewedRetry,
      confirmed.onCheckpoint,
    );
  const provider = selection.provider === "openai" ? "OpenAI" : "OpenRouter";
  const key = getKey(selection.provider);
  if (!key) throw new Error(`Add your ${provider} key in Settings first.`);
  const audio = stage === "speech" ? await getAudio(m.id) : undefined;
  if (stage === "speech" && !audio)
    throw new Error("Attach the original recording before transcription.");
  if (stage === "memo") buildMemoInput(m);
  const execute = async () => {
    const current = await getMeeting(m.id);
    if (!current || current.version !== m.version)
      throw new Error(
        "This meeting changed. Reload before starting a request.",
      );
    const estimate =
      stage === "speech" ? getSpeechEstimate(m.audio?.duration) : null;
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
      provider: selection.provider,
      model: selection.model,
      estimateUsd: estimate?.amount ?? null,
      estimateDetails: estimate
        ? {
            rate: estimate.rate,
            seconds: estimate.seconds,
            source: estimate.source,
            date: estimate.date,
          }
        : null,
    };
    await saveMeeting({ ...m, jobs: [...m.jobs, job] });
    controller = new AbortController();
    activeMeetingId = m.id;
    window.dispatchEvent(new Event("memo-processing-changed"));
    const timer = setTimeout(() => controller?.abort(), 9 * 60 * 1000);
    let reportedUsage: Job["usage"] = null;
    let memoRequestId: string | null = null;
    let reportedCostUsd: number | null = null;
    try {
      const result =
        stage === "speech"
          ? await transcribe(
              audio!,
              key,
              controller.signal,
              selection,
              m.audio?.name,
              (account) => {
                reportedUsage = account.usage;
                memoRequestId = account.requestId;
                reportedCostUsd = account.cost;
              },
            )
          : await generateMemo(
              m,
              key,
              controller.signal,
              (usage, requestId, cost) => {
                reportedUsage = usage;
                memoRequestId = requestId;
                reportedCostUsd = cost;
              },
              selection,
            );
      let latest = await getMeeting(m.id);
      if (!latest) throw new Error("The meeting was removed while processing.");
      let requestId: string | null = memoRequestId;
      if (stage === "speech" && !Array.isArray(result)) {
        requestId = memoRequestId ?? result.requestId;
        if (latest.revision === m.revision)
          latest = replaceTranscript(
            latest,
            result.speakers,
            result.segments,
            provider,
            selection.model,
          );
        else
          latest = {
            ...latest,
            runs: [
              ...latest.runs,
              {
                id: id(),
                provider,
                model: selection.model,
                createdAt: new Date().toISOString(),
                speakers: result.speakers,
                originalSegments: result.segments,
              },
            ],
          };
        if (latest.audio && result.duration !== null)
          latest.audio = { ...latest.audio, duration: result.duration };
      } else if (Array.isArray(result))
        latest = {
          ...latest,
          memos: [
            ...latest.memos,
            {
              id: id(),
              model: `${provider}: ${selection.model}`.slice(0, 100),
              createdAt: new Date().toISOString(),
              sourceRevision: m.revision,
              items: result,
              originalItems: structuredClone(result),
            },
          ],
        };
      latest.jobs = latest.jobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              state: "completed",
              billing:
                reportedCostUsd === null
                  ? "possibly_charged"
                  : "provider_reported",
              requestId,
              usage: reportedUsage,
              reportedCostUsd,
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
                  reportedCostUsd,
                  requestId: memoRequestId,
                  state: failure.uncertain ? "outcome_unknown" : "failed",
                  billing:
                    reportedCostUsd !== null
                      ? "provider_reported"
                      : failure.uncertain || failure.charged
                        ? "possibly_charged"
                        : failure.submitted
                          ? "possibly_charged"
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
