import {expect, test} from "vitest";
import {sampleMeeting, validateMeeting} from "../src/domain/model";
import {previewHistoryCleanup} from "../src/domain/history-cleanup";

function fixture() {
  const m = sampleMeeting();
  const prior = structuredClone(m.segments[0]);
  m.segments[0] = {...prior, revision: prior.revision + 1, text: "Human correction"};
  m.revision++;
  m.history = [prior, structuredClone(m.segments[0]), structuredClone(prior)];
  m.undo = [{title: m.title, date: m.date, timezone: m.timezone, speakers: structuredClone(m.speakers), segments: [prior, ...m.segments.slice(1)]}];
  const item = {id: crypto.randomUUID(), type: "summary" as const, text: "Human reviewed note", ownerId: null, dueDate: null, dueOriginal: null, sources: [{id: prior.id, revision: prior.revision}], review: "accepted" as const};
  m.memos = [{id: crypto.randomUUID(), sourceRevision: m.revision - 1, model: "synthetic", createdAt: new Date().toISOString(), items: [item], originalItems: [{...item, text: "Original generated note"}], editUndo: [{before: {...item}, after: {...item}}]}];
  return validateMeeting(m);
}

test("cleanup preview is pure, retains distinct evidence and removes only redundant history and transcript undo", () => {
  const m = fixture();
  const before = JSON.stringify(m);
  const preview = previewHistoryCleanup(m);
  expect(JSON.stringify(m)).toBe(before);
  expect(preview.undoCount).toBe(1);
  expect(preview.redundantHistoryCount).toBe(2);
  expect(preview.afterBytes).toBeLessThan(preview.beforeBytes);
  expect(preview.result.undo).toEqual([]);
  expect(preview.result.history).toEqual([m.history[0]]);
  expect(preview.result.segments).toEqual(m.segments);
  expect(preview.result.memos).toEqual(m.memos);
  expect(preview.result.runs).toEqual(m.runs);
  expect(preview.result.audio).toEqual(m.audio);
  expect(preview.result.revision).toBe(m.revision);
  expect(validateMeeting(JSON.parse(JSON.stringify(preview.result)))).toEqual(preview.result);
});

test("unique historical revisions and a second cleanup remain stable", () => {
  const first = previewHistoryCleanup(fixture());
  const second = previewHistoryCleanup(first.result);
  expect(second.result).toEqual(first.result);
  expect(second.undoCount).toBe(0);
  expect(second.redundantHistoryCount).toBe(0);
});

test("cleanup refuses an active request and invalid evidence", () => {
  const m = fixture();
  const active = {...m, jobs: [{id: crypto.randomUUID(), stage: "memo" as const, state: "in_flight" as const, billing: "possibly_charged" as const, createdAt: "now", updatedAt: "now", requestId: null, message: "Synthetic attempt", inputRevision: m.revision}]};
  expect(() => previewHistoryCleanup(active)).toThrow("active request");
  // Cleanup must validate the original too: conflicting duplicates are not redundant evidence.
  const bad = structuredClone(m);
  bad.history[1].text = "Conflicting same revision";
  expect(() => previewHistoryCleanup(bad)).toThrow("Conflicting evidence");
});
