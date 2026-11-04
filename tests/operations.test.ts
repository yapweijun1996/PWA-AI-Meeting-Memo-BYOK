import { describe, it, expect } from "vitest";
import { createMeeting, importTranscript, id, ref } from "../src/domain/model";
import {
  editSegment,
  splitSegment,
  undoEdit,
  mergeSpeakers,
  resolveSource,
  markdown,
} from "../src/domain/operations";
const meeting = () => ({
  ...createMeeting(),
  ...importTranscript("Jamie: Check the order.\nAlex: Finance must confirm."),
});
describe("human revisions and provenance", () => {
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
