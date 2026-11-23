import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACOUSTIC_POLICY } from "../src/domain/acoustic-speaker";
import { putAcousticAssignment, putAcousticCheckpoint, putAcousticIdentity } from "../src/storage/acoustic-store";
import { ProviderError } from "../src/providers/api";
import type * as ProviderApi from "../src/providers/api";
import { createMeeting, MeetingSchema, segment } from "../src/domain/model";
import { backupMeeting, readBackup } from "../src/storage/backup";
import { deleteChunkSpeech, getChunkSpeech } from "../src/storage/chunk-speech-store";
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
const recording = (leadInSeconds = 0) => ({
  format: "mp3" as const, mimeType: "audio/mpeg", totalSeconds: 30, sampleRate: 44100,
  chunks: ["a", "b", "c"].map((value, index) => ({
    meta: { index, ownStartSeconds: index * 10, ownDurationSeconds: 10, leadInSeconds: index === 0 ? 0 : leadInSeconds },
    read: async () => new Blob([value]),
  })),
});
const prepare = async (leadInSeconds = 0) => {
  const meeting = createMeeting();
  const manifest = await storeLongAudio({ ...recording(leadInSeconds), meetingId: meeting.id });
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
  it("does not submit paid chunks when requested voice analysis cannot acquire cross-tab locks", async () => {
    const meeting = await prepare();
    const original = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    try {
      await expect(runChunkedSpeech(meeting, {
        selection,
        acoustic: { provider: { load: vi.fn(), embed: vi.fn(), dispose: vi.fn() }, consent: true },
      })).rejects.toThrow("cross-tab locking");
      expect(mocks.transcribe).not.toHaveBeenCalled();
      expect((await getMeeting(meeting.id))?.jobs).toEqual([]);
    } finally {
      if (original) Object.defineProperty(navigator, "locks", original);
      else Reflect.deleteProperty(navigator, "locks");
    }
  });
  it.each(["failed_local", "completed", "model failure"] as const)(
    "publishes only finalized acoustic identities with the saved speech (%s)",
    async (outcome) => {
      const meeting = await prepare();
      const common = { meetingId: meeting.id, recordingHash: meeting.audio!.hash, sourceRevision: meeting.revision };
      const updatedAt = new Date().toISOString();
      const checkpoint = { ...common, id: meeting.id, modelId: ACOUSTIC_POLICY.modelId, modelRevision: ACOUSTIC_POLICY.modelRevision,
        extractionVersion: ACOUSTIC_POLICY.extractionVersion, thresholdVersion: ACOUSTIC_POLICY.version,
        calibrationStatus: ACOUSTIC_POLICY.calibrationStatus, updatedAt };
      const completed = outcome === "completed";
      await putAcousticCheckpoint({ ...checkpoint, state: completed ? "completed" : "failed_local",
        completedChunkCount: completed ? 3 : 1, nextChunkIndex: completed ? 3 : 1, lastCompletedChunkIndex: completed ? 2 : 0,
        nextSpeakerKey: null, processedEmbeddingCount: 2, error: completed ? null : "interrupted" });
      const voiceId = crypto.randomUUID();
      const sourceSpeakerId = crypto.randomUUID();
      const sourceKey = `0:${sourceSpeakerId}`;
      const sample = Array.from({ length: ACOUSTIC_POLICY.dimensions }, (_, i) => Number(i === 0));
      await putAcousticIdentity({ ...common, id: voiceId, modelRevision: checkpoint.modelRevision,
        extractionVersion: checkpoint.extractionVersion, centroid: sample, anchors: [sample], sourceKeys: [sourceKey],
        representativeEmbeddingIds: [], sourceCount: 1, sampleCount: 2, confirmedSpeakerId: null, createdAt: updatedAt, updatedAt });
      await putAcousticAssignment({ ...common, id: `${meeting.id}:${sourceKey}`, chunkIndex: 0, sourceKey, sourceSpeakerId,
        identityId: voiceId, state: "new_identity", scores: [], evidenceEmbeddingIds: [], reason: "First part",
        thresholdVersion: checkpoint.thresholdVersion, calibrationStatus: checkpoint.calibrationStatus, updatedAt });
      mocks.transcribe.mockResolvedValue({ speakers: [{ id: sourceSpeakerId, name: "Speaker 1", confirmed: false, sourceLabels: ["1"] }],
        segments: [segment("one", [sourceSpeakerId], 1, 2)], duration: 10, requestId: null });
      const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
      Object.defineProperty(navigator, "locks", { configurable: true, value: {
        request: (_name: string, _opts: unknown, work: (lock: object) => Promise<unknown>) => work({}),
      } });
      try {
        const acoustic = outcome === "model failure" ? { consent: true, provider: {
          load: vi.fn().mockRejectedValue(new Error("local model unavailable")), embed: vi.fn(), dispose: vi.fn(),
        } } : undefined;
        const result = await runChunkedSpeech(meeting, { selection, acoustic });
        const sourceId = `part-0:${sourceSpeakerId}`;
        expect(result.segments[0]?.speakerIds).toEqual([completed ? voiceId : sourceId]);
        expect(result.runs.at(-1)?.originalSegments[0]?.speakerIds).toEqual([sourceId]);
        expect(result.segments).toHaveLength(3);
        expect(mocks.transcribe).toHaveBeenCalledTimes(3);
        if (acoustic) expect(result.jobs.at(-1)?.message).toContain("local model unavailable");
      } finally {
        if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
        else Reflect.deleteProperty(navigator, "locks");
      }
    },
  );

  it("transcribes each chunk once, records indexed jobs, and merges absolute timestamps", async () => {
    mocks.transcribe.mockImplementation(async (_audio: Blob, _key: string, _signal: AbortSignal, _selection: unknown, filename: string) => response(filename.includes("0001") ? "one" : filename.includes("0002") ? "two" : "three", 1));
    const meeting = await prepare();
    const result = await runChunkedSpeech(meeting, { selection });
    expect(mocks.transcribe).toHaveBeenCalledTimes(3);
    expect(result.jobs.map((job) => job.chunk)).toEqual([{ index: 0, total: 3 }, { index: 1, total: 3 }, { index: 2, total: 3 }]);
    expect(result.jobs.map((job) => job.state)).toEqual(["completed", "completed", "completed"]);
    expect(result.segments.map((item) => [item.text, item.start])).toEqual([["one", 1], ["two", 11], ["three", 21]]);
  });

  it("stores evidence-based links for matching words across adjacent chunk overlaps", async () => {
    const words = (prefix: string, offset: number, speakerId: string) => Array.from({ length: 8 }, (_, index) => {
      const start = offset + index * 0.45;
      return segment(`${prefix}${index}`, [speakerId], start, start + 0.2);
    });
    const makeSpeech = (index: number) => {
      const speakerId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const segments = index === 0
        ? words("a", 5, speakerId)
        : index === 1
          ? [...words("a", 0, speakerId), ...words("b", 10, speakerId)]
          : words("b", 0, speakerId);
      return {
        speakers: [{ id: speakerId, name: `Speaker ${index + 1}`, confirmed: false, sourceLabels: [speakerId] }],
        segments,
        duration: 15,
        requestId: null,
      };
    };
    mocks.transcribe.mockImplementation(async (_audio: Blob, _key: string, _signal: AbortSignal, _selection: unknown, filename: string) =>
      makeSpeech(Number(filename.match(/(\d{4})/)?.[1]) - 1));
    const meeting = await prepare(5);
    const result = await runChunkedSpeech(meeting, { selection });
    expect(result.speakerLinks).toEqual([
      { fromSpeakerId: "part-0:00000000-0000-4000-8000-000000000001", toSpeakerId: "part-1:00000000-0000-4000-8000-000000000002", sharedWords: 8, share: 1 },
      { fromSpeakerId: "part-1:00000000-0000-4000-8000-000000000002", toSpeakerId: "part-2:00000000-0000-4000-8000-000000000003", sharedWords: 8, share: 1 },
    ]);
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

  it("resumes a restored backup without replaying completed or unreviewed chunks", async () => {
    const meeting = await prepare();
    mocks.transcribe.mockResolvedValueOnce(response("first", 1));
    mocks.transcribe.mockRejectedValueOnce(new ProviderError("Timed out", true, false, true));
    await expect(runChunkedSpeech(meeting, { selection })).rejects.toThrow("Timed out");
    const interrupted = (await getMeeting(meeting.id))!;
    const restored = await readBackup(new File([await backupMeeting(interrupted)], "resume.zip"));
    const copy = await saveMeeting(restored.meeting, restored.audio);
    await storeLongAudio({ ...recording(), meetingId: copy.id, expectedHash: copy.audio!.hash });
    const attached = await saveMeeting({ ...copy, audio: { ...copy.audio!, present: true } });

    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    mocks.transcribe.mockClear();
    await expect(runChunkedSpeech(attached, { selection })).rejects.toThrow("Review billing");
    expect(mocks.transcribe).not.toHaveBeenCalled();
    mocks.transcribe.mockResolvedValueOnce(response("second", 1));
    mocks.transcribe.mockResolvedValueOnce(response("third", 1));
    const resumed = await runChunkedSpeech(attached, { selection, reviewedChunks: [1] });
    expect(mocks.transcribe.mock.calls.map((call) => call[4])).toEqual(["recording-0002.mp3", "recording-0003.mp3"]);
    expect(resumed.segments.map((item) => item.text)).toEqual(["first", "second", "third"]);
    expect(await getMeeting(meeting.id)).toEqual(interrupted);
  });

  it("never resubmits completed chunks when their separate saved results are missing", async () => {
    mocks.transcribe.mockResolvedValue(response("saved original", 1));
    const meeting = await prepare();
    const completed = await runChunkedSpeech(meeting, { selection });
    await deleteChunkSpeech(meeting.id);
    mocks.transcribe.mockClear();
    await expect(runChunkedSpeech(completed, { selection, reviewedChunks: [0, 1, 2] })).rejects.toThrow("Completed transcription results are missing");
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(await getMeeting(meeting.id)).toEqual(completed);
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
