import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { backupMeeting, readBackup } from "../src/storage/backup";
import { createMeeting, segment } from "../src/domain/model";
import { getChunkSpeech, putChunkSpeech } from "../src/storage/chunk-speech-store";
import {
  attachLongAudio,
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
vi.stubGlobal("navigator", {});
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

  it("rolls back a new long recording and its staged parts when the meeting write fails", async () => {
    const meeting = createMeeting();
    const db = await repo.db();
    const beforeChunks = await db.getAllKeys("audioChunks");
    const beforeManifests = await db.getAllKeys("audioManifests");
    const publish = () => attachLongAudio(input(meeting.id, ["first", "second"]), meeting, manifest => ({
      name: "synthetic.mp3", type: "audio/mpeg", size: manifest.totalBytes, duration: manifest.totalSeconds,
      hash: manifest.manifestSha256, present: true,
      chunked: { format: "mp3", chunkCount: manifest.chunks.length,
        totalSeconds: manifest.totalSeconds, manifestSha256: manifest.manifestSha256 },
    }));
    const put = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, key) {
      if (this.name === "meetings" && value.id === meeting.id) throw new DOMException("Synthetic full disk", "QuotaExceededError");
      return put.call(this, value, key);
    });
    try { await expect(publish()).rejects.toThrow(LongAudioQuotaError); }
    finally { fault.mockRestore(); }
    expect(await repo.getMeeting(meeting.id)).toBeUndefined();
    expect(await db.getAllKeys("audioChunks")).toEqual(beforeChunks);
    expect(await db.getAllKeys("audioManifests")).toEqual(beforeManifests);

    const saved = await publish();
    expect(saved.version).toBe(1);
    expect(await repo.getMeeting(meeting.id)).toEqual(saved);
    expect((await getLongAudioManifest(meeting.id))?.manifestSha256).toBe(saved.audio?.hash);
    expect(await db.count("audioChunks", IDBKeyRange.bound([meeting.id, 0], [meeting.id, Infinity]))).toBe(2);
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

  it("publishes a staged import after startup cleanup runs during a paused read", async () => {
    const meetingId = crypto.randomUUID();
    const recording = input(meetingId, ["first", "second"]);
    const database = await repo.db();
    const removed: number[] = [];
    recording.chunks[1].read = async () => {
      const staged = (await database.getAllKeys("audioChunks")).filter(([owner]) => owner.startsWith("staging:"));
      expect(staged).toHaveLength(1);
      expect(await getLongAudioManifest(meetingId)).toBeUndefined();
      removed.push(await cleanupIncompleteLongAudio());
      return new Blob(["second"]);
    };

    await storeLongAudio(recording);

    expect(removed).toEqual([0]);
    expect(await (await getLongAudioChunk(meetingId, 0)).text()).toBe("first");
    expect(await (await getLongAudioChunk(meetingId, 1)).text()).toBe("second");
    expect((await database.getAllKeys("audioManifests")).filter(owner => owner.startsWith("staging:"))).toEqual([]);
  });

  it("preserves a held stage and immediately reclaims an abandoned stage that used a lock", async () => {
    const held = new Set<string>();
    vi.stubGlobal("navigator", { locks: {
      async request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
        if (held.has(name)) {
          expect(options.ifAvailable).toBe(true);
          return callback(null);
        }
        held.add(name);
        try { return await callback({ name, mode: "exclusive" }); }
        finally { held.delete(name); }
      },
    } });
    const database = await repo.db();
    const abandoned = `staging:${crypto.randomUUID()}`;
    const recording = input(crypto.randomUUID(), ["first", "second"]);
    recording.chunks[1].read = async () => {
      const [active] = (await database.getAllKeys("audioManifests"))
        .filter(owner => owner.startsWith("staging:") && owner !== abandoned);
      expect(held).toContain(active.replace("staging:", "meeting-memo:long-audio-stage:"));
      const lease = await database.get("audioManifests", active) as { updatedAt: number; usesWebLock: boolean };
      await database.put("audioManifests", { ...lease, updatedAt: 0 }, active);
      expect(await cleanupIncompleteLongAudio()).toBe(1);
      expect(await database.get("audioChunks", [active, 0])).toBeDefined();
      expect(await database.get("audioChunks", [abandoned, 0])).toBeUndefined();
      expect(await database.get("audioManifests", abandoned)).toBeUndefined();
      return new Blob(["second"]);
    };
    try {
      await database.put("audioChunks", new ArrayBuffer(2), [abandoned, 0]);
      await database.put("audioManifests", { updatedAt: Date.now(), usesWebLock: true }, abandoned);
      await storeLongAudio(recording);
      await verifyLongAudio(recording.meetingId);
      expect(held.size).toBe(0);
    } finally {
      vi.stubGlobal("navigator", {});
    }
  });

  it("reclaims stale unlocked and legacy staging rows after a 24-hour grace period", async () => {
    const database = await repo.db();
    const leased = `staging:${crypto.randomUUID()}`;
    const legacy = `staging:${crypto.randomUUID()}`;
    const now = Date.now();
    const grace = 24 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      await database.put("audioChunks", new ArrayBuffer(2), [leased, 0]);
      await database.put("audioManifests", { updatedAt: now - grace + 1, usesWebLock: false }, leased);
      await database.put("audioChunks", new ArrayBuffer(2), [legacy, 0]);
      expect(await cleanupIncompleteLongAudio()).toBe(0);
      clock.mockReturnValue(now + 1);
      expect(await cleanupIncompleteLongAudio()).toBe(1);
      expect(await database.get("audioChunks", [leased, 0])).toBeUndefined();
      expect(await database.get("audioManifests", leased)).toBeUndefined();
      expect(await database.get("audioChunks", [legacy, 0])).toBeDefined();
      clock.mockReturnValue(now + grace);
      expect(await cleanupIncompleteLongAudio()).toBe(1);
      expect(await database.get("audioChunks", [legacy, 0])).toBeUndefined();
      expect(await database.get("audioManifests", legacy)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it("requires replace:true and repairs only the existing recording", async () => {
    const meetingId = crypto.randomUUID();
    const first = await storeLongAudio(input(meetingId, ["old"]));
    await expect(storeLongAudio(input(meetingId, ["rejected"]))).rejects.toThrow("already exists");
    await expect(storeLongAudio({ ...input(meetingId, ["new", "data"]), replace: true }))
      .rejects.toThrow("Recording identity could not be verified");
    expect(await getLongAudioManifest(meetingId)).toEqual(first);
    expect(await (await getLongAudioChunk(meetingId, 0)).text()).toBe("old");
    await (await repo.db()).delete("audioChunks", [meetingId, 0]);
    expect(await storeLongAudio({ ...input(meetingId, ["old"]), replace: true })).toEqual(first);
    expect(await (await getLongAudioChunk(meetingId, 0)).text()).toBe("old");
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

  it("retains surviving chunks during startup and checks the saved meeting when its manifest is lost", async () => {
    const meeting = createMeeting();
    const first = await storeLongAudio(input(meeting.id, ["surviving", "missing"]));
    const saved = await repo.saveMeeting({ ...meeting, audio: { hash: first.manifestSha256, size: first.totalBytes,
      type: "audio/mpeg", name: "original.mp3", duration: 20, present: true,
      chunked: { format: "mp3", chunkCount: 2, totalSeconds: 20, manifestSha256: first.manifestSha256 } } });
    const database = await repo.db();
    await database.delete("audioManifests", saved.id);
    await database.delete("audioChunks", [saved.id, 1]);
    await database.put("acousticCheckpoints", { kept: true }, saved.id);
    await cleanupIncompleteLongAudio();
    const bytes = await database.get("audioChunks", [saved.id, 0]);
    expect(new TextDecoder().decode(bytes)).toBe("surviving");
    await expect(storeLongAudio({ ...input(saved.id, ["different", "missing"]), replace: true })).rejects.toThrow("Recording identity");
    expect(await database.get("audioChunks", [saved.id, 0])).toEqual(bytes);
    expect(await getLongAudioManifest(saved.id)).toBeUndefined();
    expect(await repo.getMeeting(saved.id)).toEqual(saved);
    await storeLongAudio({ ...input(saved.id, ["surviving", "missing"]), replace: true });
    await verifyLongAudio(saved.id);
    expect(await database.get("acousticCheckpoints", saved.id)).toEqual({ kept: true });
  });

  it("refuses unidentified existing chunks and an unverifiable legacy manifest", async () => {
    const meetingId = crypto.randomUUID();
    const database = await repo.db();
    const bytes = new TextEncoder().encode("original").buffer;
    await database.put("audioChunks", bytes, [meetingId, 0]);
    const candidate = { ...input(meetingId, ["different"]), replace: true };
    await expect(storeLongAudio(candidate)).rejects.toThrow("Recording identity");
    const damaged = { meetingId, chunks: [{ index: 0 }], manifestSha256: "0".repeat(64) };
    await database.put("audioManifests", damaged, meetingId);
    await expect(storeLongAudio(candidate)).rejects.toBeInstanceOf(LongAudioIntegrityError);
    expect(await database.get("audioManifests", meetingId)).toEqual(damaged);
    expect(await database.get("audioChunks", [meetingId, 0])).toEqual(bytes);
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

  it.each(["read", "stage-quota", "commit-quota", "commit-write", "missing-stage", "corrupt-stage", "incomplete", "wrong-identity"])("retains originals after %s failure", async (failure) => {
    const meetingId = crypto.randomUUID();
    const first = await storeLongAudio(input(meetingId, ["original", "retained"]));
    const database = await repo.db();
    await database.put("acousticCheckpoints", { sentinel: "retained" }, meetingId);
    await database.put("acousticEmbeddings", { vector: [1] }, [meetingId, "sample"]);
    await database.put("acousticIdentities", { voice: 1 }, [meetingId, "voice"]);
    await database.put("acousticAssignments", { voice: 1 }, [meetingId, "label"]);
    await database.put("transcriptPages", { original: "source" }, [meetingId, "run", 0]);
    await database.put("chunkSpeech", { original: "speech" }, [meetingId, 0]);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      const key = args[1] as [string, number];
      if (this.name === "audioChunks" && ((failure === "stage-quota" && key[0].startsWith("staging:")) || (failure === "commit-quota" && key[0] === meetingId && key[1] === 1)))
        throw new DOMException("quota", "QuotaExceededError");
      if (failure === "commit-write" && this.name === "audioManifests" && args[1] === meetingId) throw new Error("Manifest write failed");
      if (failure === "corrupt-stage" && this.name === "audioChunks" && key[0].startsWith("staging:") && key[1] === 1)
        args[0] = new ArrayBuffer((args[0] as ArrayBuffer).byteLength);
      return originalPut.apply(this, args);
    });
    const replacement = input(meetingId, failure === "wrong-identity" ? ["original", "modified"]
      : failure === "incomplete" ? ["original"] : ["original", "retained"]);
    if (failure === "read") replacement.chunks[1].read = async () => { throw new Error("Unreadable file"); };
    if (failure === "missing-stage") {
      const originalGet = IDBObjectStore.prototype.get;
      vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
        // Remove the second staged chunk after publication has copied the first.
        if (this.name === "audioChunks" && this.transaction.mode === "readwrite" &&
          Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("staging:") && key[1] === 1) this.delete(key);
        return originalGet.call(this, key);
      });
    }
    const reason = { read: "Unreadable file", "stage-quota": "quota", "commit-quota": "quota",
      "commit-write": "Manifest write failed", "missing-stage": "Staged recording", "corrupt-stage": "Staged recording",
      incomplete: "Recording identity", "wrong-identity": "Recording identity" }[failure]!;
    try {
      await expect(storeLongAudio({ ...replacement, replace: true, expectedHash: first.manifestSha256 })).rejects.toThrow(reason);
    } finally { vi.restoreAllMocks(); }
    expect(await getLongAudioManifest(meetingId)).toEqual(first);
    expect(await (await getLongAudioChunk(meetingId, 0)).text()).toBe("original");
    expect(await (await getLongAudioChunk(meetingId, 1)).text()).toBe("retained");
    expect(await database.get("acousticCheckpoints", meetingId)).toEqual({ sentinel: "retained" });
    expect(await database.get("acousticEmbeddings", [meetingId, "sample"])).toEqual({ vector: [1] });
    expect(await database.get("acousticIdentities", [meetingId, "voice"])).toEqual({ voice: 1 });
    expect(await database.get("acousticAssignments", [meetingId, "label"])).toEqual({ voice: 1 });
    expect(await database.get("transcriptPages", [meetingId, "run", 0])).toEqual({ original: "source" });
    expect(await database.get("chunkSpeech", [meetingId, 0])).toEqual({ original: "speech" });
  });

  it("rejects a stale import without overwriting the winning recording", async () => {
    const meetingId = crypto.randomUUID();
    await storeLongAudio(input(meetingId, ["original"]));
    const candidate = input(meetingId, ["original"]);
    candidate.chunks[0].read = async () => {
      await repo.deleteMeeting(meetingId);
      await storeLongAudio(input(meetingId, ["winner"]));
      return new Blob(["original"]);
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
    const overlapEvidence = {audioSha256: hash, source: "Synthetic detector", intervals: [{start: 1, end: 2}]};
    const saved = await repo.saveMeeting({ ...meeting, audio: { name: "legacy.mp3", type: "audio/mpeg", size: 16, duration: 20, hash, present: true, overlapEvidence,
      chunked: { format: "mp3", chunkCount: 2, totalSeconds: 20, manifestSha256: hash } },
      jobs: [{ id: crypto.randomUUID(), stage: "speech", state: "completed", billing: "possibly_charged", inputRevision: meeting.revision,
        requestId: null, createdAt: meeting.createdAt, updatedAt: meeting.updatedAt, message: "Saved", chunk: { index: 0, total: 2 } }],
    });
    const speech = { speakers: [], segments: [segment("Saved first part")], duration: 10, requestId: null };
    await putChunkSpeech(saved.id, 0, speech);
    const restored = await readBackup(new File([await backupMeeting(saved)], "legacy.zip"));
    expect(restored.meeting.audio!.hash).toBe(first.manifestSha256);
    expect(restored.meeting.audio!.overlapEvidence).toEqual({...overlapEvidence, audioSha256: first.manifestSha256});
    expect((await repo.getMeeting(meeting.id))!.audio!.hash).toBe(hash);
    await repo.saveMeeting(restored.meeting, restored.audio);
    const attached = await storeLongAudio({ ...input(restored.meeting.id, ["original", "retained"]), expectedHash: restored.meeting.audio!.hash });
    expect(attached.manifestSha256).toBe(restored.meeting.audio!.hash);
    expect(await getChunkSpeech(restored.meeting.id, 0)).toEqual(speech);
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
