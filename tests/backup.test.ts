import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { createMeeting } from "../src/domain/model";
import { assertRetainedChunkResults, getChunkedProgress } from "../src/jobs/chunked-runner";
import { backupMeeting, readBackup } from "../src/storage/backup";
import { getChunkSpeech, putChunkSpeech } from "../src/storage/chunk-speech-store";
import { storeLongAudio } from "../src/storage/long-audio-store";
import { getMeeting, saveMeeting } from "../src/storage/repository";
import { writeSettings } from "../src/storage/settings";
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

async function completedChunkFixture() {
  const meeting = createMeeting();
  const recording = {
    format: "mp3" as const,
    mimeType: "audio/mpeg",
    totalSeconds: 20,
    sampleRate: 44100,
    chunks: ["first", "second"].map((data, index) => ({
      meta: { index, ownStartSeconds: index * 10, ownDurationSeconds: 10, leadInSeconds: 0 },
      read: async () => new Blob([data]),
    })),
  };
  const manifest = await storeLongAudio({ ...recording, meetingId: meeting.id });
  const hash = manifest.manifestSha256;
  const requestId = "synthetic-first-request";
  const passage = {
    id: crypto.randomUUID(), revision: 1, start: 0, end: 1, speakerIds: [],
    originalText: "Original first chunk", text: "Original first chunk", reviewed: false, parents: [],
  };
  meeting.audio = {
    name: "long.mp3", type: "audio/mpeg", size: 11, duration: 20, hash, present: true,
    chunked: { format: "mp3", chunkCount: 2, totalSeconds: 20, manifestSha256: hash },
  };
  meeting.jobs = [{
    id: crypto.randomUUID(), stage: "speech", state: "completed", billing: "possibly_charged",
    createdAt: meeting.createdAt, updatedAt: meeting.updatedAt, requestId, message: "Chunk completed and saved.",
    inputRevision: meeting.revision, chunk: { index: 0, total: 2 },
  }];
  meeting.revision = 2;
  meeting.segments = [{ ...passage, revision: 2, text: "Human correction", reviewed: true }];
  meeting.history = [passage];
  const saved = await saveMeeting(meeting);
  const speech = { speakers: [], segments: [passage], duration: 10, requestId };
  await putChunkSpeech(saved.id, 0, speech);
  return { saved, recording, speech };
}

it("restores completed chunk speech under the new meeting ID for verified reattachment", async () => {
  const { saved, recording, speech } = await completedChunkFixture();
  const key = "synthetic-provider-secret";
  await writeSettings({
    version: 1, revision: 0, keys: { openai: key, openrouter: "" }, speechRate: null,
    speech: { provider: "openai", model: "gpt-transcribe" }, memo: { provider: "openai", model: "gpt-6-luna" },
  }, 0);
  const backup = await backupMeeting(saved);
  const files = unzipSync(new Uint8Array(await backup.arrayBuffer()));
  expect(Object.keys(files).sort()).toEqual(["chunk-speech.json", "meeting.json"]);
  expect(Object.values(files).map((data) => strFromU8(data)).join("")).not.toContain(key);
  const restored = await readBackup(new File([backup], "checkpoints.zip"));
  expect(restored.meeting.id).not.toBe(saved.id);
  expect(await getMeeting(restored.meeting.id)).toBeUndefined();
  expect(await getChunkSpeech(restored.meeting.id, 0)).toBeUndefined();
  const copy = await saveMeeting(restored.meeting, restored.audio);
  expect(copy.audio?.present).toBe(false);
  expect(copy.segments).toEqual(saved.segments);
  expect(copy.history).toEqual(saved.history);
  expect(copy.jobs).toEqual(saved.jobs);
  const wrongRecording = { ...recording, chunks: [{ ...recording.chunks[0], read: async () => new Blob(["wrong"]) }, recording.chunks[1]] };
  await expect(storeLongAudio({ ...wrongRecording, meetingId: copy.id, expectedHash: copy.audio!.hash })).rejects.toThrow("Recording identity could not be verified");
  await storeLongAudio({ ...recording, meetingId: copy.id, expectedHash: copy.audio!.hash });

  expect(await getChunkSpeech(copy.id, 0)).toEqual(speech);
  expect(await getChunkSpeech(saved.id, 0)).toEqual(speech);
  await expect(assertRetainedChunkResults(copy)).resolves.toEqual(new Set([0]));
  await expect(getChunkedProgress(copy)).resolves.toEqual({ total: 2, done: 1, nextIndex: 1, blockedIndex: null });
});

it.each(["recording", "owner", "missing job", "duplicate chunk", "provider key"])("rejects checkpoint archives with invalid %s", async (invalid) => {
  const { saved } = await completedChunkFixture();
  const files = unzipSync(new Uint8Array(await (await backupMeeting(saved)).arrayBuffer()));
  const checkpoint = JSON.parse(strFromU8(files["chunk-speech.json"]));
  if (invalid === "recording") checkpoint.recordingHash = "d".repeat(64);
  if (invalid === "owner") checkpoint.meetingId = crypto.randomUUID();
  if (invalid === "missing job") checkpoint.chunks[0].index = 1;
  if (invalid === "duplicate chunk") checkpoint.chunks.push(checkpoint.chunks[0]);
  if (invalid === "provider key") checkpoint.chunks[0].speech.apiKey = "synthetic-unexpected-field";
  files["chunk-speech.json"] = strToU8(JSON.stringify(checkpoint));
  await expect(readBackup(new File([new Uint8Array(zipSync(files))], "invalid.zip"))).rejects.toThrow(/Backup chunk speech/);
});

it("keeps completed-result refusal for older ZIPs without chunk speech", async () => {
  const { saved } = await completedChunkFixture();
  const files = unzipSync(new Uint8Array(await (await backupMeeting(saved)).arrayBuffer()));
  delete files["chunk-speech.json"];
  const restored = await readBackup(new File([new Uint8Array(zipSync(files))], "older.zip"));
  const copy = await saveMeeting(restored.meeting, restored.audio);
  expect(copy.jobs).toEqual(saved.jobs);
  await expect(assertRetainedChunkResults(copy)).rejects.toThrow("Completed transcription results are missing");
});

it("backs up a restored copy again before reattaching its recording", async () => {
  const { saved, speech } = await completedChunkFixture();
  const restored = await readBackup(new File([await backupMeeting(saved)], "first.zip"));
  const copy = await saveMeeting(restored.meeting, restored.audio);
  const restoredAgain = await readBackup(new File([await backupMeeting(copy)], "second.zip"));
  const secondCopy = await saveMeeting(restoredAgain.meeting, restoredAgain.audio);
  expect(secondCopy.audio?.present).toBe(false);
  expect(await getChunkSpeech(secondCopy.id, 0)).toEqual(speech);
});

it("rolls back restored rows when the meeting write fails and allows a local retry", async () => {
  const { saved, speech } = await completedChunkFixture();
  const restored = await readBackup(new File([await backupMeeting(saved)], "checkpoints.zip"));
  const originalPut = IDBObjectStore.prototype.put;
  const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "meetings") throw new DOMException("quota", "QuotaExceededError");
    return originalPut.apply(this, args);
  });
  try {
    await expect(saveMeeting(restored.meeting, restored.audio)).rejects.toHaveProperty("name", "QuotaExceededError");
    expect(await getMeeting(restored.meeting.id)).toBeUndefined();
    expect(await getChunkSpeech(restored.meeting.id, 0)).toBeUndefined();
  } finally {
    put.mockRestore();
  }
  const copy = await saveMeeting(restored.meeting, restored.audio);
  expect(await getChunkSpeech(copy.id, 0)).toEqual(speech);
});
