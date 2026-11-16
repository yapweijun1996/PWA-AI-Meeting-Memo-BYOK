import { MAX_MEETING_JSON_BYTES, type Meeting } from "../domain/model";
import { getLongAudioManifest } from "./long-audio-store";
import { db } from "./repository";
import { getSpeakerAvatars } from "./speaker-avatars";

/**
 * Read-only measurement of what this app keeps in the browser's IndexedDB. It never
 * writes or deletes anything and never reads provider keys or settings. Sizes are
 * estimates: JSON text length for structured records, byte length for audio.
 */

export interface RecordParts {
  segments: number;
  history: number;
  undo: number;
  providerRuns: number;
  memos: number;
  memoPlans: number;
  other: number;
}

export interface MeetingStorageRow {
  meetingId: string;
  title: string;
  /** The meeting as one JSON document: the unit the meeting size limit applies to. */
  recordBytes: number;
  recordParts: RecordParts;
  /** Share of the meeting size limit the record uses, 0 to 1 or more. */
  limitShare: number;
  /** Stored recording (a single file, or the parts of a long recording). */
  recordingBytes: number;
  /** Voice vectors and decisions, saved transcript pages and part attempts. */
  voiceAndPartBytes: number;
  /** Speaker profile images. */
  imageBytes: number;
  totalBytes: number;
}

export interface StorageReport {
  scannedAt: string;
  /** Browser-wide estimate for this origin (it can include other apps on the same site). */
  usageBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean | null;
  meetingLimitBytes: number;
  meetings: MeetingStorageRow[];
  /** Sum of what this report measured. */
  measuredBytes: number;
}

const encoder = new TextEncoder();
const jsonBytes = (value: unknown): number =>
  value === undefined ? 0 : encoder.encode(JSON.stringify(value)).byteLength;

/** Size of each section of a meeting record, measured separately so one large string is never built twice. */
export function measureMeetingRecord(meeting: Meeting): { total: number; parts: RecordParts } {
  const { segments, history, undo, runs, memos, memoPipelines, ...rest } = meeting;
  const parts: RecordParts = {
    segments: jsonBytes(segments),
    history: jsonBytes(history),
    undo: jsonBytes(undo),
    providerRuns: jsonBytes(runs),
    memos: jsonBytes(memos),
    memoPlans: jsonBytes(memoPipelines),
    other: jsonBytes(rest),
  };
  return { total: Object.values(parts).reduce((sum, bytes) => sum + bytes, 0), parts };
}

/** Every key that starts with the meeting id, whatever follows it. */
const meetingRange = (meetingId: string) => IDBKeyRange.bound([meetingId], [meetingId, []]);

const PER_MEETING_STORES = [
  "chunkSpeech",
  "acousticEmbeddings",
  "acousticIdentities",
  "acousticAssignments",
  "transcriptPages",
  "chunkAttempts",
] as const;

async function voiceAndPartBytes(meetingId: string): Promise<number> {
  const database = await db();
  let total = 0;
  for (const store of PER_MEETING_STORES) {
    const values = await database.getAll(store, meetingRange(meetingId));
    total += jsonBytes(values);
  }
  const checkpoint = await database.get("acousticCheckpoints", meetingId);
  return total + jsonBytes(checkpoint);
}

async function recordingBytes(meeting: Meeting): Promise<number> {
  if (!meeting.audio?.present) return 0;
  if (meeting.audio.chunked) {
    // The manifest lists every stored part, so no audio has to be read to measure it.
    const manifest = await getLongAudioManifest(meeting.id).catch(() => undefined);
    return manifest ? manifest.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) : meeting.audio.size;
  }
  return meeting.audio.size;
}

async function imageBytes(meetingId: string): Promise<number> {
  const images = await getSpeakerAvatars(meetingId).catch(() => ({}) as Record<string, string>);
  return Object.values(images).reduce((sum, image) => sum + image.length, 0);
}

export interface ScanOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export async function scanStorage(options: ScanOptions = {}): Promise<StorageReport> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  const [estimate, persisted] = await Promise.all([
    storage?.estimate?.().catch(() => undefined),
    storage?.persisted?.().catch(() => undefined),
  ]);
  const database = await db();
  const meetings = (await database.getAll("meetings")) as Meeting[];
  const rows: MeetingStorageRow[] = [];
  for (const [index, meeting] of meetings.entries()) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("The scan was cancelled.", "AbortError");
    const record = measureMeetingRecord(meeting);
    const [recording, voice, images] = await Promise.all([
      recordingBytes(meeting),
      voiceAndPartBytes(meeting.id),
      imageBytes(meeting.id),
    ]);
    rows.push({
      meetingId: meeting.id,
      title: meeting.title,
      recordBytes: record.total,
      recordParts: record.parts,
      limitShare: record.total / MAX_MEETING_JSON_BYTES,
      recordingBytes: recording,
      voiceAndPartBytes: voice,
      imageBytes: images,
      totalBytes: record.total + recording + voice + images,
    });
    options.onProgress?.(index + 1, meetings.length);
  }
  rows.sort((left, right) => right.totalBytes - left.totalBytes);
  return {
    scannedAt: new Date().toISOString(),
    usageBytes: estimate?.usage ?? null,
    quotaBytes: estimate?.quota ?? null,
    persisted: persisted ?? null,
    meetingLimitBytes: MAX_MEETING_JSON_BYTES,
    meetings: rows,
    measuredBytes: rows.reduce((sum, row) => sum + row.totalBytes, 0),
  };
}

/** Binary units, one decimal: "13.9 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
