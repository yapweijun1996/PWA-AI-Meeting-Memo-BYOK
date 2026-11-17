import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { backupMeeting, readBackup } from "../src/storage/backup";
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
    await new Promise((resolve) => setTimeout(resolve, 5));
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

  it("identifies equal recording content independently of meeting and import time", async () => {
    const first = await storeLongAudio(input(crypto.randomUUID(), ["one", "two"]));
    const second = await storeLongAudio(input(crypto.randomUUID(), ["one", "two"]));
    expect(second.manifestSha256).toBe(first.manifestSha256);
  });

  it("preserves old chunks and acoustic evidence when replacement is cancelled", async () => {
    const meetingId = crypto.randomUUID();
    const first = await storeLongAudio(input(meetingId, ["original", "retained"]));
    const database = await repo.db();
    await database.put("acousticCheckpoints", { sentinel: "retained" }, meetingId);
    const controller = new AbortController();
    await expect(storeLongAudio({ ...input(meetingId, ["new", "data"]), replace: true,
      signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toHaveProperty("name", "AbortError");
    expect(await getLongAudioManifest(meetingId)).toEqual(first);
    expect(await (await getLongAudioChunk(meetingId, 0)).text()).toBe("original");
    expect(await database.get("acousticCheckpoints", meetingId)).toEqual({ sentinel: "retained" });
  });

  it.each(["read", "stage-quota", "commit-quota", "missing-stage", "wrong-identity"])("retains originals after %s failure", async (failure) => {
    const meetingId = crypto.randomUUID();
    const first = await storeLongAudio(input(meetingId, ["original", "retained"]));
    const database = await repo.db();
    await database.put("acousticCheckpoints", { sentinel: "retained" }, meetingId);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      const key = args[1] as [string, number];
      if (this.name === "audioChunks" && ((failure === "stage-quota" && key[0].startsWith("staging:")) || (failure === "commit-quota" && key[0] === meetingId)))
        throw new DOMException("quota", "QuotaExceededError");
      return originalPut.apply(this, args);
    });
    const replacement = input(meetingId, ["new", "data"]);
    if (failure === "read") replacement.chunks[1].read = async () => { throw new Error("Unreadable file"); };
    if (failure === "missing-stage") replacement.chunks[1].read = async () => { await cleanupIncompleteLongAudio(); return new Blob(["data"]); };
    try {
      await expect(storeLongAudio({ ...replacement, replace: true, expectedHash: failure === "wrong-identity" ? first.manifestSha256 : undefined })).rejects.toThrow();
    } finally { vi.restoreAllMocks(); }
    expect(await getLongAudioManifest(meetingId)).toEqual(first);
    expect(await (await getLongAudioChunk(meetingId, 0)).text()).toBe("original");
    expect(await (await getLongAudioChunk(meetingId, 1)).text()).toBe("retained");
    expect(await database.get("acousticCheckpoints", meetingId)).toEqual({ sentinel: "retained" });
  });

  it("rejects a stale import without overwriting the winning recording", async () => {
    const meetingId = crypto.randomUUID();
    await storeLongAudio(input(meetingId, ["original"]));
    const candidate = input(meetingId, ["stale"]);
    candidate.chunks[0].read = async () => {
      await storeLongAudio({ ...input(meetingId, ["winner"]), replace: true });
      return new Blob(["stale"]);
    };
    await expect(storeLongAudio({ ...candidate, replace: true })).rejects.toThrow("Another import");
    expect(await (await getLongAudioChunk(meetingId, 0)).text()).toBe("winner");
  });

  it.each(["edited", "deleted"])("rejects attachment when the meeting was %s during staging", async (change) => {
    const meeting = await repo.saveMeeting(createMeeting());
    const first = await storeLongAudio(input(meeting.id, ["original"]));
    const candidate = input(meeting.id, ["original"]);
    candidate.chunks[0].read = async () => {
      if (change === "deleted") await repo.deleteMeeting(meeting.id);
      else await repo.saveMeeting({ ...meeting, title: "Concurrent edit" });
      return new Blob(["original"]);
    };
    await expect(storeLongAudio({ ...candidate, replace: true, expectedHash: first.manifestSha256, expectedMeetingVersion: meeting.version })).rejects.toThrow(/Another (tab|import)/);
    if (change === "deleted") {
      expect(await repo.getMeeting(meeting.id)).toBeUndefined();
      expect(await getLongAudioManifest(meeting.id)).toBeUndefined();
    } else {
      expect((await repo.getMeeting(meeting.id))?.title).toBe("Concurrent edit");
      expect(await getLongAudioManifest(meeting.id)).toEqual(first);
    }
  });

  it("repairs legacy chunks without changing identity and exports a portable backup", async () => {
    const meeting = createMeeting();
    const first = await storeLongAudio(input(meeting.id, ["original", "retained"]));
    const unsigned = { meetingId: first.meetingId, format: first.format, mimeType: first.mimeType, totalSeconds: first.totalSeconds,
      sampleRate: first.sampleRate, totalBytes: first.totalBytes, createdAt: first.createdAt, chunks: first.chunks.map(c => ({ index: c.index, byteLength: c.byteLength, sha256: c.sha256, ownStartSeconds: c.ownStartSeconds, ownDurationSeconds: c.ownDurationSeconds, leadInSeconds: c.leadInSeconds })) };
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(unsigned))))].map(value => value.toString(16).padStart(2, "0")).join("");
    const legacy = { ...unsigned, manifestSha256: hash };
    const database = await repo.db();
    await database.put("audioManifests", legacy, meeting.id);
    await database.delete("audioChunks", [meeting.id, 1]);
    await database.put("acousticCheckpoints", { sentinel: "retained" }, meeting.id);
    const repaired = await storeLongAudio({ ...input(meeting.id, ["original", "retained"]), replace: true, expectedHash: hash });
    expect(repaired).toEqual(legacy);
    await verifyLongAudio(meeting.id);
    expect(await database.get("acousticCheckpoints", meeting.id)).toEqual({ sentinel: "retained" });
    const saved = await repo.saveMeeting({ ...meeting, audio: { name: "legacy.mp3", type: "audio/mpeg", size: 16, duration: 20, hash, present: true,
      chunked: { format: "mp3", chunkCount: 2, totalSeconds: 20, manifestSha256: hash } } });
    const restored = await readBackup(new File([await backupMeeting(saved)], "legacy.zip"));
    expect(restored.meeting.audio!.hash).toBe(first.manifestSha256);
    expect((await repo.getMeeting(meeting.id))!.audio!.hash).toBe(hash);
    const attached = await storeLongAudio({ ...input(restored.meeting.id, ["original", "retained"]), expectedHash: restored.meeting.audio!.hash });
    expect(attached.manifestSha256).toBe(restored.meeting.audio!.hash);
    await expect(storeLongAudio({ ...input(crypto.randomUUID(), ["original", "retained"]), expectedHash: hash })).rejects.toThrow("older restored backup");
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
