import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createMeeting } from "../src/domain/model";
import { attachLongRecording, importLongRecording, isLongRecordingCandidate } from "../src/audio/long-import";
import { getLongAudioManifest, getLongAudioChunk, deleteLongAudio } from "../src/storage/long-audio-store";
import { planMp4Split } from "../src/audio/mp4-split";
import { backupMeeting, readBackup } from "../src/storage/backup";
import { db, flushWrites, getMeeting, saveMeeting } from "../src/storage/repository";
vi.stubGlobal("window", new EventTarget());

function mp3Blob(frameCount = 61_000): File {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const bytes = new Uint8Array(frameCount * frame.length);
  for (let offset = 0; offset < bytes.length; offset += frame.length) bytes.set(frame, offset);
  return new File([bytes.buffer as ArrayBuffer], "recording.mp3", { type: "audio/mpeg" });
}

describe("long recording import", () => {
  it("stores fragmented AAC as independently readable chunks for recovery", async () => {
    const bytes = await readFile("tests/fixtures/fragmented-aac.synthetic.m4a");
    const file = new File([bytes], "synthetic.m4a", { type: "audio/mp4" });
    const meeting = createMeeting();
    const result = await importLongRecording(file, meeting.id, { targetSeconds: 5, estimate: async () => ({ usage: 0, quota: 5_000_000_000 }) });
    const manifest = await getLongAudioManifest(meeting.id);
    expect(manifest?.chunks.length).toBeGreaterThan(1);
    expect(result.audio.chunked?.manifestSha256).toBe(manifest?.manifestSha256);
    for (const chunk of manifest!.chunks) {
      const saved = await getLongAudioChunk(meeting.id, chunk.index, { verify: true });
      const restored = await planMp4Split(saved, { targetSeconds: 3600, maxBytes: 20_000_000 });
      expect(restored.totalSeconds).toBeCloseTo(chunk.ownDurationSeconds + chunk.leadInSeconds);
    }
    await deleteLongAudio(meeting.id);
  });
  it("stores bounded MP3 chunks with manifest-backed meeting metadata without network access", async () => {
    const file = mp3Blob();
    const meeting = createMeeting();
    vi.stubGlobal("fetch", () => { throw new Error("network access is forbidden"); });
    expect(isLongRecordingCandidate(file)).toBe(true);
    const result = await importLongRecording(file, meeting.id, { estimate: async () => ({ usage: 0, quota: 5_000_000_000 }) });
    const manifest = await getLongAudioManifest(meeting.id);
    expect(manifest).toBeDefined();
    expect(manifest!.chunks.length).toBeGreaterThan(1);
    expect(manifest!.chunks.every((chunk) => chunk.byteLength <= 20_000_000)).toBe(true);
    expect(result.audio.chunked?.chunkCount).toBe(manifest!.chunks.length);
    expect(result.audio.hash).toBe(manifest!.manifestSha256);
  });

  it("rejects failed capacity, unsupported formats, oversize files, and aborts without persisted chunks", async () => {
    const meeting = createMeeting();
    const file = mp3Blob(1000);
    await expect(importLongRecording(file, meeting.id, { estimate: async () => ({ usage: 1000, quota: 1000 }) })).rejects.toThrow("below the required amount");
    expect(await getLongAudioManifest(meeting.id)).toBeUndefined();
    await expect(importLongRecording(new File([new Uint8Array(24_000_001)], "track.wav"), meeting.id)).rejects.toThrow("Convert this recording to MP3 or M4A");
    await expect(importLongRecording(new File([new Uint8Array(1)], "track.mp3"), meeting.id, { estimate: async () => ({ usage: 0, quota: 5_000_000_000 }) })).rejects.toThrow("Unable to parse MP3");
    const oversized = { name: "too-large.mp3", size: 4 * 1024 * 1024 * 1024 + 1 } as File;
    await expect(importLongRecording(oversized, meeting.id)).rejects.toThrow("4 GiB or smaller");
    const abortController = new AbortController();
    abortController.abort();
    await expect(importLongRecording(file, meeting.id, { signal: abortController.signal, estimate: async () => ({ usage: 0, quota: 5_000_000_000 }) })).rejects.toThrow();
    expect(await getLongAudioManifest(meeting.id)).toBeUndefined();
    await deleteLongAudio(meeting.id);
    expect(await getLongAudioManifest(meeting.id)).toBeUndefined();
  });

  it("reattaches the original MP3 to a restored meeting and preserves remaining evidence on mismatch", async () => {
    const file = mp3Blob();
    const estimate = async () => ({ usage: 0, quota: 5_000_000_000 });
    const original = createMeeting();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
      const first = await importLongRecording(file, original.id, { estimate });
      const saved = await saveMeeting({ ...original, audio: first.audio });
      const backup = await readBackup(new File([await backupMeeting(saved)], "meeting.zip"));
      const restored = await saveMeeting(backup.meeting);
      expect(restored.id).not.toBe(saved.id);
      vi.setSystemTime(new Date("2026-11-19T00:00:00Z"));
      const renamed = new File([file], "restored.mp3", { type: "audio/mp3" });
      const { meeting: live } = await attachLongRecording(renamed, restored, { estimate });
      const manifest = await getLongAudioManifest(restored.id);
      expect(manifest!.createdAt).not.toBe((await getLongAudioManifest(saved.id))!.createdAt);
      expect(live.audio!.hash).toBe(first.audio.hash);
      expect(live.audio!.present).toBe(true);
      expect(live.version).toBe(restored.version + 1);
      const database = await db();
      await database.delete("audioChunks", [live.id, 0]);
      await database.put("acousticCheckpoints", { kept: true }, live.id);
      const different = new File([file.slice(0, 20), new Uint8Array([42]), file.slice(21)], renamed.name, { type: renamed.type });
      await expect(attachLongRecording(different, live, { estimate }))
        .rejects.toThrow("Recording identity could not be verified");
      await expect(flushWrites()).resolves.toBeUndefined();
      expect(await getMeeting(live.id)).toEqual(live);
      expect(await getLongAudioManifest(live.id)).toEqual(manifest);
      expect(await database.get("audioChunks", [live.id, 0])).toBeUndefined();
      expect((await getLongAudioChunk(live.id, 1)).size).toBe(manifest!.chunks[1].byteLength);
      expect(await database.get("acousticCheckpoints", live.id)).toEqual({ kept: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["metadata write", "late cancellation"])("rolls back an identical repair on %s failure", async (failure) => {
    const meeting = await saveMeeting(createMeeting());
    const file = mp3Blob(1000);
    const options = { targetSeconds: 10, estimate: async () => ({ usage: 0, quota: 5_000_000_000 }) };
    const { meeting: saved } = await attachLongRecording(file, meeting, options);
    const manifest = await getLongAudioManifest(saved.id);
    expect(manifest!.chunks.length).toBeGreaterThan(1);
    const database = await db();
    await database.delete("audioChunks", [saved.id, 0]);
    await database.put("acousticCheckpoints", { kept: true }, saved.id);
    const controller = new AbortController();
    const originalPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "meetings") {
        if (failure === "metadata write") throw new DOMException("quota", "QuotaExceededError");
        const request = originalPut.apply(this, args);
        request.addEventListener("success", () => controller.abort(), { once: true });
        return request;
      }
      return originalPut.apply(this, args);
    });
    try {
      await expect(attachLongRecording(file, saved, { ...options, signal: controller.signal }))
        .rejects.toHaveProperty("name", failure === "metadata write" ? "LongAudioQuotaError" : "AbortError");
    } finally {
      spy.mockRestore();
    }
    expect(await getMeeting(saved.id)).toEqual(saved);
    expect(await getLongAudioManifest(saved.id)).toEqual(manifest);
    expect(await database.get("audioChunks", [saved.id, 0])).toBeUndefined();
    expect((await getLongAudioChunk(saved.id, 1)).size).toBe(manifest!.chunks[1].byteLength);
    expect(await database.get("acousticCheckpoints", saved.id)).toEqual({ kept: true });
  });
});
