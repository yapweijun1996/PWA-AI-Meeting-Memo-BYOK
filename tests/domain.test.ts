import { describe, it, expect } from "vitest";
import {
  createMeeting,
  importTranscript,
  validateMeeting,
} from "../src/domain/model";
describe("meeting boundaries", () => {
  it("keeps plain text untimed and anonymous until evidence is supplied", () => {
    const data = importTranscript("One line\nJamie: A named line");
    expect(data.segments[0].speakerIds).toEqual([]);
    expect(data.segments.every((s) => s.start === null && s.end === null)).toBe(
      true,
    );
    expect(data.speakers[0].confirmed).toBe(false);
  });
  it("rejects credentials and unexpected persisted fields", () => {
    expect(() =>
      validateMeeting({ ...createMeeting(), apiKey: "should-never-persist" }),
    ).toThrow();
  });
  it("rejects dangling speaker references and impossible dates", () => {
    const m = { ...createMeeting(), ...importTranscript("Jamie: Hello") };
    m.speakers = [];
    expect(() => validateMeeting(m)).toThrow("Unknown speaker");
    expect(() => createMeeting({ date: "2026-02-30" })).toThrow();
  });
  it("preserves separate generated originals and validates their evidence", () => {
    const m = {
      ...createMeeting(),
      ...importTranscript("Jamie: Confirm the stock."),
    };
    const item = {
      id: crypto.randomUUID(),
      type: "summary" as const,
      text: "Generated original",
      ownerId: null,
      dueDate: null,
      dueOriginal: null,
      sources: [{ id: m.segments[0].id, revision: m.segments[0].revision }],
      review: "pending" as const,
    };
    m.memos = [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        model: "fixture",
        sourceRevision: m.revision,
        items: [item],
        originalItems: [structuredClone(item)],
      },
    ];
    m.memos[0].items[0].text = "Human correction";
    expect(validateMeeting(m).memos[0].originalItems?.[0].text).toBe(
      "Generated original",
    );
    m.memos[0].originalItems![0].sources[0].id = crypto.randomUUID();
    expect(() => validateMeeting(m)).toThrow("Unresolved memo evidence");
  });
});
