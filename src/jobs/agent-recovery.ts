import type { Job, Meeting } from "../domain/model";
import { getMeeting, saveMeeting } from "../storage/repository";
import { checkMemoBackupBudget } from "../storage/backup";
import { assertAgentStorageBudget } from "../providers/memo-agent-plan";
import { applyStandardMemoResult, type StandardMemoContext } from "./standard-memo-result";
import { buildMemoInput } from "../providers/memo-input";
import { accounting, parseStandardMemoResponse } from "../providers/api";
import type { MemoRecoveryArtifact } from "../providers/memo-response-redaction";

export type PendingAgentReceipt = {
  meetingId: string;
  agentId: string;
  job: Job;
  recoveryArtifact?: MemoRecoveryArtifact;
};
/** Standard response retained in this page until saved locally or explicitly acknowledged after export. */
export type PendingStandardReceipt = {
  kind: "standard";
  meetingId: string;
  job: Job & { memoResponse: string };
  recoveryArtifact?: never;
};
export type PendingMemoReceipt = PendingAgentReceipt | PendingStandardReceipt;
// Only the live page needs the frozen input. It must never enter the receipt download.
const pending = new Map<string, { receipt: PendingMemoReceipt; context?: StandardMemoContext }>();

/** Pure export payload for recovery controls, including when the meeting was removed. */
export function receiptExport(receipt: PendingMemoReceipt) {
  const format = "meeting-memo-agent-receipt";
  if (!receipt.recoveryArtifact) return { format, version: 1, ...receipt };
  // An interrupted job can also hold a partial SDK record. Export only the masked projection of its content.
  const { assistantRecord: _assistantRecord, ...job } = receipt.job;
  return { format, version: 2, ...receipt, job };
}
const changed = () =>
  window.dispatchEvent(new Event("memo-agent-recovery-changed"));
export const pendingAgentReceipt = (meetingId: string) =>
  pending.get(meetingId)?.receipt;
export const pendingAgentMeetingId = () => pending.keys().next().value;
export function subscribeAgentRecovery(listener: () => void) {
  window.addEventListener("memo-agent-recovery-changed", listener);
  return () => window.removeEventListener("memo-agent-recovery-changed", listener);
}
export const hasPendingAgentReceipt = () => pending.size > 0;
export function retainAgentReceipt(receipt: PendingMemoReceipt, context?: StandardMemoContext) {
  pending.set(receipt.meetingId, { receipt: structuredClone(receipt), context });
  changed();
}
export function acknowledgeAgentExport(meetingId: string) {
  pending.delete(meetingId);
  changed();
}

export class StandardReceiptSaveError extends Error {
  constructor() {
    super("The memo response was received. Retry local saving or export the unsaved response before leaving this page.");
  }
}

async function saveMemoResponse(meetingId: string, jobId: string, body: string) {
  const latest = await getMeeting(meetingId);
  const job = latest?.jobs.find(job => job.id === jobId);
  if (!latest || !job)
    throw new Error("The meeting no longer contains this memo request.");
  if (job.memoResponse === body) return;
  if (job.memoResponse !== undefined)
    throw new Error("A different response is already saved for this request.");
  const value = await checkMemoBackupBudget({ ...latest, jobs: latest.jobs.map(value =>
    value.id === jobId ? { ...value, memoResponse: body } : value) });
  await saveMeeting(value, undefined, true);
}

/** Record the body first. If storage fails, publish the page copy before any further I/O. */
export async function checkpointStandardReceipt(meetingId: string, job: Job, body: string, context: StandardMemoContext) {
  try {
    await saveMemoResponse(meetingId, job.id, body);
  } catch {
    const error = new StandardReceiptSaveError();
    const failed: PendingStandardReceipt["job"] = {
      ...job, memoResponse: body, state: "failed", updatedAt: new Date().toISOString(),
      message: "Memo response received. Its body could not be saved. Save or export the copy held by the original page.",
    };
    try {
      if (job.provider) {
        const { requestId, usage, cost } = accounting(JSON.parse(body), job.provider);
        failed.requestId = requestId;
        failed.usage = usage;
        failed.reportedCostUsd = cost;
        if (cost !== null) failed.billing = "provider_reported";
      }
    } catch { /* A malformed body remains exportable in full. */ }
    const receipt: PendingStandardReceipt = { kind: "standard", meetingId, job: failed };
    retainAgentReceipt(receipt, context);
    try {
      await saveStandardReceipt(receipt, false);
    } catch { /* Even a metadata-only write may fail. Keep the page receipt. */ }
    throw error;
  }
}

async function saveStandardReceipt(receipt: PendingStandardReceipt, includeBody: boolean, context?: StandardMemoContext): Promise<Meeting> {
  const latest = await getMeeting(receipt.meetingId);
  const existing = latest?.jobs.find(job => job.id === receipt.job.id);
  if (!latest || !existing)
    throw new Error("The meeting no longer contains this request. Export the unsaved response.");
  const { memoResponse, ...outcome } = receipt.job;
  const unresolved = existing.state === "in_flight" || existing.state === "outcome_unknown";
  if (existing.memoResponse !== undefined) {
    if (existing.memoResponse !== memoResponse)
      throw new Error("A different response is already saved for this request. Export this copy.");
    if (!unresolved) return latest;
  }
  const updated = { ...existing };
  if (unresolved) {
    updated.state = outcome.state;
    updated.requestId ??= outcome.requestId;
    updated.usage ??= outcome.usage;
    updated.reportedCostUsd ??= outcome.reportedCostUsd;
    updated.billing = updated.reportedCostUsd != null ? "provider_reported" : outcome.billing;
    updated.updatedAt = new Date().toISOString();
    updated.message = outcome.message;
  }
  if (includeBody) updated.memoResponse = memoResponse;
  if (updated.memoResponse !== undefined && updated.message === outcome.message)
    updated.message = "Memo response saved locally. Review the recorded response.";

  let value = { ...latest, jobs: latest.jobs.map(job => job.id === existing.id ? updated : job) };
  // An older receipt cannot rewind a pipeline that another tab has since continued.
  if (existing.pipelineId && unresolved) {
    const lastAttempt = latest.jobs.filter(job => job.pipelineId === existing.pipelineId).at(-1);
    if (lastAttempt?.id === existing.id)
      value.memoPipelines = latest.memoPipelines?.map(plan => plan.id === existing.pipelineId && plan.state === "running"
        ? { ...plan, state: "blocked" } : plan);
  }
  if (includeBody && context && updated.state !== "completed") {
    try {
      const input = context.prepared ?? buildMemoInput(context.source);
      const items = parseStandardMemoResponse(JSON.parse(memoResponse), context.source, input, context.template, updated.outputLanguage);
      value = applyStandardMemoResult(value, updated, context, items, true);
      updated.state = "completed";
      updated.message = "Result recovered locally. Review the generated result.";
    } catch {
      // Even invalid output or a superseded plan must retain the complete paid receipt.
      updated.message = "Response saved locally. Its result could not be applied. Review the recorded response.";
    }
  }
  return saveMeeting(await checkMemoBackupBudget(value), undefined, true);
}

/** Save a known response locally; never repeat the provider request or overwrite a newer plan. */
export async function recoverAgentReceipt(meetingId: string): Promise<Meeting> {
  if (navigator.locks)
    return navigator.locks.request(
      `meeting-memo-job:${meetingId}`,
      { ifAvailable: true },
      (lock) => {
        if (!lock) throw new Error("Another tab is processing this meeting.");
        return saveAgentReceipt(meetingId);
      },
    );
  return saveAgentReceipt(meetingId);
}

async function saveAgentReceipt(meetingId: string): Promise<Meeting> {
  const entry = pending.get(meetingId);
  const recovery = entry?.receipt;
  if (!recovery)
    throw new Error("No unsaved review response remains in this page.");
  if ("kind" in recovery) {
    const saved = await saveStandardReceipt(recovery, true, entry.context);
    pending.delete(meetingId);
    changed();
    return saved;
  }
  const latest = await getMeeting(meetingId);
  if (!latest)
    throw new Error(
      "The meeting was removed. Export the unsaved response before leaving.",
    );
  const plan = latest.memoAgents?.find(
    (value) => value.id === recovery.agentId,
  );
  const existing = latest.jobs.find((job) => job.id === recovery.job.id);
  if (!plan || !existing || !plan.jobIds.includes(existing.id))
    throw new Error(
      "The saved review no longer contains this request. Export its response.",
    );
  if (
    existing.assistantRecord !== undefined &&
    existing.assistantRecord !== recovery.job.assistantRecord
  )
    throw new Error(
      "A different response is already saved for this request. Export this copy for review.",
    );
  if (
    existing.assistantRecord !== undefined &&
    existing.assistantRecord === recovery.job.assistantRecord &&
    existing.state === recovery.job.state
  ) {
    if (!recovery.recoveryArtifact) pending.delete(meetingId);
    changed();
    return latest;
  }
  const atLastAttempt = plan.jobIds.at(-1) === recovery.job.id;
  const append =
    !!recovery.job.assistantRecord &&
    recovery.job.state === "completed" &&
    atLastAttempt &&
    !plan.context.some(
      (item) => item.kind === "assistant" && item.jobId === recovery.job.id,
    );
  const updated = atLastAttempt
    ? {
        ...plan,
        state:
          plan.state === "completed"
            ? ("completed" as const)
            : ("paused" as const),
        context: append
          ? [
              ...plan.context,
              { kind: "assistant" as const, jobId: recovery.job.id },
            ]
          : plan.context,
      }
    : plan;
  const value = {
    ...latest,
    jobs: latest.jobs.map((job) =>
      job.id === existing.id ? recovery.job : job,
    ),
    memoAgents: latest.memoAgents!.map((value) =>
      value.id === plan.id ? updated : value,
    ),
  };
  assertAgentStorageBudget(value, false);
  const saved = await saveMeeting(value, undefined, true);
  if (!recovery.recoveryArtifact) pending.delete(meetingId);
  changed();
  return saved;
}
