import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { createMeeting } from "../src/domain/model";
import { backupMeeting, readBackup } from "../src/storage/backup";
import { saveMeeting } from "../src/storage/repository";
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
it("exports and restores chunked metadata without audio bytes", async () => {
  const meeting = createMeeting();
  const hash = "a".repeat(64);
  meeting.audio = {
    name: "long.mp3",
    type: "audio/mpeg",
    size: 24_000_001,
    duration: 1200,
    hash,
    present: true,
    chunked: { format: "mp3", chunkCount: 2, totalSeconds: 1200, manifestSha256: hash },
  };
  await saveMeeting(meeting);
  const archive = unzipSync(new Uint8Array(await (await backupMeeting(meeting)).arrayBuffer()));
  expect(archive["recording.bin"]).toBeUndefined();
  const document = JSON.parse(strFromU8(archive["meeting.json"]!));
  expect(document.audio.present).toBe(false);
  expect(document.audio.chunked.manifestSha256).toBe(hash);
  const restored = await readBackup(new File([new Uint8Array(zipSync({ "meeting.json": strToU8(JSON.stringify(document)) }))], "meeting.zip"));
  expect(restored.meeting.audio?.present).toBe(false);
  expect(restored.meeting.audio?.chunked?.manifestSha256).toBe(hash);
});
