import { z } from "zod";
import type {
  AcousticAssignment,
  AcousticCheckpoint,
  AcousticEmbeddingRecord,
  AcousticIdentity,
} from "../domain/acoustic-speaker";
import { ACOUSTIC_POLICY } from "../domain/acoustic-speaker";
import { db } from "./repository";

const finiteVector = z.array(z.number().finite()).length(ACOUSTIC_POLICY.dimensions);
const sampleSchema = z
  .object({
    id: z.string().min(1).max(300),
    chunkIndex: z.number().int().nonnegative(),
    sourceSpeakerId: z.string().min(1).max(160),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    segmentIds: z.array(z.string().min(1).max(160)).max(100),
  })
  .strict()
  .refine((value) => value.endSeconds > value.startSeconds, "Invalid sample range");
const embeddingSchema = z
  .object({
    id: z.string().min(1).max(300),
    meetingId: z.string().min(1).max(100),
    recordingHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.number().int().positive(),
    chunkIndex: z.number().int().nonnegative(),
    sourceSpeakerId: z.string().min(1).max(160),
    sample: sampleSchema,
    modelId: z.string().min(1).max(200),
    modelRevision: z.string().min(1).max(200),
    extractionVersion: z.string().min(1).max(100),
    values: finiteVector,
    createdAt: z.iso.datetime(),
  })
  .strict();
const candidateSchema = z
  .object({
    identityId: z.string().min(1).max(200),
    mean: z.number().finite(),
    minimum: z.number().finite(),
    support: z.number().int().nonnegative(),
  })
  .strict();
const identitySchema = z
  .object({
    id: z.string().min(1).max(200),
    meetingId: z.string().min(1).max(100),
    recordingHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.number().int().positive(),
    modelRevision: z.string().min(1).max(200),
    extractionVersion: z.string().min(1).max(100),
    centroid: finiteVector,
    anchors: z.array(finiteVector).max(8),
    representativeEmbeddingIds: z.array(z.string().min(1).max(300)).max(32),
    sourceKeys: z.array(z.string().min(1).max(300)).max(64),
    sourceCount: z.number().int().nonnegative(),
    sampleCount: z.number().int().nonnegative(),
    confirmedSpeakerId: z.string().min(1).max(160).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const assignmentSchema = z
  .object({
    id: z.string().min(1).max(300),
    meetingId: z.string().min(1).max(100),
    recordingHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.number().int().positive(),
    sourceKey: z.string().min(1).max(300),
    chunkIndex: z.number().int().nonnegative(),
    sourceSpeakerId: z.string().min(1).max(160),
    state: z.enum(["matched", "new_identity", "ambiguous", "unresolved", "conflict", "stale"]),
    identityId: z.string().min(1).max(200).nullable(),
    scores: z.array(candidateSchema).max(4096),
    evidenceEmbeddingIds: z.array(z.string().min(1).max(300)).max(32),
    reason: z.string().min(1).max(500),
    thresholdVersion: z.string().min(1).max(100),
    calibrationStatus: z.enum(["uncalibrated", "calibrated"]),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const checkpointSchema = z
  .object({
    id: z.string().min(1).max(100),
    meetingId: z.string().min(1).max(100),
    recordingHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.number().int().positive(),
    modelId: z.string().min(1).max(200),
    modelRevision: z.string().min(1).max(200),
    extractionVersion: z.string().min(1).max(100),
    thresholdVersion: z.string().min(1).max(100),
    calibrationStatus: z.enum(["uncalibrated", "calibrated"]),
    state: z.enum(["idle", "running", "paused", "completed", "failed_local", "storage_exhausted", "stale"]),
    nextChunkIndex: z.number().int().nonnegative(),
    nextSpeakerKey: z.string().min(1).max(300).nullable(),
    completedChunkCount: z.number().int().nonnegative(),
    lastCompletedChunkIndex: z.number().int().nonnegative().nullable(),
    processedEmbeddingCount: z.number().int().nonnegative(),
    error: z.string().max(1000).nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export interface TranscriptPage {
  meetingId: string;
  runId: string;
  recordingHash: string;
  sourceRevision: number;
  pageIndex: number;
  provider: string;
  model: string;
  chunkIndex: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  original: {
    speakers: AcousticPageSpeaker[];
    segments: AcousticPageSegment[];
    duration: number | null;
    requestId: string | null;
  };
  createdAt: string;
}

interface AcousticPageSpeaker {
  id: string;
  name: string;
  confirmed: boolean;
  sourceLabels: string[];
}
interface AcousticPageSegment {
  id: string;
  revision: number;
  start: number | null;
  end: number | null;
  speakerIds: string[];
  originalText: string;
  text: string;
  reviewed: boolean;
  parents: string[];
}

const pageSchema = z
  .object({
    meetingId: z.string().min(1).max(100),
    runId: z.string().min(1).max(100),
    recordingHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.number().int().positive(),
    pageIndex: z.number().int().nonnegative(),
    provider: z.string().min(1).max(80),
    model: z.string().min(1).max(100),
    chunkIndex: z.number().int().nonnegative(),
    sourceStartSeconds: z.number().finite().nonnegative(),
    sourceEndSeconds: z.number().finite().nonnegative(),
    original: z
      .object({
        speakers: z
          .array(
            z
              .object({
                id: z.string().min(1).max(160),
                name: z.string().min(1).max(80),
                confirmed: z.boolean(),
                sourceLabels: z.array(z.string().max(160)).max(100),
              })
              .strict(),
          )
          .max(100),
        segments: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                revision: z.number().int().positive(),
                start: z.number().finite().nonnegative().nullable(),
                end: z.number().finite().nonnegative().nullable(),
                speakerIds: z.array(z.string().min(1).max(160)).max(10),
                originalText: z.string().max(20000),
                text: z.string().max(20000),
                reviewed: z.boolean(),
                parents: z.array(z.string().max(100)).max(20),
              })
              .strict(),
          )
          .max(20000),
        duration: z.number().finite().nonnegative().nullable(),
        requestId: z.string().max(200).nullable(),
      })
      .strict(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export interface ChunkAttempt {
  meetingId: string;
  runId: string;
  recordingHash: string;
  sourceRevision: number;
  chunkIndex: number;
  provider: string;
  model: string;
  state: "submitted" | "completed" | "failed" | "outcome_unknown";
  requestId: string | null;
  originalSaved: boolean;
  createdAt: string;
  updatedAt: string;
  message: string;
}
const attemptSchema = z
  .object({
    meetingId: z.string().min(1).max(100),
    runId: z.string().min(1).max(100),
    recordingHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.number().int().positive(),
    chunkIndex: z.number().int().nonnegative(),
    provider: z.string().min(1).max(80),
    model: z.string().min(1).max(100),
    state: z.enum(["submitted", "completed", "failed", "outcome_unknown"]),
    requestId: z.string().max(200).nullable(),
    originalSaved: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    message: z.string().max(1000),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

async function putAcousticScoped(
  store: "acousticEmbeddings" | "acousticIdentities" | "acousticAssignments" | "acousticCheckpoints",
  key: string | [string, string],
  value: unknown,
  context: { meetingId: string; recordingHash: string; sourceRevision: number },
): Promise<void> {
  const database = await db();
  const tx = database.transaction(["meetings", store], "readwrite");
  const meeting = await tx.objectStore("meetings").get(context.meetingId);
  if (!meeting || meeting.audio?.hash !== context.recordingHash || meeting.revision !== context.sourceRevision) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error("Acoustic checkpoint is stale because the meeting or recording changed.");
  }
  await tx.objectStore(store).put(value, key);
  await tx.done;
}

async function putHistoricalScoped(
  store: "transcriptPages" | "chunkAttempts",
  key: [string, string, number],
  value: unknown,
  meetingId: string,
): Promise<void> {
  const database = await db();
  const tx = database.transaction(["meetings", store], "readwrite");
  const meeting = await tx.objectStore("meetings").get(meetingId);
  if (!meeting) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error("Meeting was deleted before the historical source result could be saved.");
  }
  await tx.objectStore(store).put(value, key);
  await tx.done;
}

export async function putAcousticEmbedding(value: AcousticEmbeddingRecord): Promise<void> {
  const parsed = parse(embeddingSchema, value);
  await putAcousticScoped("acousticEmbeddings", [parsed.meetingId, parsed.id], parsed, parsed);
}
export async function getAcousticEmbedding(meetingId: string, id: string): Promise<AcousticEmbeddingRecord | undefined> {
  const value = await (await db()).get("acousticEmbeddings", [meetingId, id]);
  return value === undefined ? undefined : parse(embeddingSchema, value);
}
export async function listAcousticEmbeddings(meetingId: string): Promise<AcousticEmbeddingRecord[]> {
  const values = await (await db()).getAll("acousticEmbeddings", IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"]));
  return values.map((value) => parse(embeddingSchema, value));
}
export async function deleteAcousticEmbeddings(meetingId: string): Promise<void> {
  await (await db()).delete("acousticEmbeddings", IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"]));
}

export async function putAcousticIdentity(value: AcousticIdentity): Promise<void> {
  const parsed = parse(identitySchema, value);
  await putAcousticScoped("acousticIdentities", [parsed.meetingId, parsed.id], parsed, parsed);
}
export async function getAcousticIdentity(meetingId: string, id: string): Promise<AcousticIdentity | undefined> {
  const value = await (await db()).get("acousticIdentities", [meetingId, id]);
  return value === undefined ? undefined : parse(identitySchema, value);
}
export async function listAcousticIdentities(meetingId: string): Promise<AcousticIdentity[]> {
  const values = await (await db()).getAll("acousticIdentities", IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"]));
  return values.map((value) => parse(identitySchema, value));
}
export async function deleteAcousticIdentities(meetingId: string): Promise<void> {
  await (await db()).delete("acousticIdentities", IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"]));
}

export async function putAcousticAssignment(value: AcousticAssignment): Promise<void> {
  const parsed = parse(assignmentSchema, value);
  await putAcousticScoped("acousticAssignments", [parsed.meetingId, parsed.sourceKey], parsed, parsed);
}
export async function getAcousticAssignment(meetingId: string, sourceKey: string): Promise<AcousticAssignment | undefined> {
  const value = await (await db()).get("acousticAssignments", [meetingId, sourceKey]);
  return value === undefined ? undefined : parse(assignmentSchema, value);
}
export async function listAcousticAssignments(meetingId: string): Promise<AcousticAssignment[]> {
  const values = await (await db()).getAll("acousticAssignments", IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"]));
  return values.map((value) => parse(assignmentSchema, value));
}
export async function deleteAcousticAssignments(meetingId: string): Promise<void> {
  await (await db()).delete("acousticAssignments", IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"]));
}

export async function putAcousticCheckpoint(value: AcousticCheckpoint): Promise<void> {
  const parsed = parse(checkpointSchema, value);
  await putAcousticScoped("acousticCheckpoints", parsed.meetingId, parsed, parsed);
}
export async function getAcousticCheckpoint(meetingId: string): Promise<AcousticCheckpoint | undefined> {
  const value = await (await db()).get("acousticCheckpoints", meetingId);
  return value === undefined ? undefined : parse(checkpointSchema, value);
}

export async function putTranscriptPage(value: TranscriptPage): Promise<void> {
  const parsed = parse(pageSchema, value);
  await putHistoricalScoped("transcriptPages", [parsed.meetingId, parsed.runId, parsed.pageIndex], parsed, parsed.meetingId);
}
export async function getTranscriptPage(meetingId: string, runId: string, pageIndex: number): Promise<TranscriptPage | undefined> {
  const value = await (await db()).get("transcriptPages", [meetingId, runId, pageIndex]);
  return value === undefined ? undefined : parse(pageSchema, value);
}
export async function listTranscriptPages(meetingId: string, runId?: string): Promise<TranscriptPage[]> {
  const values = await (await db()).getAll(
    "transcriptPages",
    runId === undefined
      ? IDBKeyRange.bound([meetingId, "", 0], [meetingId, "\uffff", Infinity])
      : IDBKeyRange.bound([meetingId, runId, 0], [meetingId, runId, Infinity]),
  );
  return values.map((value) => parse(pageSchema, value)).sort((left, right) => left.pageIndex - right.pageIndex);
}
export async function deleteTranscriptPages(meetingId: string): Promise<void> {
  await (await db()).delete("transcriptPages", IDBKeyRange.bound([meetingId, "", 0], [meetingId, "\uffff", Infinity]));
}

export async function putChunkAttempt(value: ChunkAttempt): Promise<void> {
  const parsed = parse(attemptSchema, value);
  await putHistoricalScoped("chunkAttempts", [parsed.meetingId, parsed.runId, parsed.chunkIndex], parsed, parsed.meetingId);
}
export async function getChunkAttempt(meetingId: string, runId: string, chunkIndex: number): Promise<ChunkAttempt | undefined> {
  const value = await (await db()).get("chunkAttempts", [meetingId, runId, chunkIndex]);
  return value === undefined ? undefined : parse(attemptSchema, value);
}
export async function listChunkAttempts(meetingId: string, runId?: string): Promise<ChunkAttempt[]> {
  const values = await (await db()).getAll(
    "chunkAttempts",
    runId === undefined
      ? IDBKeyRange.bound([meetingId, "", 0], [meetingId, "\uffff", Infinity])
      : IDBKeyRange.bound([meetingId, runId, 0], [meetingId, runId, Infinity]),
  );
  return values.map((value) => parse(attemptSchema, value)).sort((left, right) => left.chunkIndex - right.chunkIndex);
}
export async function deleteChunkAttempts(meetingId: string): Promise<void> {
  await (await db()).delete("chunkAttempts", IDBKeyRange.bound([meetingId, "", 0], [meetingId, "\uffff", Infinity]));
}

/** Remove only this meeting's derived acoustic state for a replaced recording. */
export async function deleteAcousticFeatures(meetingId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    ["acousticEmbeddings", "acousticIdentities", "acousticAssignments", "acousticCheckpoints"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("acousticEmbeddings").delete(IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"])),
    tx.objectStore("acousticIdentities").delete(IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"])),
    tx.objectStore("acousticAssignments").delete(IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"])),
    tx.objectStore("acousticCheckpoints").delete(meetingId),
  ]);
  await tx.done;
}

/** Remove all local pages and acoustic state only when the meeting is deleted. */
export async function deleteAcousticMeetingState(meetingId: string): Promise<void> {
  await deleteAcousticFeatures(meetingId);
  const database = await db();
  const tx = database.transaction(["transcriptPages", "chunkAttempts"], "readwrite");
  await Promise.all([
    tx.objectStore("transcriptPages").delete(IDBKeyRange.bound([meetingId, "", 0], [meetingId, "\uffff", Infinity])),
    tx.objectStore("chunkAttempts").delete(IDBKeyRange.bound([meetingId, "", 0], [meetingId, "\uffff", Infinity])),
  ]);
  await tx.done;
}
