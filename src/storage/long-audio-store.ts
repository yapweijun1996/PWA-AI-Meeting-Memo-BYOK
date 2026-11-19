import { z } from "zod";
import type { Meeting } from "../domain/model";
import { db, nextMeetingVersion, trackMeetingWrite } from "./repository";
import { deleteAcousticFeatures } from "./acoustic-store";

export interface ChunkMeta {
  index: number;
  byteLength: number;
  sha256: string;
  ownStartSeconds: number;
  ownDurationSeconds: number;
  leadInSeconds: number;
}

export interface LongAudioManifest {
  meetingId: string;
  identityVersion?: 2;
  format: "mp3" | "mp4";
  mimeType: string;
  totalSeconds: number;
  sampleRate: number;
  totalBytes: number;
  createdAt: string;
  chunks: ChunkMeta[];
  manifestSha256: string;
}

const ChunkMetaSchema = z.object({
  index: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  ownStartSeconds: z.number().finite().nonnegative(),
  ownDurationSeconds: z.number().finite().nonnegative(),
  leadInSeconds: z.number().finite().nonnegative(),
}).strict();
const ManifestSchema = z.object({
  meetingId: z.string().min(1),
  identityVersion: z.literal(2).optional(),
  format: z.enum(["mp3", "mp4"]),
  mimeType: z.string().min(1),
  totalSeconds: z.number().finite().nonnegative(),
  sampleRate: z.number().finite().positive(),
  totalBytes: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  chunks: z.array(ChunkMetaSchema),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type ManifestWithoutHash = Omit<LongAudioManifest, "manifestSha256">;

export class LongAudioIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongAudioIntegrityError";
  }
}
export class LongAudioQuotaError extends Error {
  constructor() {
    super("Browser storage quota was exceeded while saving long audio. Free storage space and try again.");
    this.name = "LongAudioQuotaError";
  }
}

const MiB = 1024 * 1024;
const stagingPrefix = "staging:";
// Without Web Locks, retain stages for 24 hours after the last staged write.
// For legacy stages without a lease, the grace period starts at first cleanup.
const stagingLeaseMs = 24 * 60 * 60 * 1000;
const StagingLeaseSchema = z.object({ updatedAt: z.number().finite(), usesWebLock: z.boolean() });
const identityError = "Recording identity could not be verified. Use the original recording; for an older restored backup, export a new backup from the original meeting first. Existing data was retained.";
const incompleteStage = "Staged recording is incomplete. Existing data was retained; import the recording again.";
export async function checkCapacity(
  neededBytes: number,
  estimate?: () => Promise<{ usage?: number; quota?: number }>,
): Promise<{ ok: boolean | "unknown"; available: number | null; needed: number; message: string }> {
  const needed = neededBytes * 1.2 + 50 * MiB;
  try {
    const getEstimate = estimate ?? (() => {
      const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
      return storage?.estimate ? storage.estimate() : Promise.reject(new Error("Storage estimate unsupported"));
    });
    const result = await getEstimate();
    if (typeof result.quota !== "number" || typeof result.usage !== "number" || !Number.isFinite(result.quota) || !Number.isFinite(result.usage)) {
      return { ok: "unknown", available: null, needed, message: "Available browser storage could not be determined; capacity is unknown." };
    }
    const available = Math.max(0, result.quota - result.usage);
    return available >= needed
      ? { ok: true, available, needed, message: "Estimated browser storage has the required headroom." }
      : { ok: false, available, needed, message: "Estimated browser storage is below the required amount." };
  } catch {
    return { ok: "unknown", available: null, needed, message: "Available browser storage could not be determined; capacity is unknown." };
  }
}

export async function requestPersistence(): Promise<"granted" | "denied" | "unsupported"> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage?.persist) return "unsupported";
  try {
    return (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

function canonicalManifest(value: ManifestWithoutHash): string {
  return JSON.stringify({
    ...(value.identityVersion === 2 ? {} : { meetingId: value.meetingId }),
    format: value.format,
    ...(value.identityVersion === 2 ? {} : { mimeType: value.mimeType }),
    totalSeconds: value.totalSeconds,
    sampleRate: value.sampleRate,
    totalBytes: value.totalBytes,
    ...(value.identityVersion === 2 ? {} : { createdAt: value.createdAt }),
    chunks: value.chunks.map((chunk) => ({
      index: chunk.index,
      byteLength: chunk.byteLength,
      sha256: chunk.sha256,
      ownStartSeconds: chunk.ownStartSeconds,
      ownDurationSeconds: chunk.ownDurationSeconds,
      leadInSeconds: chunk.leadInSeconds,
    })),
  });
}
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}
function stageLockName(stagingId: string): string {
  return `meeting-memo:long-audio-stage:${stagingId.slice(stagingPrefix.length)}`;
}
async function deleteStagingRows(stagingId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["audioChunks", "audioManifests"], "readwrite");
  await Promise.all([
    tx.objectStore("audioChunks").delete(IDBKeyRange.bound([stagingId, 0], [stagingId, Infinity])),
    tx.objectStore("audioManifests").delete(stagingId),
    tx.done,
  ]);
}

type LongAudioInput = {
  meetingId: string;
  format: "mp3" | "mp4";
  mimeType: string;
  totalSeconds: number;
  sampleRate: number;
  chunks: { meta: Omit<ChunkMeta, "sha256" | "byteLength">; read: () => Promise<Blob> }[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  replace?: boolean;
  expectedHash?: string;
  expectedMeetingVersion?: number;
};

export function storeLongAudio(input: LongAudioInput): Promise<LongAudioManifest> {
  return publishLongAudio(input, async (manifest) => manifest);
}

export function attachLongAudio(
  input: LongAudioInput,
  meeting: Meeting,
  audioFor: (manifest: LongAudioManifest) => NonNullable<Meeting["audio"]>,
): Promise<Meeting> {
  const write = publishLongAudio({
    ...input, meetingId: meeting.id, replace: true, expectedHash: meeting.audio?.hash, expectedMeetingVersion: meeting.version,
  }, async (manifest, putMeeting) => {
    const updated = nextMeetingVersion({ ...meeting, audio: audioFor(manifest) });
    await putMeeting(updated);
    return updated;
  });
  return trackMeetingWrite(meeting.id, write);
}

type FinishPublication<T> = (manifest: LongAudioManifest, putMeeting: (meeting: Meeting) => Promise<string>) => Promise<T>;

function publishLongAudio<T>(input: LongAudioInput, finish: FinishPublication<T>): Promise<T> {
  const stagingId = `${stagingPrefix}${crypto.randomUUID()}`;
  const locks = globalThis.navigator?.locks;
  const publish = () => stageAndPublishLongAudio(input, finish, stagingId, Boolean(locks));
  return locks ? locks.request(stageLockName(stagingId), { mode: "exclusive" }, publish) : publish();
}

async function stageAndPublishLongAudio<T>(
  input: LongAudioInput,
  finish: FinishPublication<T>,
  stagingId: string,
  usesWebLock: boolean,
): Promise<T> {
  const database = await db();
  const existing = await database.get("audioManifests", input.meetingId);
  if (existing !== undefined && !input.replace) throw new Error("Long audio already exists for this meeting; pass replace: true to replace it.");
  const previous = existing === undefined ? undefined : parseStoredManifest(existing, input.meetingId);
  if (previous) await verifyManifestIdentity(previous);
  // Stage under a unique namespace. Only the final transaction touches live rows.
  try {
    const chunks: ChunkMeta[] = [];
    let totalBytes = 0;
    for (let position = 0; position < input.chunks.length; position += 1) {
      abortIfRequested(input.signal);
      const source = input.chunks[position];
      if (source.meta.index !== position) throw new LongAudioIntegrityError("Recording chunk order is invalid.");
      const blob = await source.read();
      abortIfRequested(input.signal);
      if (blob.size > 24 * MiB) throw new Error("Each long-audio chunk must be 24 MiB or smaller.");
      const bytes = await blob.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength !== blob.size) throw new LongAudioIntegrityError("Recording chunk is incomplete.");
      const meta: ChunkMeta = {
        ...source.meta,
        index: source.meta.index,
        byteLength: bytes.byteLength,
        sha256: await sha256(bytes),
      };
      const stage = database.transaction(["audioChunks", "audioManifests"], "readwrite");
      await Promise.all([
        stage.objectStore("audioChunks").put(bytes, [stagingId, meta.index]),
        // A staging-only owner key also protects these rows from older startup cleanup.
        stage.objectStore("audioManifests").put({ updatedAt: Date.now(), usesWebLock }, stagingId),
        stage.done,
      ]);
      chunks.push(meta);
      totalBytes += bytes.byteLength;
      input.onProgress?.(position + 1, input.chunks.length);
    }
    abortIfRequested(input.signal);
    if (!chunks.length) throw new LongAudioIntegrityError("Recording has no chunks.");
    const unsigned: ManifestWithoutHash = {
      meetingId: input.meetingId,
      identityVersion: 2,
      format: input.format,
      mimeType: input.mimeType,
      totalSeconds: input.totalSeconds,
      sampleRate: input.sampleRate,
      totalBytes,
      createdAt: new Date().toISOString(),
      chunks,
    };
    const hash = await contentIdentity(unsigned);
    if (previous && await contentIdentity(previous) !== hash) throw new LongAudioIntegrityError(identityError);
    // Keep the live legacy hash referenced by existing speech and voice checkpoints.
    const manifest = previous ?? parseStoredManifest({ ...unsigned, manifestSha256: hash }, input.meetingId);
    if (input.expectedHash !== undefined && manifest.manifestSha256 !== input.expectedHash)
      throw new LongAudioIntegrityError(identityError);

    // Web Crypto can outlive an IndexedDB transaction. Verify each private staged
    // row before opening the publish transaction, then check again for missing rows at publication.
    for (const chunk of chunks) {
      abortIfRequested(input.signal);
      const bytes = await database.get("audioChunks", [stagingId, chunk.index]);
      if (!bytes || bytes.byteLength !== chunk.byteLength || await sha256(bytes) !== chunk.sha256)
        throw new LongAudioIntegrityError(incompleteStage);
    }
    const tx = database.transaction(["audioChunks", "audioManifests", "meetings"], "readwrite");
    const abortTransaction = () => {
      try { tx.abort(); } catch { /* The transaction may already be finished. */ }
    };
    input.signal?.addEventListener("abort", abortTransaction, { once: true });
    try {
      abortIfRequested(input.signal);
      const latest = await tx.objectStore("audioManifests").get(input.meetingId);
      if (JSON.stringify(latest) !== JSON.stringify(existing)) throw new Error("Another import changed this recording. Existing data was retained.");
      const meeting = await tx.objectStore("meetings").get(input.meetingId);
      if (input.expectedMeetingVersion !== undefined && meeting?.version !== input.expectedMeetingVersion)
        throw new Error("Another tab changed this meeting. Reload before attaching the recording.");
      if (meeting?.audio && (!meeting.audio.chunked || meeting.audio.hash !== manifest.manifestSha256 ||
        meeting.audio.chunked.manifestSha256 !== manifest.manifestSha256)) throw new LongAudioIntegrityError(identityError);
      const rows = tx.objectStore("audioChunks");
      if (!previous && !meeting?.audio && input.expectedHash === undefined &&
        await rows.count(IDBKeyRange.bound([input.meetingId, 0], [input.meetingId, Infinity])))
        throw new LongAudioIntegrityError(identityError);
      for (const chunk of chunks) {
        abortIfRequested(input.signal);
        const bytes = await rows.get([stagingId, chunk.index]);
        if (!bytes || bytes.byteLength !== chunk.byteLength) throw new LongAudioIntegrityError(incompleteStage);
        await rows.put(bytes, [input.meetingId, chunk.index]);
        await rows.delete([stagingId, chunk.index]);
      }
      await tx.objectStore("audioManifests").put(manifest, input.meetingId);
      await tx.objectStore("audioManifests").delete(stagingId);
      const result = await finish(manifest, updated => tx.objectStore("meetings").put(updated));
      abortIfRequested(input.signal);
      await tx.done;
      return result;
    } catch (error) {
      abortTransaction();
      await tx.done.catch(() => undefined);
      abortIfRequested(input.signal);
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", abortTransaction);
    }
  } catch (error) {
    if (isQuotaError(error)) throw new LongAudioQuotaError();
    throw error;
  } finally {
    try { await deleteStagingRows(stagingId); } catch { /* Startup cleanup can reclaim orphaned staging rows. */ }
  }
}

/** Content identity excludes the import's ownership, timestamp and MIME alias. */
export async function contentIdentity(value: ManifestWithoutHash): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalManifest({ ...value, identityVersion: 2 })).buffer as ArrayBuffer);
}
export async function verifyManifestIdentity(manifest: LongAudioManifest): Promise<void> {
  if (await sha256(new TextEncoder().encode(canonicalManifest(manifest)).buffer as ArrayBuffer) !== manifest.manifestSha256)
    throw new LongAudioIntegrityError("Long-audio manifest failed integrity verification.");
}

function parseStoredManifest(value: unknown, meetingId: string): LongAudioManifest {
  const result = ManifestSchema.safeParse(value);
  if (!result.success || result.data.meetingId !== meetingId) throw new LongAudioIntegrityError("Stored long-audio manifest is malformed.");
  return result.data;
}

export async function getLongAudioManifest(meetingId: string): Promise<LongAudioManifest | undefined> {
  const value = await (await db()).get("audioManifests", meetingId);
  return value === undefined ? undefined : parseStoredManifest(value, meetingId);
}

export async function getLongAudioChunk(meetingId: string, index: number, options: { verify?: boolean } = {}): Promise<Blob> {
  const manifest = await getLongAudioManifest(meetingId);
  if (!manifest) throw new LongAudioIntegrityError("Long-audio manifest is missing.");
  const meta = manifest.chunks.find((chunk) => chunk.index === index);
  if (!meta) throw new LongAudioIntegrityError(`Chunk ${index} is missing from the manifest.`);
  const bytes = await (await db()).get("audioChunks", [meetingId, index]);
  if (!bytes) throw new LongAudioIntegrityError(`Chunk ${index} is missing from storage.`);
  if (options.verify !== false && (bytes.byteLength !== meta.byteLength || await sha256(bytes) !== meta.sha256)) {
    throw new LongAudioIntegrityError(`Chunk ${index} failed integrity verification.`);
  }
  return new Blob([bytes], { type: manifest.mimeType });
}

export async function verifyLongAudio(meetingId: string, options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<void> {
  const manifest = await getLongAudioManifest(meetingId);
  if (!manifest) throw new LongAudioIntegrityError("Long-audio manifest is missing.");
  const { manifestSha256, ...unsigned } = manifest;
  if (await sha256(new TextEncoder().encode(canonicalManifest(unsigned)).buffer as ArrayBuffer) !== manifestSha256) {
    throw new LongAudioIntegrityError("Long-audio manifest failed integrity verification.");
  }
  for (let position = 0; position < manifest.chunks.length; position += 1) {
    abortIfRequested(options.signal);
    await getLongAudioChunk(meetingId, manifest.chunks[position].index);
    options.onProgress?.(position + 1, manifest.chunks.length);
  }
}

export async function deleteLongAudio(meetingId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["audioChunks", "audioManifests"], "readwrite");
  await Promise.all([
    tx.objectStore("audioChunks").delete(IDBKeyRange.bound([meetingId, 0], [meetingId, Infinity])),
    tx.objectStore("audioManifests").delete(meetingId),
  ]);
  await tx.done;
  // A recording replacement invalidates local acoustic evidence and paged
  // source state. The meeting itself remains available for a new recording.
  await deleteAcousticFeatures(meetingId);
}

export async function cleanupIncompleteLongAudio(): Promise<number> {
  const database = await db();
  const tx = database.transaction(["audioChunks", "audioManifests", "meetings"], "readwrite");
  const chunks = tx.objectStore("audioChunks");
  const manifestIds = await tx.objectStore("audioManifests").getAllKeys();
  const stagingIds = new Set(manifestIds.filter(id => id.startsWith(stagingPrefix)));
  const retainedIds = new Set([
    ...manifestIds,
    ...await tx.objectStore("meetings").getAllKeys(),
  ]);
  let removed = 0;
  let cursor = await chunks.openKeyCursor();
  while (cursor) {
    const key = cursor.key as [string, number];
    if (!retainedIds.has(key[0])) {
      if (key[0].startsWith(stagingPrefix)) {
        stagingIds.add(key[0]);
      } else {
        await chunks.delete(key);
        removed += 1;
      }
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  // Await cross-tab locks outside the cursor transaction. Each acquired lock
  // protects the lease check and deletion together with the staging writes.
  const locks = globalThis.navigator?.locks;
  for (const stagingId of stagingIds) {
    removed += locks
      ? await locks.request(stageLockName(stagingId), { ifAvailable: true }, lock => lock ? cleanupAbandonedStage(stagingId, true) : 0)
      : await cleanupAbandonedStage(stagingId, false);
  }
  return removed;
}

async function cleanupAbandonedStage(stagingId: string, holdsWebLock: boolean): Promise<number> {
  const database = await db();
  const tx = database.transaction(["audioChunks", "audioManifests", "meetings"], "readwrite");
  const manifests = tx.objectStore("audioManifests");
  const stored = await manifests.get(stagingId);
  const lease = StagingLeaseSchema.safeParse(stored);
  const chunks = tx.objectStore("audioChunks");
  const range = IDBKeyRange.bound([stagingId, 0], [stagingId, Infinity]);
  let removed = 0;
  if (!await tx.objectStore("meetings").getKey(stagingId)) {
    if (stored === undefined && await chunks.count(range)) {
      await manifests.put({ updatedAt: Date.now(), usesWebLock: false }, stagingId);
    } else if (lease.success && ((holdsWebLock && lease.data.usesWebLock) || lease.data.updatedAt <= Date.now() - stagingLeaseMs)) {
      removed = await chunks.count(range);
      await chunks.delete(range);
      await manifests.delete(stagingId);
    }
  }
  await tx.done;
  return removed;
}
