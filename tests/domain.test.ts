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
});
