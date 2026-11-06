import { test, expect } from "vitest";
import { readBackup } from "../src/storage/backup";
// @ts-expect-error The standalone fixture generator is JavaScript.
import { acceptanceFixture } from "../scripts/create-acceptance-fixture.mjs";

test("owner playback fixture restores with verified audio, source references and no jobs",async()=>{
  const result=await readBackup(new File([acceptanceFixture()],"synthetic-playback.zip"));
  expect(result.meeting.synthetic).toBe(true);
  expect(result.meeting.segments).toHaveLength(4);
  expect(result.meeting.segments[2].speakerIds).toHaveLength(2);
  expect(result.meeting.segments[3].start).toBeNull();
  expect(result.meeting.jobs).toEqual([]);
  expect(result.meeting.memos[0].originalItems).toEqual(result.meeting.memos[0].items);
  expect(result.audio?.size).toBe(result.meeting.audio?.size);
  expect(result.meeting.audio?.duration).toBe(8);
});
