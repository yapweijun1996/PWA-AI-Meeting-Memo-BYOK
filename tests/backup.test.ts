import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { createMeeting } from "../src/domain/model";
import { readBackup } from "../src/storage/backup";
vi.stubGlobal("window", new EventTarget());
it("rejects unexpected archive paths before extracting data", async () => {
  const file = new File(
    [new Uint8Array(zipSync({ "../private": strToU8("no") }))],
    "bad.zip",
  );
  await expect(readBackup(file)).rejects.toThrow("Unexpected backup entry");
});
it("restores JSON under a new meeting identity with missing audio explicit", async () => {
  const m = createMeeting(),
    file = new File([JSON.stringify(m)], "meeting.json");
  const result = await readBackup(file);
  expect(result.meeting.id).not.toBe(m.id);
  expect(result.meeting.version).toBe(0);
});
