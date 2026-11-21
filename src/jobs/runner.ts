import { applyStandardMemoResult } from "./standard-memo-result";
import type { MemoTemplate } from "../domain/memo-templates";
import type { MemoOutputLanguage } from "../domain/memo-language";
import {
  runMemoPipeline,
  pipelineActive,
  cancelPipeline,
} from "./memo-pipeline";
import { needsMemoBillingReview, type MemoPipeline } from "../providers/memo-plan";
import type { Selection } from "../providers/credentials";
import { MAX_JOBS, id, type Meeting, type Job } from "../domain/model";
import { replaceTranscript } from "../domain/operations";
import { getMeeting, saveMeeting, getAudio } from "../storage/repository";
import { checkMemoBackupBudget } from "../storage/backup";
import { generateMemo, transcribe, ProviderError } from "../providers/api";
import {
  getKey,
  getSelection,
  getMemoOutputLanguage,
  getSpeechEstimate,
} from "../providers/credentials";
import { buildMemoInput } from "../providers/memo-input";
import type {MemoAgentPlan} from "../domain/model";
import { checkpointStandardReceipt, hasPendingAgentReceipt, StandardReceiptSaveError } from "./agent-recovery";
let controller: AbortController | undefined;
let activeMeetingId: string | undefined;
export const isProcessingMeeting = (id: string) =>
  (!!controller && activeMeetingId === id) || pipelineActive(id);
export const isProcessing = () => !!controller || pipelineActive();
export function beginRequest(meetingId: string): AbortController {
  if (isProcessing())
    throw new Error("Finish the current request before starting another.");
  controller = new AbortController();
  activeMeetingId = meetingId;
  window.dispatchEvent(new Event("memo-processing-changed"));
  return controller;
}
export function finishRequest(requestController: AbortController): void {
  if (controller !== requestController) return;
  controller = undefined;
  activeMeetingId = undefined;
  window.dispatchEvent(new Event("memo-processing-changed"));
}
export const cancelProcessing = () => {
  controller?.abort();
  cancelPipeline();
};
export async function runJob(
  m: Meeting,
  stage: Job["stage"],
  confirmed?: {
    selection: Selection;
    template?: MemoTemplate;
    outputLanguage?: MemoOutputLanguage;
    plan?: MemoPipeline | null;
    agentPlan?: MemoAgentPlan;
    reviewedRetry?: boolean;
    localOnly?: boolean;
    onCheckpoint?: (m: Meeting) => void;
  },
): Promise<Meeting> {
  if (hasPendingAgentReceipt()) throw new Error("Save or export the unsaved review response before another provider request.");
  if (isProcessing())
    throw new Error("Finish the current request before starting another.");
  if (m.jobs.some((j) => j.state === "in_flight"))
    throw new Error(
      "A request is active or its outcome needs review. Resolve it before submitting again.",
    );
  const localOnly = stage === "memo" && Boolean(confirmed?.agentPlan && confirmed.localOnly);
  if (!localOnly && (m.jobs.length >= MAX_JOBS || m.memos.length >= 30 || m.runs.length >= 30))
    throw new Error(
      "Meeting history limit reached. Back up this meeting and create a new one before further processing.",
    );
  const selection = confirmed?.selection ?? getSelection(stage);
  if (stage === "memo" && confirmed?.agentPlan) {
    if (selection.provider !== confirmed.agentPlan.provider || selection.model !== confirmed.agentPlan.model)
      throw new Error("The confirmed review changed. Open its confirmation again.");
    const requestController=beginRequest(m.id);
    try {
      const {runAgentMemo}=await import("./memo-agent");
      return await runAgentMemo(m,confirmed.agentPlan,localOnly ? "" : getKey(selection.provider),requestController.signal,confirmed.reviewedRetry,confirmed.onCheckpoint,localOnly);
    } finally {finishRequest(requestController);}
  }
  if (stage === "memo" && confirmed?.plan)
    return runMemoPipeline(
      m,
      selection,
      confirmed.plan,
      confirmed.reviewedRetry,
      confirmed.onCheckpoint,
    );
  const outputLanguage = confirmed?.outputLanguage ?? getMemoOutputLanguage();
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
    if (stage === "memo" && !confirmed?.reviewedRetry && needsMemoBillingReview(current, { selection }))
      throw new Error("Review the previous paid outcome before confirming another attempt.");
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
      ...(stage === "memo" ? {outputLanguage} : {}),
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
    const intent = { ...current, jobs: [...current.jobs, job] };
    await saveMeeting(stage === "memo" ? await checkMemoBackupBudget(intent, true) : intent);
    controller = new AbortController();
    activeMeetingId = m.id;
    window.dispatchEvent(new Event("memo-processing-changed"));
    const timer = setTimeout(() => controller?.abort(), 9 * 60 * 1000);
    const memoContext = { source: m, template: confirmed?.template };
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
              undefined,
              "",
              outputLanguage,
              confirmed?.template,
              body => checkpointStandardReceipt(m.id, job, body, memoContext),
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
        latest = applyStandardMemoResult(latest, job, memoContext, result);
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
      return await saveMeeting(stage === "memo" ? await checkMemoBackupBudget(latest) : latest);
    } catch (error) {
      if (error instanceof StandardReceiptSaveError) throw error;
      const failure =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              "Completion could not be confirmed or saved. Review the provider account before another submission.",
              true,
            );
      const latest = await getMeeting(m.id);
      if (latest) {
        const stopped: Meeting = {
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
        };
        await saveMeeting(stage === "memo" ? await checkMemoBackupBudget(stopped) : stopped);
      }
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
