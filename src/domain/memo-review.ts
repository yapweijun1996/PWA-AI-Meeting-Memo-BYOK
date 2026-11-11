import { id, type Meeting, type MemoItem } from "./model";

export type MemoVersion = Meeting["memos"][number];
export type PriorityReason = "decision" | "action" | "question" | "risk" | "source_changed" | "edited" | "many_sources" | "missing_owner" | "missing_due";
export type ReviewScope = { kind: "all" | "priority"; itemIds: string[] };
export type MemoReviewSummary = {
  total: number;
  reviewed: number;
  pending: number;
  accepted: number;
  rejected: number;
  edited: number;
  stale: number;
  priorityItemIds: string[];
  priorityReasons: Record<string, PriorityReason[]>;
};

// JSON exports are pretty-printed and imports reject files above 12 MiB.
// Reserve room for the repository's version/timestamp update and audio flag.
export const MAX_RESTORABLE_JSON_BYTES = 12 * 1024 * 1024;
const BACKUP_RESERVE_BYTES = 4096;
const backupBytes = (meeting: Meeting) => new TextEncoder().encode(JSON.stringify(meeting, null, 2)).byteLength;

/** Reject growth past the backup limit; allow a reduction in an already-large legacy record. */
export function ensureRestorableBackup(before: Meeting, next: Meeting): Meeting {
  const nextBytes = backupBytes(next);
  if (nextBytes > MAX_RESTORABLE_JSON_BYTES - BACKUP_RESERVE_BYTES) {
    const beforeBytes = backupBytes(before);
    if (nextBytes >= beforeBytes || beforeBytes <= MAX_RESTORABLE_JSON_BYTES - BACKUP_RESERVE_BYTES)
      throw new Error("This change would exceed the safe meeting backup limit. Back up or reduce the meeting before continuing.");
  }
  return next;
}

const memoOrThrow = (meeting: Meeting, memoId: string): MemoVersion => {
  const memo = meeting.memos.find(value => value.id === memoId);
  if (!memo) throw new Error("This memo version is no longer available.");
  return memo;
};

/** Priority is an explicit review rule, not a model confidence or factuality score. */
export function summarizeMemoReview(meeting: Meeting, memoId: string): MemoReviewSummary {
  const memo = memoOrThrow(meeting, memoId);
  const summary: MemoReviewSummary = { total: memo.items.length, reviewed: 0, pending: 0, accepted: 0, rejected: 0, edited: 0, stale: 0, priorityItemIds: [], priorityReasons: {} };
  for (const item of memo.items) {
    const stale = memo.sourceRevision !== meeting.revision && item.reviewedRevision !== meeting.revision;
    if (stale) summary.stale++;
    if (item.review === "accepted") summary.accepted++;
    if (item.review === "rejected") summary.rejected++;
    if (item.review === "edited") summary.edited++;
    if ((item.review === "accepted" || item.review === "rejected") && !stale) summary.reviewed++;
    else summary.pending++;
    const reasons: PriorityReason[] = [];
    if (["decision", "action", "question", "risk"].includes(item.type)) reasons.push(item.type as PriorityReason);
    if (stale) reasons.push("source_changed");
    if (item.review === "edited") reasons.push("edited");
    if (item.sources.length > 15) reasons.push("many_sources");
    if (item.type === "action" && !item.ownerId) reasons.push("missing_owner");
    if (item.type === "action" && !item.dueDate) reasons.push("missing_due");
    if (reasons.length) { summary.priorityItemIds.push(item.id); summary.priorityReasons[item.id] = reasons; }
  }
  return summary;
}

function itemState(item: MemoItem): unknown[] {
  return [item.id, item.type, item.text, item.ownerId, item.dueDate, item.dueOriginal, item.sources.map(source => [source.id, source.revision]), item.review, item.reviewedRevision ?? null];
}
async function fingerprint(meeting: Meeting, memo: MemoVersion): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([meeting.revision, memo.id, memo.sourceRevision, memo.items.map(itemState)]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** Records exactly what the person chose to finish; individual review states stay unchanged. */
export async function completeMemoReview(meeting: Meeting, memoId: string, scope: ReviewScope, now = new Date().toISOString()): Promise<Meeting> {
  const memo = memoOrThrow(meeting, memoId);
  if (scope.kind !== "all" && scope.kind !== "priority") throw new Error("Invalid review scope.");
  const summary = summarizeMemoReview(meeting, memoId);
  const expected = scope.kind === "all" ? memo.items.map(item => item.id) : summary.priorityItemIds;
  const ids = new Set(scope.itemIds);
  if (!expected.length || ids.size !== scope.itemIds.length || expected.length !== ids.size || expected.some(value => !ids.has(value))) throw new Error("The review scope changed. Review the current items before finishing.");
  const included = memo.items.filter(item => ids.has(item.id));
  const reviewed = included.filter(item => (item.review === "accepted" || item.review === "rejected") && (memo.sourceRevision === meeting.revision || item.reviewedRevision === meeting.revision)).length;
  const completion = { kind: scope.kind, itemIds: [...scope.itemIds], sourceRevision: meeting.revision, completedAt: now, fingerprint: await fingerprint(meeting, memo), reviewed, pending: included.length - reviewed };
  return ensureRestorableBackup(meeting, { ...meeting, schemaVersion: 2, memos: meeting.memos.map(value => value.id === memoId ? { ...value, reviewCompletion: completion } : value) });
}

export async function getMemoReviewCompletion(meeting: Meeting, memoId: string): Promise<"none" | "current" | "stale"> {
  const memo = memoOrThrow(meeting, memoId);
  if (!memo.reviewCompletion) return "none";
  return memo.reviewCompletion.sourceRevision === meeting.revision && memo.reviewCompletion.fingerprint === await fingerprint(meeting, memo) ? "current" : "stale";
}

export type MemoComparison = { left: MemoVersion; right: MemoVersion; changes: Array<{ id: string; kind: "unchanged" | "changed" | "added" | "removed"; left?: MemoItem; right?: MemoItem }> };
/** ID equality is structural identity, never a claim that different items are semantically equivalent. */
export function compareMemoVersions(meeting: Meeting, leftId: string, rightId: string): MemoComparison {
  const left = memoOrThrow(meeting, leftId), right = memoOrThrow(meeting, rightId);
  const leftById = new Map(left.items.map(item => [item.id, item]));
  const rightById = new Map(right.items.map(item => [item.id, item]));
  const ids = [...left.items.map(item => item.id), ...right.items.filter(item => !leftById.has(item.id)).map(item => item.id)];
  return { left, right, changes: ids.map(itemId => {
    const before = leftById.get(itemId), after = rightById.get(itemId);
    return { id: itemId, kind: !before ? "added" : !after ? "removed" : JSON.stringify(itemState(before)) === JSON.stringify(itemState(after)) ? "unchanged" : "changed", left: before, right: after };
  }) };
}

/** Restoring is additive. Previously accepted items in the copy require fresh review. */
export function restoreMemoVersion(meeting: Meeting, memoId: string, now = new Date().toISOString()): Meeting {
  const memo = memoOrThrow(meeting, memoId);
  if (meeting.memos.length >= 30) throw new Error("Meeting history limit reached. Back up this meeting before restoring another version.");
  const restored: MemoVersion = {
    id: id(), createdAt: now, sourceRevision: memo.sourceRevision, model: memo.model,
    items: memo.items.map(item => ({ ...structuredClone(item), review: "pending", reviewedRevision: null })),
    ...(memo.originalItems ? { originalItems: structuredClone(memo.originalItems) } : {}),
    restoredFrom: memo.id,
  };
  return ensureRestorableBackup(meeting, { ...meeting, schemaVersion: 2, memos: [...meeting.memos, restored] });
}

export type MemoItemEdit = { text?: string; ownerId?: string | null; dueDate?: string | null };
const MAX_UNDO_CHARACTERS = 256_000;
/** Bounded undo history: old entries may be evicted as newer edits exceed the shared budget. */
export function editMemoItem(meeting: Meeting, memoId: string, itemId: string, edit: MemoItemEdit): Meeting {
  const memo = memoOrThrow(meeting, memoId), before = memo.items.find(item => item.id === itemId);
  if (!before) throw new Error("This note is no longer available.");
  const nextText = edit.text === undefined ? before.text : edit.text;
  if (!nextText.trim() || nextText.length > 20_000) throw new Error("Note text must contain 1–20,000 characters.");
  if (edit.ownerId && !meeting.speakers.some(speaker => speaker.id === edit.ownerId)) throw new Error("The selected owner is unavailable.");
  if (edit.dueDate && edit.dueDate.length > 80) throw new Error("The due date is too long.");
  const textChanged = nextText !== before.text, ownerChanged = edit.ownerId !== undefined && edit.ownerId !== before.ownerId, dueChanged = edit.dueDate !== undefined && edit.dueDate !== before.dueDate;
  if (!textChanged && !ownerChanged && !dueChanged) return meeting;
  const after: MemoItem = { ...before, text: nextText, ownerId: edit.ownerId === undefined ? before.ownerId : edit.ownerId, dueDate: edit.dueDate === undefined ? before.dueDate : edit.dueDate, review: "edited", reviewedRevision: null };
  const history = [...(memo.editUndo ?? []), { before: structuredClone(before), after: structuredClone(after) }].slice(-10);
  // Never evict another version's history; retain as much as fits for this version.
  const otherCharacters = meeting.memos.filter(value => value.id !== memoId).reduce((total, value) => total + JSON.stringify(value.editUndo ?? []).length, 0);
  while (history.length > 1 && JSON.stringify(history).length + otherCharacters > MAX_UNDO_CHARACTERS) history.shift();
  if (JSON.stringify(history).length + otherCharacters > MAX_UNDO_CHARACTERS) throw new Error("Undo history is full. Back up this meeting before making more note edits.");
  return ensureRestorableBackup(meeting, { ...meeting, schemaVersion: 2, memos: meeting.memos.map(value => value.id === memoId ? { ...value, items: value.items.map(item => item.id === itemId ? after : item), editUndo: history } : value) });
}

/** Reverts only the newest unmodified local edit; citations never change during undo. */
export function undoMemoEdit(meeting: Meeting, memoId: string): Meeting {
  const memo = memoOrThrow(meeting, memoId), undo = memo.editUndo?.at(-1);
  if (!undo) throw new Error("There is no note edit to undo.");
  const current = memo.items.find(item => item.id === undo.after.id);
  if (!current || JSON.stringify(itemState(current)) !== JSON.stringify(itemState(undo.after))) throw new Error("This note changed after the edit. Reload and review it before undoing.");
  const restored: MemoItem = { ...structuredClone(undo.before), review: "edited", reviewedRevision: null };
  const remaining = structuredClone(memo.editUndo!.slice(0, -1));
  // The previous entry expected the old state before it can be undone. Keep
  // its text/fields but update the expected review flag to reflect invalidation.
  const previous = remaining.at(-1);
  if (previous && previous.after.id === restored.id && JSON.stringify(itemState({ ...previous.after, review: "edited", reviewedRevision: null })) === JSON.stringify(itemState(restored))) previous.after = structuredClone(restored);
  return ensureRestorableBackup(meeting, { ...meeting, schemaVersion: 2, memos: meeting.memos.map(value => value.id === memoId ? { ...value, items: value.items.map(item => item.id === restored.id ? restored : item), editUndo: remaining } : value) });
}
