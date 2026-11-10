import { z } from "zod";
import { db } from "./repository";
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
    meetingId: value.meetingId,
    format: value.format,
    mimeType: value.mimeType,
    totalSeconds: value.totalSeconds,
    sampleRate: value.sampleRate,
    totalBytes: value.totalBytes,
    createdAt: value.createdAt,
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
async function deleteChunkRows(meetingId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction("audioChunks", "readwrite");
  await tx.objectStore("audioChunks").delete(IDBKeyRange.bound([meetingId, 0], [meetingId, Infinity]));
  await tx.done;
}

export async function storeLongAudio(input: {
  meetingId: string;
  format: "mp3" | "mp4";
  mimeType: string;
  totalSeconds: number;
  sampleRate: number;
  chunks: { meta: Omit<ChunkMeta, "sha256" | "byteLength">; read: () => Promise<Blob> }[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  replace?: boolean;
}): Promise<LongAudioManifest> {
  const database = await db();
  const existing = await database.get("audioManifests", input.meetingId);
  if (existing !== undefined && !input.replace) throw new Error("Long audio already exists for this meeting; pass replace: true to replace it.");
  if (existing !== undefined) await deleteLongAudio(input.meetingId);
  try {
    const chunks: ChunkMeta[] = [];
    let totalBytes = 0;
    for (let position = 0; position < input.chunks.length; position += 1) {
      abortIfRequested(input.signal);
      const source = input.chunks[position];
      const blob = await source.read();
      abortIfRequested(input.signal);
      if (blob.size > 24 * MiB) throw new Error("Each long-audio chunk must be 24 MiB or smaller.");
      const bytes = await blob.arrayBuffer();
      const meta: ChunkMeta = {
        ...source.meta,
        index: source.meta.index,
        byteLength: bytes.byteLength,
        sha256: await sha256(bytes),
      };
      const tx = database.transaction("audioChunks", "readwrite");
      await tx.objectStore("audioChunks").put(bytes, [input.meetingId, meta.index]);
      await tx.done;
      chunks.push(meta);
      totalBytes += bytes.byteLength;
      input.onProgress?.(position + 1, input.chunks.length);
    }
    abortIfRequested(input.signal);
    const unsigned: ManifestWithoutHash = {
      meetingId: input.meetingId,
      format: input.format,
      mimeType: input.mimeType,
      totalSeconds: input.totalSeconds,
      sampleRate: input.sampleRate,
      totalBytes,
      createdAt: new Date().toISOString(),
      chunks,
    };
    const manifest: LongAudioManifest = { ...unsigned, manifestSha256: await sha256(new TextEncoder().encode(canonicalManifest(unsigned)).buffer as ArrayBuffer) };
    const tx = database.transaction("audioManifests", "readwrite");
    await tx.objectStore("audioManifests").put(manifest, input.meetingId);
    await tx.done;
    return manifest;
  } catch (error) {
    try { await deleteChunkRows(input.meetingId); } catch { /* best-effort rollback */ }
    if (isQuotaError(error)) throw new LongAudioQuotaError();
    throw error;
  }
}

export async function getLongAudioManifest(meetingId: string): Promise<LongAudioManifest | undefined> {
  const value = await (await db()).get("audioManifests", meetingId);
  if (value === undefined) return undefined;
  const result = ManifestSchema.safeParse(value);
  if (!result.success || result.data.meetingId !== meetingId) throw new LongAudioIntegrityError("Stored long-audio manifest is malformed.");
  return result.data;
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
  const tx = database.transaction(["audioChunks", "audioManifests"], "readwrite");
  const chunks = tx.objectStore("audioChunks");
  const manifestIds = new Set(await tx.objectStore("audioManifests").getAllKeys());
  let removed = 0;
  let cursor = await chunks.openCursor();
  while (cursor) {
    const key = cursor.key as [string, number];
    if (!manifestIds.has(key[0])) {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}
