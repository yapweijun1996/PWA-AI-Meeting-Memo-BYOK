import { id, MAX_JOBS, type Job, type Meeting } from "../domain/model";
import { editMemoItem } from "../domain/memo-review";
import { getKey, getSelection, type Selection } from "../providers/credentials";
import { ProviderError } from "../providers/api";
import { MAX_SELECTED_TEXT, MAX_SUGGESTION_TEXT, requestContextualRewrite, type ContextualAction } from "../providers/contextual-rewrite";
import { getMeeting, saveMeeting } from "../storage/repository";
import { beginRequest, finishRequest, isProcessing } from "./runner";

export type ContextualSelection = { memoId: string; itemId: string; originalText: string; start: number; end: number };
export type ContextualSnapshot = NonNullable<Job["contextual"]>;

const MAX_MEETING_BYTES = 12 * 1024 * 1024;
// JSON escaping can take six bytes per character. Leave space for the saved
// result and subsequent bounded undo entry before authorizing a paid request.
const MAX_RESERVE_BYTES = (MAX_SUGGESTION_TEXT + 40_000) * 6 + 16_384;

function currentItem(meeting: Meeting, value: ContextualSelection) {
  const item = meeting.memos.find(memo => memo.id === value.memoId)?.items.find(note => note.id === value.itemId);
  if (!item || item.text !== value.originalText) throw new Error("Save the note and select the text again before continuing.");
  if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end <= value.start || value.end > value.originalText.length || value.end - value.start > MAX_SELECTED_TEXT || !value.originalText.slice(value.start, value.end).trim())
    throw new Error("Select 1–4,000 characters within one saved note.");
  return item;
}

export function contextualSnapshot(meeting: Meeting, selection: ContextualSelection, action: ContextualAction): ContextualSnapshot {
  const item = currentItem(meeting, selection);
  return {
    action, ...selection, selectedText: selection.originalText.slice(selection.start, selection.end),
    sourceRevision: meeting.revision, sources: structuredClone(item.sources), suggestion: null,
  };
}

export function hasUnresolvedContextualAttempt(meeting: Meeting): boolean {
  return meeting.jobs.some(job => !!job.contextual && (job.state === "in_flight" || job.state === "outcome_unknown"));
}

/** Explicitly confirmed one-request foreground attempt; saves the original and suggestion separately. */
export async function runContextualAssistant(
  meeting: Meeting,
  selected: ContextualSelection,
  action: ContextualAction,
  selection: Selection,
  reviewedUnknown: boolean,
  onCheckpoint?: (meeting: Meeting) => void,
): Promise<{ meeting: Meeting; jobId: string }> {
  if (isProcessing()) throw new Error("Finish the current request before starting another.");
  const chosen = getSelection("memo");
  if (chosen.provider !== selection.provider || chosen.model !== selection.model) throw new Error("The selected provider or model changed. Review the request again.");
  const key = getKey(selection.provider);
  if (!key.trim()) throw new Error("Add the selected provider key in Settings first.");
  if (meeting.jobs.length >= MAX_JOBS) throw new Error("Meeting history limit reached. Back up this meeting before further processing.");
  const snapshot = contextualSnapshot(meeting, selected, action);
  if (hasUnresolvedContextualAttempt(meeting) && !reviewedUnknown)
    throw new Error("Review provider billing for the earlier unresolved suggestion before confirming another request.");
  const requestController = beginRequest(meeting.id);
  const execute = async () => {
    let current = await getMeeting(meeting.id);
    if (!current || current.version !== meeting.version || current.revision !== snapshot.sourceRevision) throw new Error("This meeting changed. Reload and select the text again.");
    currentItem(current, selected);
    if (hasUnresolvedContextualAttempt(current) && !reviewedUnknown) throw new Error("Review provider billing for the earlier unresolved suggestion before confirming another request.");
    if (current.jobs.some(job => job.state === "in_flight" && !job.contextual)) throw new Error("Another request is active or needs review.");
    const now = new Date().toISOString();
    const job: Job = {
      id: id(), stage: "memo", state: "in_flight", billing: "possibly_charged", createdAt: now, updatedAt: now,
      requestId: null, message: "Contextual suggestion submitted. Keep this window open.", inputRevision: current.revision,
      provider: selection.provider, model: selection.model, estimateUsd: null, contextual: snapshot,
    };
    const planned = { ...current, schemaVersion: 2 as const, jobs: [...current.jobs, job] };
    if (new TextEncoder().encode(JSON.stringify(planned, null, 2)).byteLength + MAX_RESERVE_BYTES > MAX_MEETING_BYTES)
      throw new Error("This suggestion would exceed the safe backup budget. No request was sent.");
    current = await saveMeeting(planned);
    onCheckpoint?.(current);
    let usage: Job["usage"] = null, requestId: string | null = null, cost: number | null = null;
    const timer = setTimeout(() => requestController.abort(), 9 * 60 * 1000);
    try {
      const suggestion = await requestContextualRewrite(snapshot.selectedText, action, selection, key, requestController.signal, (u, request, reportedCost) => { usage = u; requestId = request; cost = reportedCost; });
      const latest = await getMeeting(meeting.id);
      if (!latest) throw new Error("The meeting is no longer available.");
      const savedJob = latest.jobs.find(value => value.id === job.id);
      if (!savedJob?.contextual || savedJob.state !== "in_flight") throw new Error("The request state changed while waiting.");
      const saved = await saveMeeting({ ...latest, jobs: latest.jobs.map(value => value.id === job.id ? {
        ...value, state: "completed" as const, billing: cost === null ? "possibly_charged" as const : "provider_reported" as const,
        updatedAt: new Date().toISOString(), requestId, usage, reportedCostUsd: cost,
        message: "Contextual suggestion saved for review; the note has not been changed.", contextual: { ...snapshot, suggestion },
      } : value) });
      onCheckpoint?.(saved);
      return { meeting: saved, jobId: job.id };
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError("Completion could not be confirmed or saved. Review billing before another attempt.", true);
      const latest = await getMeeting(meeting.id);
      if (latest) {
        try {
          const saved = await saveMeeting({ ...latest, jobs: latest.jobs.map(value => value.id === job.id && value.state === "in_flight" ? {
            ...value, state: failure.uncertain ? "outcome_unknown" as const : failure.submitted || failure.charged ? "failed" as const : "failed_before_send" as const,
            billing: cost !== null ? "provider_reported" as const : failure.uncertain || failure.submitted || failure.charged ? "possibly_charged" as const : "not_submitted" as const,
            updatedAt: new Date().toISOString(), requestId, usage, reportedCostUsd: cost,
            message: failure.message,
          } : value) });
          onCheckpoint?.(saved);
        } catch { /* A durable in-flight record remains; no request is repeated. */ }
      }
      throw failure;
    } finally { clearTimeout(timer); }
  };
  try {
    if (typeof navigator !== "undefined" && navigator.locks)
      return await navigator.locks.request(`meeting-memo-job:${meeting.id}`, { ifAvailable: true }, lock => {
        if (!lock) throw new Error("Another tab is processing this meeting.");
        return execute();
      });
    return await execute();
  } finally { finishRequest(requestController); }
}

/** Apply only an unchanged, saved selection; existing citations are retained but no longer reviewed. */
export async function applyContextualSuggestion(meeting: Meeting, jobId: string): Promise<Meeting> {
  const latest = await getMeeting(meeting.id);
  if (!latest || latest.version !== meeting.version) throw new Error("This meeting changed. Reload and compare the suggestion again.");
  const job = latest.jobs.find(value => value.id === jobId);
  const snapshot = job?.contextual;
  if (job?.state !== "completed" || !snapshot?.suggestion) throw new Error("This suggestion is not available.");
  if (latest.revision !== snapshot.sourceRevision) throw new Error("The transcript changed. Review the sources before using this suggestion.");
  const item = currentItem(latest, snapshot);
  if (JSON.stringify(item.sources) !== JSON.stringify(snapshot.sources)) throw new Error("The note's citations changed. Review the sources before applying the suggestion.");
  const result = snapshot.originalText.slice(0, snapshot.start) + snapshot.suggestion + snapshot.originalText.slice(snapshot.end);
  return saveMeeting(editMemoItem(latest, snapshot.memoId, snapshot.itemId, { text: result }));
}
