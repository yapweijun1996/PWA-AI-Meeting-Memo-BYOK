import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../src/providers/api";
import type * as ProviderApi from "../src/providers/api";
import { createMeeting, MeetingSchema, segment } from "../src/domain/model";
import { getChunkSpeech } from "../src/storage/chunk-speech-store";
import { storeLongAudio } from "../src/storage/long-audio-store";
import { getMeeting, saveMeeting } from "../src/storage/repository";
import { runChunkedSpeech } from "../src/jobs/chunked-runner";

const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), getKey: vi.fn(() => "test-key"), getSpeechEstimate: vi.fn(() => null) }));
vi.mock("../src/providers/credentials", () => ({ getKey: mocks.getKey, getSpeechEstimate: mocks.getSpeechEstimate }));
vi.mock("../src/providers/api", async () => {
  const actual = await vi.importActual<typeof ProviderApi>("../src/providers/api");
  return { ...actual, transcribe: mocks.transcribe };
});
vi.stubGlobal("window", new EventTarget());
const selection = { provider: "openrouter" as const, model: "scribe" };
const prepare = async () => {
  const meeting = createMeeting();
  const chunks = ["a", "b", "c"];
  const manifest = await storeLongAudio({
    meetingId: meeting.id, format: "mp3", mimeType: "audio/mpeg", totalSeconds: 30, sampleRate: 44100,
    chunks: chunks.map((value, index) => ({
      meta: { index, ownStartSeconds: index * 10, ownDurationSeconds: 10, leadInSeconds: 0 },
      read: async () => new Blob([value]),
    })),
  });
  const saved = await saveMeeting({
    ...meeting,
    audio: { name: "meeting.mp3", type: "audio/mpeg", size: manifest.totalBytes, duration: 30, hash: manifest.manifestSha256, present: true,
      chunked: { format: "mp3", chunkCount: 3, totalSeconds: 30, manifestSha256: manifest.manifestSha256 } },
  });
  return saved;
};
const response = (text: string, time: number) => ({ speakers: [], segments: [segment(text, [], time, time + 1)], duration: 10, requestId: null });
afterEach(() => { mocks.transcribe.mockReset(); mocks.getKey.mockReturnValue("test-key"); });

describe("chunked speech runner", () => {
  it("transcribes each chunk once, records indexed jobs, and merges absolute timestamps", async () => {
    mocks.transcribe.mockImplementation(async (_audio: Blob, _key: string, _signal: AbortSignal, _selection: unknown, filename: string) => response(filename.includes("0001") ? "one" : filename.includes("0002") ? "two" : "three", 1));
    const meeting = await prepare();
    const result = await runChunkedSpeech(meeting, { selection });
    expect(mocks.transcribe).toHaveBeenCalledTimes(3);
    expect(result.jobs.map((job) => job.chunk)).toEqual([{ index: 0, total: 3 }, { index: 1, total: 3 }, { index: 2, total: 3 }]);
    expect(result.jobs.map((job) => job.state)).toEqual(["completed", "completed", "completed"]);
    expect(result.segments.map((item) => [item.text, item.start])).toEqual([["one", 1], ["two", 11], ["three", 21]]);
  });

  it("stops on a failed chunk and resumes without resending saved speech", async () => {
    mocks.transcribe.mockImplementation(async (_audio: Blob, _key: string, _signal: AbortSignal, _selection: unknown, filename: string) => {
      if (filename.includes("0002")) throw new ProviderError("Rejected", false, false, true);
      return response("first", 1);
    });
    const meeting = await prepare();
    await expect(runChunkedSpeech(meeting, { selection })).rejects.toThrow("Rejected");
    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    const interrupted = await getMeeting(meeting.id);
    expect(interrupted?.jobs.map((job) => job.state)).toEqual(["completed", "failed"]);
    expect((await getChunkSpeech(meeting.id, 0))?.segments[0].text).toBe("first");
    expect(await getChunkSpeech(meeting.id, 1)).toBeUndefined();
    mocks.transcribe.mockImplementation(async (_audio: Blob, _key: string, _signal: AbortSignal, _selection: unknown, filename: string) => response(filename.includes("0002") ? "second" : "third", 1));
    const result = await runChunkedSpeech(interrupted!, { selection });
    expect(mocks.transcribe).toHaveBeenCalledTimes(4);
    expect(result.segments.map((item) => item.text)).toEqual(["first", "second", "third"]);
  });

  it("does not resubmit an unknown chunk without explicit human review", async () => {
    mocks.transcribe.mockRejectedValue(new ProviderError("Timed out", true, false, true));
    const meeting = await prepare();
    await expect(runChunkedSpeech(meeting, { selection })).rejects.toThrow("Timed out");
    const interrupted = await getMeeting(meeting.id);
    expect(interrupted?.jobs[0].state).toBe("outcome_unknown");
    await expect(runChunkedSpeech(interrupted!, { selection })).rejects.toThrow("Review billing");
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    mocks.transcribe.mockResolvedValue(response("reviewed", 1));
    await runChunkedSpeech(interrupted!, { selection, reviewedChunks: [0] });
    expect(mocks.transcribe).toHaveBeenCalledTimes(4);
  });
  it("accepts legacy meetings and enforces the 400-job history boundary", () => {
    const legacy = createMeeting();
    expect(MeetingSchema.safeParse(legacy).success).toBe(true);
    const jobs = Array.from({ length: 400 }, () => ({
      id: crypto.randomUUID(), stage: "speech" as const, state: "completed" as const,
      billing: "possibly_charged" as const, createdAt: "now", updatedAt: "now", requestId: null,
      message: "done", inputRevision: 1,
    }));
    expect(MeetingSchema.safeParse({ ...legacy, jobs }).success).toBe(true);
    expect(MeetingSchema.safeParse({ ...legacy, jobs: [...jobs, jobs[0]] }).success).toBe(false);
  });
});
