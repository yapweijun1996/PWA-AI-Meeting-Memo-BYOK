import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { createMeeting, MeetingSchema } from "../src/domain/model";
import { deleteChunkSpeech, getChunkSpeech, listChunkSpeechIndexes, putChunkSpeech } from "../src/storage/chunk-speech-store";
import { db, deleteMeeting, saveMeeting } from "../src/storage/repository";

vi.stubGlobal("window", new EventTarget());
const speech = { speakers: [], segments: [], duration: 1, requestId: null };

describe("chunk speech IndexedDB store", () => {
  it("upgrades v2 to v3 without losing meeting data and accepts legacy schema", async () => {
    const meeting = createMeeting();
    const legacy = openDB("meeting-memo-byok-v1", 2, {
      upgrade(database) {
        database.createObjectStore("meetings", { keyPath: "id" });
        database.createObjectStore("audio");
        database.createObjectStore("audioChunks");
        database.createObjectStore("audioManifests");
      },
    });
    const v2 = await legacy;
    await v2.put("meetings", meeting);
    v2.close();
    const upgraded = await db();
    expect(upgraded.version).toBe(3);
    expect((await upgraded.get("meetings", meeting.id))?.title).toBe(meeting.title);
    expect(upgraded.objectStoreNames.contains("chunkSpeech")).toBe(true);
    expect(MeetingSchema.safeParse(meeting).success).toBe(true);
    const invalid = { ...meeting, audio: { name: "x", type: "audio/mpeg", size: 1, duration: 1, hash: "a".repeat(64), present: true,
      chunked: { format: "wav", chunkCount: 1, totalSeconds: 1, manifestSha256: "a".repeat(64) } } };
    expect(MeetingSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates stored speech and deletes only the selected meeting rows", async () => {
    await putChunkSpeech("meeting-a", 2, speech);
    await putChunkSpeech("meeting-a", 0, speech);
    await putChunkSpeech("meeting-b", 1, speech);
    expect(await listChunkSpeechIndexes("meeting-a")).toEqual([0, 2]);
    expect(await getChunkSpeech("meeting-a", 2)).toEqual(speech);
    await deleteChunkSpeech("meeting-a");
    expect(await listChunkSpeechIndexes("meeting-a")).toEqual([]);
    expect(await getChunkSpeech("meeting-b", 1)).toEqual(speech);
    const meeting = await saveMeeting(createMeeting());
    await putChunkSpeech(meeting.id, 0, speech);
    await deleteMeeting(meeting.id);
    expect(await listChunkSpeechIndexes(meeting.id)).toEqual([]);
    await (await db()).put("chunkSpeech", { ...speech, unexpected: true }, ["bad", 0]);
    await expect(getChunkSpeech("bad", 0)).rejects.toThrow();
  });
});
