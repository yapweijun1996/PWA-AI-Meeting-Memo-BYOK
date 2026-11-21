import type { Job, Meeting } from "../domain/model";
import { getMeeting, saveMeeting } from "../storage/repository";
import { assertAgentStorageBudget } from "../providers/memo-agent-plan";

export type PendingAgentReceipt = {
  meetingId: string;
  agentId: string;
  job: Job;
  wireResponse?: string;
};
const pending = new Map<string, PendingAgentReceipt>();
const changed = () =>
  window.dispatchEvent(new Event("memo-agent-recovery-changed"));
export const pendingAgentReceipt = (meetingId: string) =>
  pending.get(meetingId);
export const pendingAgentMeetingId = () => pending.keys().next().value;
export function subscribeAgentRecovery(listener: () => void) {
  window.addEventListener("memo-agent-recovery-changed", listener);
  return () => window.removeEventListener("memo-agent-recovery-changed", listener);
}
export const hasPendingAgentReceipt = () => pending.size > 0;
export function retainAgentReceipt(receipt: PendingAgentReceipt) {
  pending.set(receipt.meetingId, structuredClone(receipt));
  changed();
}
export function acknowledgeAgentExport(meetingId: string) {
  pending.delete(meetingId);
  changed();
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
  const recovery = pending.get(meetingId);
  if (!recovery)
    throw new Error("No unsaved review response remains in this page.");
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
    if (!recovery.wireResponse) pending.delete(meetingId);
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
  const saved = await saveMeeting(value);
  if (!recovery.wireResponse) pending.delete(meetingId);
  changed();
  return saved;
}
