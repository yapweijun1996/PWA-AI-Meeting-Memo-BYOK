import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createMeeting } from "../src/domain/model";
import { importLongRecording, isLongRecordingCandidate } from "../src/audio/long-import";
import { getLongAudioManifest, getLongAudioChunk, deleteLongAudio } from "../src/storage/long-audio-store";
import { planMp4Split } from "../src/audio/mp4-split";
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
});
