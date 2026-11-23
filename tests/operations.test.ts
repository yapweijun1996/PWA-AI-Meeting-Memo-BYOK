import { describe, it, expect } from "vitest";
import { createMeeting, importTranscript, id, ref, segment, validateMeeting } from "../src/domain/model";
import { summarizeMemoReview } from "../src/domain/memo-review";
import {
  assignSegments,
  editMeeting,
  editSegment,
  replaceTranscript,
  splitSegment,
  undoEdit,
  mergeSpeakers,
  resolveSource,
  reviewSegments,
  markdown,
} from "../src/domain/operations";
import { isMeetingCompleted } from "../src/domain/workflow";
const meeting = () => ({
  ...createMeeting(),
  ...importTranscript("Jamie: Check the order.\nAlex: Finance must confirm."),
});

function acceptedMeeting() {
  const m = meeting();
  m.segments[0] = { ...m.segments[0], start: 0, end: 4 };
  m.memos = [{
    id: id(), createdAt: m.createdAt, model: "fixture", sourceRevision: m.revision,
    items: [{
      id: id(), type: "summary", text: "Check the order and confirm with Finance.",
      ownerId: null, dueDate: null, dueOriginal: null,
      sources: m.segments.map(({ id, revision }) => ({ id, revision })),
      review: "accepted", reviewedRevision: m.revision,
    }],
  }];
  return validateMeeting(m);
}

describe("accepted memo review and transcript revisions", () => {
  it("keeps accepted notes current when marking one fragment reviewed", () => {
    const m = acceptedMeeting();
    const reviewed = reviewSegments(m, [m.segments[0].id], true);
    expect(summarizeMemoReview(reviewed, m.memos[0].id)).toMatchObject({ reviewed: 1, stale: 0 });
    expect(reviewed.revision).toBe(m.revision);
    expect(reviewed.segments).toEqual([{ ...m.segments[0], reviewed: true }, m.segments[1]]);
    expect(reviewed.undo).toHaveLength(1);
    expect(validateMeeting(reviewed)).toEqual(reviewed);
  });

  it("keeps accepted notes current when marking a group reviewed", () => {
    const m = acceptedMeeting();
    const ids = m.segments.map((source) => source.id);
    const reviewed = reviewSegments(m, ids, true);
    expect(summarizeMemoReview(reviewed, m.memos[0].id)).toMatchObject({ reviewed: 1, stale: 0 });
    expect(isMeetingCompleted(reviewed)).toBe(true);
    expect(reviewed.revision).toBe(m.revision);
    expect(reviewed.segments).toEqual(m.segments.map((source) => ({ ...source, reviewed: true })));
    expect(reviewed.undo).toHaveLength(1);
  });

  it("keeps accepted notes current when marking a group unreviewed", () => {
    const m = acceptedMeeting();
    m.segments = m.segments.map((source) => ({ ...source, reviewed: true }));
    expect(isMeetingCompleted(m)).toBe(true);
    const unreviewed = reviewSegments(m, m.segments.map((source) => source.id), false);
    expect(summarizeMemoReview(unreviewed, m.memos[0].id)).toMatchObject({ reviewed: 1, stale: 0 });
    expect(isMeetingCompleted(unreviewed)).toBe(false);
    expect(unreviewed.revision).toBe(m.revision);
    expect(unreviewed.segments).toEqual(m.segments.map((source) => ({ ...source, reviewed: false })));
    expect(unreviewed.undo).toHaveLength(1);
  });

  it("keeps accepted notes current through single-fragment toggles and undo with existing history", () => {
    const original = acceptedMeeting();
    const m = editMeeting(original, (draft) => { draft.title = "Updated title"; });
    m.memos[0].items[0].reviewedRevision = m.revision;
    const source = m.segments[0];
    expect(m.history).toContainEqual(source);

    const reviewed = editSegment(m, source.id, { reviewed: true });
    const unreviewed = editSegment(reviewed, source.id, { reviewed: false });
    const undone = undoEdit(unreviewed);
    for (const [state, flag] of [[reviewed, true], [unreviewed, false], [undone, true]] as const) {
      expect(summarizeMemoReview(state, m.memos[0].id)).toMatchObject({ reviewed: 1, stale: 0 });
      expect(state.revision).toBe(m.revision);
      expect(state.segments[0]).toEqual({ ...source, reviewed: flag });
      expect(resolveSource(state, source)?.text).toBe(source.text);
      expect(validateMeeting(state)).toEqual(state);
    }
    expect(undone.undo).toEqual(reviewed.undo);
  });

  it("treats a passage form with unchanged text and speaker attribution as review only", () => {
    const m = acceptedMeeting();
    const source = m.segments[0];
    const reviewed = editSegment(m, source.id, {
      text: source.text,
      speakerIds: [...source.speakerIds],
      reviewed: true,
    });
    expect(reviewed.revision).toBe(m.revision);
    expect(reviewed.segments[0]).toEqual({ ...source, reviewed: true });
    expect(reviewed.undo).toHaveLength(1);
  });

  it("preserves source revisions through a review, content edit, two undos and a reapplied review", () => {
    const m = acceptedMeeting();
    const source = m.segments[0];
    const reviewed = reviewSegments(m, [source.id], true);
    const edited = editSegment(reviewed, source.id, { text: "Corrected order" });
    const restored = undoEdit(edited);
    const unreviewed = undoEdit(restored);
    const reapplied = reviewSegments(unreviewed, [source.id], true);

    expect(restored.revision).toBe(edited.revision + 1);
    expect(restored.segments[0]).toEqual({ ...source, reviewed: true });
    expect(unreviewed.revision).toBe(restored.revision);
    expect(unreviewed.segments[0]).toEqual(source);
    expect(unreviewed.undo).toEqual(m.undo);
    expect(reapplied.revision).toBe(restored.revision);
    expect(reapplied.segments[0]).toEqual(restored.segments[0]);
    expect(reapplied.history).toEqual(restored.history);
    expect(resolveSource(reapplied, edited.segments[0])).toEqual(edited.segments[0]);
    expect(summarizeMemoReview(reapplied, m.memos[0].id)).toMatchObject({ reviewed: 0, stale: 1 });
  });

  it.each([
    ["text edit", (m: ReturnType<typeof acceptedMeeting>) =>
      editSegment(m, m.segments[0].id, { text: "Corrected order", reviewed: true })],
    ["speaker reassignment", (m: ReturnType<typeof acceptedMeeting>) =>
      assignSegments(m, [m.segments[0].id], [m.speakers[1].id])],
    ["speaker merge", (m: ReturnType<typeof acceptedMeeting>) =>
      mergeSpeakers(m, m.speakers[0].id, m.speakers[1].id)],
  ] as const)("invalidates accepted notes after a %s", (name, change) => {
    const m = acceptedMeeting();
    const source = m.segments[0];
    source.reviewed = true;
    const changed = change(m);
    expect(changed.revision).toBe(m.revision + 1);
    expect(changed.segments[0].revision).toBe(source.revision + 1);
    expect(changed.segments[0].parents).toEqual([ref(source)]);
    if (name === "speaker reassignment") expect(changed.segments[0].reviewed).toBe(false);
    expect(resolveSource(changed, source)).toEqual(source);
    expect(summarizeMemoReview(changed, m.memos[0].id)).toMatchObject({ reviewed: 0, stale: 1 });
  });

  it("invalidates accepted notes after a timed split and retains the original range", () => {
    const m = acceptedMeeting();
    const source = m.segments[0];
    const split = splitSegment(m, source.id, 6, 2);
    expect(split.revision).toBe(m.revision + 1);
    expect(split.segments.slice(0, 2)).toMatchObject([
      { start: 0, end: 2, parents: [ref(source)] },
      { start: 2, end: 4, parents: [ref(source)] },
    ]);
    expect(split.segments.slice(0, 2).every((child) => ref(child) !== ref(source))).toBe(true);
    expect(resolveSource(split, source)).toEqual(source);
    expect(summarizeMemoReview(split, m.memos[0].id)).toMatchObject({ reviewed: 0, stale: 1 });
  });

  it("invalidates accepted notes when a replacement transcript changes only timing", () => {
    const m = acceptedMeeting();
    const source = m.segments[0];
    const retimed = segment(source.text, source.speakerIds, 1, 5);
    const changed = replaceTranscript(m, m.speakers, [retimed, m.segments[1]], "fixture", "fixture");
    expect(changed.revision).toBe(m.revision + 1);
    expect(changed.segments[0]).toEqual(retimed);
    expect(ref(retimed)).not.toBe(ref(source));
    expect(resolveSource(changed, source)).toEqual(source);
    expect(summarizeMemoReview(changed, m.memos[0].id)).toMatchObject({ reviewed: 0, stale: 1 });
  });
});

describe("human revisions and provenance", () => {
  it("reviews multiple fragments in one undoable edit", () => {
    const original = meeting();
    const reviewed = reviewSegments(original, original.segments.map((segment) => segment.id), true);
    expect(reviewed.segments).toEqual(original.segments.map((segment) => ({ ...segment, reviewed: true })));
    expect(reviewed.undo).toHaveLength(1);
    expect(resolveSource(reviewed, original.segments[0])?.text).toBe(original.segments[0].text);
    expect(undoEdit(reviewed).segments.every((segment) => !segment.reviewed)).toBe(true);
  });
  it("retains cited evidence across edits and undo, leaving memo stale", () => {
    const m = meeting(),
      s = m.segments[0];
    m.memos = [
      {
        id: id(),
        createdAt: new Date().toISOString(),
        model: "fixture",
        sourceRevision: m.revision,
        items: [
          {
            id: id(),
            type: "action",
            text: "Check order",
            ownerId: null,
            dueDate: null,
            dueOriginal: null,
            sources: [{ id: s.id, revision: s.revision }],
            review: "accepted",
          },
        ],
      },
    ];
    const changed = editSegment(m, s.id, { text: "Corrected text" });
    expect(resolveSource(changed, s)?.text).toBe("Check the order.");
    expect(changed.memos[0].sourceRevision).not.toBe(changed.revision);
    const restored = undoEdit(changed);
    expect(restored.segments[0].text).toBe(s.text);
    expect(restored.revision).toBeGreaterThan(changed.revision);
  });
  it("splits text without inventing timing and keeps its parent source", () => {
    const m = meeting(),
      s = m.segments[0],
      split = splitSegment(m, s.id, 6, null);
    expect(split.segments).toHaveLength(3);
    expect(split.segments[0].start).toBeNull();
    expect(split.segments[0].parents).toEqual([ref(s)]);
    expect(resolveSource(split, s)).toBeDefined();
  });
  it("merges identities without automatically confirming them", () => {
    const m = meeting(),
      merged = mergeSpeakers(m, m.speakers[1].id, m.speakers[0].id);
    expect(merged.speakers).toHaveLength(1);
    expect(merged.speakers[0].confirmed).toBe(false);
    expect(merged.segments[1].speakerIds).toEqual([merged.speakers[0].id]);
  });
});
it("accepts UUIDs and bounded chunk passage IDs while rejecting malformed lookalikes", () => {
  const m = createMeeting();
  const passage = segment("Evidence");
  const maxChunkId = `part-0:${"x".repeat(93)}`;
  const valid = [passage.id, "00000000-0000-0000-0000-000000000000", "part-2:abc_123-x:9", maxChunkId];
  for (const id of valid)
    expect(validateMeeting({ ...m, segments: [{ ...passage, id }] }).segments[0].id).toBe(id);
  for (const id of [`${maxChunkId}x`, "part-2:", "part-2:name:x", "not-a-uuid"])
    expect(() => validateMeeting({ ...m, segments: [{ ...passage, id }] })).toThrow("Meeting data is invalid");
});

it("permits a different review flag in history but rejects changed text at the same revision", () => {
  const m = acceptedMeeting();
  const source = m.segments[0];
  m.history = [{ ...source, reviewed: !source.reviewed }];
  expect(validateMeeting(m)).toEqual(m);

  m.history[0].text = "Conflicting evidence";
  expect(() => validateMeeting(m)).toThrow("Conflicting evidence revisions");
});

it("never reuses a historical revision after an undo then a different edit", () => {
  const m = meeting(),
    s = m.segments[0];
  const first = editSegment(m, s.id, { text: "First correction" });
  const oldRef = { id: s.id, revision: first.segments[0].revision };
  const second = editSegment(undoEdit(first), s.id, {
    text: "Second correction",
  });
  expect(second.segments[0].revision).toBeGreaterThan(oldRef.revision);
  expect(resolveSource(second, oldRef)?.text).toBe("First correction");
});

it("exports the selected human memo version rather than silently selecting the newest", () => {
  const m = meeting(),
    source = { id: m.segments[0].id, revision: m.segments[0].revision };
  const item = {
    id: id(),
    type: "summary" as const,
    text: "Human original",
    ownerId: null,
    dueDate: null,
    dueOriginal: null,
    sources: [source],
    review: "accepted" as const,
  };
  const first = {
    id: id(),
    createdAt: "now",
    model: "fixture",
    sourceRevision: m.revision,
    items: [item],
  };
  m.memos = [
    first,
    {
      ...first,
      id: id(),
      items: [{ ...item, id: id(), text: "New machine version" }],
    },
  ];
  expect(markdown(m, first.id)).toContain("Human original");
  expect(markdown(m, first.id)).not.toContain("New machine version");
});
