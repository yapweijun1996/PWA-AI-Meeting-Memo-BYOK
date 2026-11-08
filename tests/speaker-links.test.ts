import { describe, expect, it } from "vitest";
import { createMeeting, MeetingSchema, segment } from "../src/domain/model";
import { mergeSpeakerGroups, mergeSpeakers, replaceTranscript, undoEdit } from "../src/domain/operations";

const ids = ["part-0:s1", "part-1:s2", "part-2:s3"];
const links = [
  { fromSpeakerId: ids[0]!, toSpeakerId: ids[1]!, sharedWords: 8, share: 1 },
  { fromSpeakerId: ids[1]!, toSpeakerId: ids[2]!, sharedWords: 9, share: 0.9 },
];

function meetingWithLinks() {
  const base = createMeeting();
  return {
    ...base,
    speakers: ids.map((id, index) => ({ id, name: `Speaker ${index + 1} (part ${index + 1})`, confirmed: true, sourceLabels: [`label-${index}`] })),
    segments: ids.map((speakerId, index) => segment(`word ${index}`, [speakerId], index, index + 0.5)),
    speakerLinks: links,
  };
}

describe("speaker links and grouped merging", () => {
  it("accepts old meetings and strictly validates optional speaker links", () => {
    const oldMeeting = createMeeting();
    expect(MeetingSchema.safeParse(oldMeeting).success).toBe(true);
    expect(MeetingSchema.safeParse({ ...oldMeeting, speakerLinks: links }).success).toBe(true);
    expect(MeetingSchema.safeParse({ ...oldMeeting, speakerLinks: [{ ...links[0], share: 1.1 }] }).success).toBe(false);
    expect(MeetingSchema.safeParse({ ...oldMeeting, speakerLinks: [{ ...links[0], extra: true }] }).success).toBe(false);
  });

  it("merges groups in one undoable edit and restores links, labels, and original speakers", () => {
    const original = meetingWithLinks();
    const merged = mergeSpeakerGroups(original, [ids]);
    expect(merged.undo).toHaveLength(original.undo.length + 1);
    expect(merged.speakers).toEqual([{ ...original.speakers[0]!, sourceLabels: ["label-0", "label-1", "label-2"], confirmed: false }]);
    expect(merged.segments.map((item) => item.speakerIds)).toEqual([[ids[0]], [ids[0]], [ids[0]]]);
    expect(merged.speakerLinks).toEqual([]);
    const undone = undoEdit(merged);
    expect(undone.speakers).toEqual(original.speakers);
    expect(undone.speakerLinks).toEqual(links);
  });

  it("rejects duplicate or unknown ids and keeps the single-speaker merge contract", () => {
    const meeting = meetingWithLinks();
    expect(() => mergeSpeakerGroups(meeting, [[ids[0]!, ids[1]!], [ids[1]!, ids[2]!]])).toThrow();
    expect(() => mergeSpeakerGroups(meeting, [[ids[0]!, "missing"]])).toThrow();
    const merged = mergeSpeakers(meeting, ids[1]!, ids[0]!);
    expect(merged.speakers.map((speaker) => speaker.id)).toEqual([ids[0], ids[2]]);
    expect(merged.speakers[0]!.confirmed).toBe(false);
  });

  it("drops old links when a new transcript replaces the speaker set", () => {
    const original = meetingWithLinks();
    const next = replaceTranscript(original, [], [segment("new source")], "openai", "model");
    expect(next.speakerLinks).toBeUndefined();
  });
});
