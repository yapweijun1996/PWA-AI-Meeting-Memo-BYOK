import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { createMeeting } from "../src/domain/model";
import {
  checkCapacity,
  cleanupIncompleteLongAudio,
  getLongAudioChunk,
  getLongAudioManifest,
  LongAudioIntegrityError,
  LongAudioQuotaError,
  storeLongAudio,
  verifyLongAudio,
} from "../src/storage/long-audio-store";
import * as repo from "../src/storage/repository";

vi.stubGlobal("window", new EventTarget());
const meta = (index: number) => ({ index, ownStartSeconds: index * 10, ownDurationSeconds: 10, leadInSeconds: 0 });
const input = (meetingId: string, bytes: string[]) => ({
  meetingId,
  format: "mp3" as const,
  mimeType: "audio/mpeg",
  totalSeconds: bytes.length * 10,
  sampleRate: 44100,
  chunks: bytes.map((value, index) => ({ meta: meta(index), read: async () => new Blob([value]) })),
});

describe("long audio IndexedDB store", () => {
  it("upgrades v1 data without losing meetings or audio and creates the chunk stores", async () => {
    const oldDb = await openDB("meeting-memo-byok-v1", 1, {
      upgrade(database) {
        database.createObjectStore("meetings", { keyPath: "id" });
        database.createObjectStore("audio");
      },
    });
    const meeting = createMeeting();
    await oldDb.put("meetings", meeting);
    await oldDb.put("audio", { bytes: new TextEncoder().encode("legacy").buffer, type: "audio/mpeg" }, meeting.id);
    oldDb.close();
    expect((await repo.getMeeting(meeting.id))?.id).toBe(meeting.id);
    expect(await (await repo.getAudio(meeting.id))?.text()).toBe("legacy");
    const database = await repo.db();
    expect(database.objectStoreNames.contains("audioChunks")).toBe(true);
    expect(database.objectStoreNames.contains("audioManifests")).toBe(true);
  });

  it("round-trips multiple chunks and verifies chunk and manifest hashes", async () => {
    const meetingId = crypto.randomUUID();
    const manifest = await storeLongAudio(input(meetingId, ["first", "second", "third"]));
    expect(manifest.chunks).toHaveLength(3);
    expect(await (await getLongAudioChunk(meetingId, 1)).text()).toBe("second");
    await expect(verifyLongAudio(meetingId)).resolves.toBeUndefined();
    const database = await repo.db();
    await database.put("audioChunks", new TextEncoder().encode("tampered").buffer, [meetingId, 1]);
    await expect(getLongAudioChunk(meetingId, 1)).rejects.toBeInstanceOf(LongAudioIntegrityError);
    await expect(verifyLongAudio(meetingId)).rejects.toBeInstanceOf(LongAudioIntegrityError);
  });

  it("cleans partial rows on abort and removes only manifest-less chunks", async () => {
    const abortedId = crypto.randomUUID();
    const controller = new AbortController();
    await expect(storeLongAudio({
      ...input(abortedId, ["one", "two"]),
      onProgress(done) { if (done === 1) controller.abort(); },
      signal: controller.signal,
    })).rejects.toHaveProperty("name", "AbortError");
    const database = await repo.db();
    expect(await database.get("audioChunks", [abortedId, 0])).toBeUndefined();

    const retainedId = crypto.randomUUID();
    await storeLongAudio(input(retainedId, ["kept"]));
    const orphanId = crypto.randomUUID();
    await database.put("audioChunks", new ArrayBuffer(2), [orphanId, 0]);
    expect(await cleanupIncompleteLongAudio()).toBe(1);
    expect(await database.get("audioChunks", [retainedId, 0])).toBeDefined();
    expect(await database.get("audioChunks", [orphanId, 0])).toBeUndefined();
  });

  it("requires replace:true and replaces existing chunk data", async () => {
    const meetingId = crypto.randomUUID();
    const first = await storeLongAudio(input(meetingId, ["old"]));
    await expect(storeLongAudio(input(meetingId, ["rejected"]))).rejects.toThrow("already exists");
    const replacement = await storeLongAudio({ ...input(meetingId, ["new", "data"]), replace: true });
    expect(replacement.totalBytes).toBe(7);
    expect(replacement.createdAt).not.toBe(first.createdAt);
    expect((await getLongAudioManifest(meetingId))?.chunks).toHaveLength(2);
  });

  it("deletes chunks and manifest with their meeting only", async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    await storeLongAudio(input(firstId, ["first"]));
    await storeLongAudio(input(secondId, ["second"]));
    await repo.deleteMeeting(firstId);
    const database = await repo.db();
    expect(await database.get("audioChunks", [firstId, 0])).toBeUndefined();
    expect(await getLongAudioManifest(firstId)).toBeUndefined();
    expect(await (await getLongAudioChunk(secondId, 0)).text()).toBe("second");
  });

  it("maps IndexedDB quota failures to LongAudioQuotaError", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "audioChunks") throw new DOMException("quota", "QuotaExceededError");
      return originalPut.apply(this, args);
    });
    try {
      await expect(storeLongAudio(input(crypto.randomUUID(), ["quota"]))).rejects.toBeInstanceOf(LongAudioQuotaError);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("rejects malformed manifests read from IndexedDB", async () => {
    const meetingId = crypto.randomUUID();
    await (await repo.db()).put("audioManifests", { meetingId, format: "invalid" }, meetingId);
    await expect(getLongAudioManifest(meetingId)).rejects.toBeInstanceOf(LongAudioIntegrityError);
  });

  it("reports sufficient, insufficient, and unavailable storage estimates", async () => {
    const enough = await checkCapacity(10, async () => ({ usage: 0, quota: 100 * 1024 * 1024 }));
    const notEnough = await checkCapacity(100 * 1024 * 1024, async () => ({ usage: 0, quota: 100 * 1024 * 1024 }));
    const unknown = await checkCapacity(10, async () => ({}));
    expect(enough.ok).toBe(true);
    expect(notEnough.ok).toBe(false);
    expect(unknown.ok).toBe("unknown");
    expect(unknown.available).toBeNull();
  });
});
