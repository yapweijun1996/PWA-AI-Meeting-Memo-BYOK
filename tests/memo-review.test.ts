import { describe, expect, it } from "vitest";
import { createMeeting, segment, validateMeeting, type Meeting, type MemoItem } from "../src/domain/model";
import { completeMemoReview, compareMemoVersions, editMemoItem, ensureRestorableBackup, getMemoReviewCompletion, MAX_RESTORABLE_JSON_BYTES, restoreMemoVersion, summarizeMemoReview, undoMemoEdit } from "../src/domain/memo-review";

function fixture(): Meeting {
  const meeting = createMeeting();
  const speakerId = crypto.randomUUID();
  meeting.speakers = [{ id: speakerId, name: "Speaker", confirmed: false, sourceLabels: [] }];
  const source = segment("original evidence", [speakerId], 1, 2);
  meeting.segments = [source];
  const item: MemoItem = { id: crypto.randomUUID(), type: "action", text: "Original action", ownerId: null, dueDate: null, dueOriginal: null, sources: [{ id: source.id, revision: source.revision }], review: "pending" };
  meeting.memos = [{ id: crypto.randomUUID(), createdAt: "2026-11-11T00:00:00.000Z", sourceRevision: meeting.revision, model: "test", items: [item], originalItems: [structuredClone(item)] }];
  return validateMeeting(meeting);
}

describe("memo review", () => {
  it("explicitly records scope without accepting pending notes, survives validation, and becomes stale after edits", async () => {
    const m = fixture(), memo = m.memos[0], original = structuredClone(m);
    const summary = summarizeMemoReview(m, memo.id);
    expect(summary).toMatchObject({ total: 1, pending: 1, reviewed: 0, priorityItemIds: [memo.items[0].id] });
    expect(summary.priorityReasons[memo.items[0].id]).toEqual(["action", "missing_owner", "missing_due"]);
    await expect(completeMemoReview(m, memo.id, { kind: "all", itemIds: [] })).rejects.toThrow("scope changed");
    const completed = await completeMemoReview(m, memo.id, { kind: "all", itemIds: [memo.items[0].id] }, "2026-11-11T00:00:00.000Z");
    expect(m).toEqual(original);
    expect(completed.schemaVersion).toBe(2);
    expect(completed.memos[0].items).toEqual(memo.items);
    expect(completed.memos[0].reviewCompletion).toMatchObject({ kind: "all", reviewed: 0, pending: 1 });
    expect(await getMemoReviewCompletion(validateMeeting(completed), memo.id)).toBe("current");
    const changed = editMemoItem(completed, memo.id, memo.items[0].id, { text: "Edited action" });
    expect(await getMemoReviewCompletion(changed, memo.id)).toBe("stale");
    expect(await getMemoReviewCompletion({ ...completed, revision: completed.revision + 1 }, memo.id)).toBe("stale");
    expect(await getMemoReviewCompletion(m, memo.id)).toBe("none");
  });

  it("tracks stale accepted/rejected notes without presenting them as reviewed", () => {
    const m = fixture();
    m.memos[0].items[0].review = "accepted";
    m.revision++;
    expect(summarizeMemoReview(m, m.memos[0].id)).toMatchObject({ accepted: 1, reviewed: 0, pending: 1, stale: 1 });
    m.memos[0].items[0].reviewedRevision = m.revision;
    expect(summarizeMemoReview(m, m.memos[0].id)).toMatchObject({ accepted: 1, reviewed: 1, pending: 0, stale: 0 });
  });

  it("edits and undoes without changing original citations, source evidence or other versions", () => {
    const m = fixture(), memo = m.memos[0], item = memo.items[0], original = structuredClone(m);
    const same = editMemoItem(m, memo.id, item.id, { text: item.text });
    expect(same).toBe(m);
    const first = editMemoItem(m, memo.id, item.id, { text: "First human edit" });
    const second = editMemoItem(first, memo.id, item.id, { text: "Second human edit" });
    expect(second.memos[0].items[0]).toMatchObject({ text: "Second human edit", review: "edited", reviewedRevision: null, sources: item.sources });
    expect(second.memos[0].originalItems).toEqual(memo.originalItems);
    expect(second.segments).toEqual(m.segments);
    const afterOneUndo = undoMemoEdit(second, memo.id);
    expect(afterOneUndo.memos[0].items[0]).toMatchObject({ text: "First human edit", review: "edited", reviewedRevision: null, sources: item.sources });
    expect(second.memos[0].editUndo).toHaveLength(2);
    const afterTwoUndo = undoMemoEdit(afterOneUndo, memo.id);
    expect(afterTwoUndo.memos[0].items[0]).toMatchObject({ text: "Original action", review: "edited", reviewedRevision: null, sources: item.sources });
    expect(validateMeeting(afterTwoUndo)).toBeDefined();
    expect(m).toEqual(original);
  });

  it("refuses to undo across later edits and keeps undo bounded", () => {
    const m = fixture(), memoId = m.memos[0].id, itemId = m.memos[0].items[0].id;
    let current = m;
    for (let i = 0; i < 15; i++) current = editMemoItem(current, memoId, itemId, { text: `Edit ${i}` });
    expect(current.memos[0].editUndo).toHaveLength(10);
    const conflicted = structuredClone(current);
    conflicted.memos[0].items[0].text = "Another change";
    expect(() => undoMemoEdit(conflicted, memoId)).toThrow("changed after the edit");
    expect(conflicted.memos[0].items[0].text).toBe("Another change");
  });

  it("compares exact ids and restores a new pending version without overwriting any saved version", () => {
    const m = fixture(), memo = m.memos[0], item = memo.items[0];
    memo.items[0].review = "accepted";
    memo.items[0].reviewedRevision = m.revision;
    const original = structuredClone(m);
    const restored = restoreMemoVersion(m, memo.id, "2026-11-11T01:00:00.000Z");
    expect(m).toEqual(original);
    expect(restored.memos[0]).toEqual(memo);
    expect(restored.memos[1].restoredFrom).toBe(memo.id);
    expect(restored.memos[1].items[0]).toMatchObject({ text: item.text, sources: item.sources, review: "pending", reviewedRevision: null });
    expect(restored.memos[1].originalItems).toEqual(memo.originalItems);
    expect(compareMemoVersions(restored, memo.id, restored.memos[1].id).changes).toMatchObject([{ id: item.id, kind: "changed" }]);
    expect(validateMeeting(restored)).toBeDefined();
  });

  it("retains contextual jobs and rejects selections that differ from their source text", () => {
    const m = fixture(), memo = m.memos[0], item = memo.items[0];
    m.schemaVersion = 2;
    m.jobs = [{ id: crypto.randomUUID(), stage: "memo", state: "outcome_unknown", billing: "possibly_charged", createdAt: "2026-11-11", updatedAt: "2026-11-11", requestId: null, message: "Review before retry", inputRevision: m.revision, contextual: { action: "simplify", memoId: memo.id, itemId: item.id, start: 0, end: 8, originalText: item.text, selectedText: "Original", sourceRevision: m.revision, sources: item.sources, suggestion: null } }];
    expect(validateMeeting(m).jobs[0].contextual?.selectedText).toBe("Original");
    const corrupted = structuredClone(m);
    corrupted.jobs[0].contextual!.selectedText = "Different";
    expect(() => validateMeeting(corrupted)).toThrow();
    const obsolete = { ...m, schemaVersion: 1 };
    expect(() => validateMeeting(obsolete)).toThrow("schema version 2");
  });

  it("prevents new writes from growing an oversized backup and permits reducing legacy data", async () => {
    const m = fixture(), memoId = m.memos[0].id, itemId = m.memos[0].items[0].id;
    const edited = editMemoItem(m, memoId, itemId, { text: "New human edit" });
    // Valid 20,000-character source revisions, rather than an invalid oversized field.
    const largeHistory = Array.from({ length: 315 }, () => segment("x".repeat(20_000)));
    const legacy = { ...edited, history: largeHistory };
    expect(new TextEncoder().encode(JSON.stringify(legacy, null, 2)).byteLength).toBeGreaterThan(MAX_RESTORABLE_JSON_BYTES);
    expect(() => editMemoItem(legacy, memoId, itemId, { text: "Another edit" })).toThrow("backup limit");
    expect(() => restoreMemoVersion(legacy, memoId)).toThrow("backup limit");
    await expect(completeMemoReview(legacy, memoId, { kind: "all", itemIds: [itemId] })).rejects.toThrow("backup limit");
    const undone = undoMemoEdit(legacy, memoId);
    expect(undone.memos[0].items[0].text).toBe("Original action");
    expect(undone.memos[0].items[0].sources).toEqual(m.memos[0].items[0].sources);
    expect(undone.history).toHaveLength(legacy.history.length);
    const smaller = { ...legacy, history: legacy.history.slice(1) };
    expect(ensureRestorableBackup(legacy, smaller)).toBe(smaller);
    expect(() => ensureRestorableBackup(smaller, legacy)).toThrow("backup limit");
    expect(legacy.memos[0].items[0].text).toBe("New human edit");
  });
});
