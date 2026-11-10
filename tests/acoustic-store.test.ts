import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACOUSTIC_POLICY, type AcousticEmbeddingRecord, type AcousticIdentity } from "../src/domain/acoustic-speaker";
import { createMeeting } from "../src/domain/model";
import {
  deleteAcousticMeetingState,
  getAcousticCheckpoint,
  getAcousticEmbedding,
  listTranscriptPages,
  putAcousticCheckpoint,
  putAcousticEmbedding,
  putAcousticIdentity,
  putChunkAttempt,
  putTranscriptPage,
} from "../src/storage/acoustic-store";
import { deleteMeeting, getMeeting, saveMeeting } from "../src/storage/repository";

vi.stubGlobal("window", new EventTarget());

const hash = "b".repeat(64);
const otherHash = "c".repeat(64);
const embedding: AcousticEmbeddingRecord = {
  id: "sample:0:speaker:0.000:2.000",
  meetingId: "pending",
  recordingHash: hash,
  sourceRevision: 1,
  chunkIndex: 0,
  sourceSpeakerId: "speaker",
  sample: { id: "sample:0:speaker:0.000:2.000", chunkIndex: 0, sourceSpeakerId: "speaker", startSeconds: 0, endSeconds: 2, segmentIds: ["segment"] },
  modelId: ACOUSTIC_POLICY.modelId,
  modelRevision: ACOUSTIC_POLICY.modelRevision,
  extractionVersion: ACOUSTIC_POLICY.version,
  values: Array.from({ length: ACOUSTIC_POLICY.dimensions }, (_, index) => index === 0 ? 1 : 0),
  createdAt: new Date().toISOString(),
};
const identity: AcousticIdentity = {
  id: "voice-1",
  meetingId: "pending",
  recordingHash: hash,
  sourceRevision: 1,
  modelRevision: ACOUSTIC_POLICY.modelRevision,
  extractionVersion: ACOUSTIC_POLICY.version,
  centroid: embedding.values,
  anchors: [embedding.values],
  representativeEmbeddingIds: [embedding.id],
  sourceKeys: ["0:speaker"],
  sourceCount: 1,
  sampleCount: 1,
  confirmedSpeakerId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function meetingWithAudio() {
  const meeting = createMeeting();
  const saved = await saveMeeting({
    ...meeting,
    audio: { name: "sample.mp3", type: "audio/mpeg", size: 1, duration: 2, hash, present: true },
  });
  return saved;
}

afterEach(async () => {
  // Tests use unique meetings; no broad origin deletion is needed.
});

describe("acoustic and paged source stores", () => {
  it("persists bounded vectors/checkpoints and keeps historical pages across recording replacement", async () => {
    const meeting = await meetingWithAudio();
    await putAcousticEmbedding({ ...embedding, meetingId: meeting.id });
    await putAcousticIdentity({ ...identity, meetingId: meeting.id });
    await putAcousticCheckpoint({
      id: meeting.id,
      meetingId: meeting.id,
      recordingHash: hash,
      sourceRevision: meeting.revision,
      modelId: ACOUSTIC_POLICY.modelId,
      modelRevision: ACOUSTIC_POLICY.modelRevision,
      extractionVersion: ACOUSTIC_POLICY.version,
      thresholdVersion: ACOUSTIC_POLICY.version,
      calibrationStatus: "uncalibrated",
      state: "completed",
      nextChunkIndex: 1,
      nextSpeakerKey: null,
      completedChunkCount: 1,
      lastCompletedChunkIndex: 0,
      processedEmbeddingCount: 1,
      error: null,
      updatedAt: new Date().toISOString(),
    });
    await putTranscriptPage({
      meetingId: meeting.id,
      runId: "run-old",
      recordingHash: hash,
      sourceRevision: meeting.revision,
      pageIndex: 0,
      provider: "OpenRouter",
      model: "scribe",
      chunkIndex: 0,
      sourceStartSeconds: 0,
      sourceEndSeconds: 2,
      original: { speakers: [], segments: [], duration: 2, requestId: null },
      createdAt: new Date().toISOString(),
    });
    await putChunkAttempt({
      meetingId: meeting.id,
      runId: "run-old",
      recordingHash: hash,
      sourceRevision: meeting.revision,
      chunkIndex: 0,
      provider: "OpenRouter",
      model: "scribe",
      state: "completed",
      requestId: "request-1",
      originalSaved: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: "saved",
    });
    expect(await getAcousticEmbedding(meeting.id, embedding.id)).toBeTruthy();
    expect(await getAcousticCheckpoint(meeting.id)).toMatchObject({ state: "completed" });

    await saveMeeting({
      ...(await getMeeting(meeting.id))!,
      audio: { name: "new.mp3", type: "audio/mpeg", size: 1, duration: 2, hash: otherHash, present: true },
    });
    expect(await getAcousticEmbedding(meeting.id, embedding.id)).toBeUndefined();
    expect(await listTranscriptPages(meeting.id, "run-old")).toHaveLength(1);
  });

  it("rejects a late acoustic write after meeting deletion or recording replacement", async () => {
    const meeting = await meetingWithAudio();
    await saveMeeting({
      ...(await getMeeting(meeting.id))!,
      audio: { name: "new.mp3", type: "audio/mpeg", size: 1, duration: 2, hash: otherHash, present: true },
    });
    await expect(putAcousticEmbedding({ ...embedding, meetingId: meeting.id })).rejects.toThrow("stale");
    await deleteAcousticMeetingState(meeting.id);
    await deleteMeeting(meeting.id);
    expect(await getMeeting(meeting.id)).toBeUndefined();
    await expect(putAcousticEmbedding({ ...embedding, meetingId: meeting.id })).rejects.toThrow();
  });
});

