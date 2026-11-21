import { removeMeetingAvatars, trackAvatarWrite } from "./speaker-avatars";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { validateMeeting, type Meeting } from "../domain/model";
import type { ChunkSpeech } from "./chunk-speech-store";
interface Store extends DBSchema {
  meetings: { key: string; value: Meeting };
  audio: { key: string; value: { bytes: ArrayBuffer; type: string } | Blob };
  audioChunks: { key: [string, number]; value: ArrayBuffer };
  audioManifests: { key: string; value: unknown };
  chunkSpeech: { key: [string, number]; value: unknown };
  acousticEmbeddings: { key: [string, string]; value: unknown };
  acousticIdentities: { key: [string, string]; value: unknown };
  acousticAssignments: { key: [string, string]; value: unknown };
  acousticCheckpoints: { key: string; value: unknown };
  transcriptPages: { key: [string, string, number]; value: unknown };
  chunkAttempts: { key: [string, string, number]; value: unknown };
}
let pending: Promise<IDBPDatabase<Store>> | undefined;
export function db() {
  pending ??= openDB<Store>("meeting-memo-byok-v1", 4, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("meetings", { keyPath: "id" });
        d.createObjectStore("audio");
      }
      if (oldVersion < 2) {
        d.createObjectStore("audioChunks");
        d.createObjectStore("audioManifests");
      }
      if (oldVersion < 3) d.createObjectStore("chunkSpeech");
      if (oldVersion < 4) {
        d.createObjectStore("acousticEmbeddings");
        d.createObjectStore("acousticIdentities");
        d.createObjectStore("acousticAssignments");
        d.createObjectStore("acousticCheckpoints");
        d.createObjectStore("transcriptPages");
        d.createObjectStore("chunkAttempts");
      }
    },
    blocked() {
      window.dispatchEvent(new Event("memo-storage-blocked"));
    },
    blocking() {
      void pending?.then((d) => d.close());
      pending = undefined;
    },
  });
  return pending;
}
export class ConflictError extends Error {
  constructor() {
    super(
      "This meeting changed in another tab. Reload it before saving; your unsaved text is still in this page.",
    );
  }
}
export async function listMeetings() {
  return (await (await db()).getAll("meetings"))
    .map(validateMeeting)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getMeeting(id: string) {
  const m = await (await db()).get("meetings", id);
  return m ? validateMeeting(m) : undefined;
}
const writes = new Set<Promise<Meeting>>();
const failedMeetings = new Set<string>();
type RestoredChunkSpeech = { recordingHash: string; chunks: { index: number; speech: ChunkSpeech }[] };
const pendingChunkSpeech = new WeakMap<Meeting, RestoredChunkSpeech & { meetingId: string; chunkCount: number }>();

/** Hold validated rows until the existing restore confirmation saves this copy. */
export function prepareRestoredChunkSpeech(m: Meeting, checkpoint: RestoredChunkSpeech): void {
  const chunkCount = m.audio?.chunked?.chunkCount;
  if (m.version !== 0 || chunkCount === undefined || m.audio?.hash !== checkpoint.recordingHash) {
    throw new Error("Restored chunk speech does not match the meeting's recording identity.");
  }
  pendingChunkSpeech.set(m, { ...checkpoint, meetingId: m.id, chunkCount });
}

export function saveMeeting(m: Meeting, audio?: Blob | null, receiptWrite = false): Promise<Meeting> {
  return trackMeetingWrite(m.id, writeMeeting(m, audio).catch(error => {
    // Receipt recovery owns its update guard through local save or export acknowledgement.
    if (!receiptWrite) failedMeetings.add(m.id);
    throw error;
  }), receiptWrite);
}
export function trackMeetingWrite(id: string, pendingWrite: Promise<Meeting>, receiptWrite = false): Promise<Meeting> {
  const write = pendingWrite.then(saved => {
    channel?.postMessage(id);
    if (!receiptWrite) failedMeetings.delete(id);
    return saved;
  });
  writes.add(write);
  const settled = () => writes.delete(write);
  void write.then(settled, settled);
  return write;
}
export async function flushWrites(onFlushed?: () => void) {
  while (writes.size) await Promise.all([...writes]);
  if (failedMeetings.size)
    throw new Error(
      "Resolve the local save error before updating. Your unsaved changes are still in this page.",
    );
  // Run the final update action without yielding after the write check.
  onFlushed?.();
}
export async function clearDeletedMeetingWriteFailure(id: string) {
  if (failedMeetings.has(id) && (await (await db()).getKey("meetings", id)) === undefined)
    failedMeetings.delete(id);
}
export function nextMeetingVersion(m: Meeting): Meeting {
  return validateMeeting({
    ...m,
    version: m.version + 1,
    updatedAt: new Date().toISOString(),
  });
}
async function writeMeeting(m: Meeting, audio?: Blob | null): Promise<Meeting> {
  const value = nextMeetingVersion(m);
  const checkpoint = pendingChunkSpeech.get(m);
  const encoded = audio
    ? { bytes: await audio.arrayBuffer(), type: audio.type }
    : undefined;
  if (checkpoint && (m.version !== 0 || value.id !== checkpoint.meetingId || value.audio?.hash !== checkpoint.recordingHash ||
      value.audio?.chunked?.chunkCount !== checkpoint.chunkCount || value.audio.present || encoded !== undefined)) {
    throw new Error("Restored chunk speech does not match the meeting's recording identity.");
  }
  const tx = (await db()).transaction(
    ["meetings", "audio", "acousticEmbeddings", "acousticIdentities", "acousticAssignments", "acousticCheckpoints",
      ...(checkpoint ? ["chunkSpeech"] as const : [])],
    "readwrite",
  );
  const previous = await tx.objectStore("meetings").get(m.id);
  if ((previous?.version ?? 0) !== m.version || (checkpoint && previous)) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new ConflictError();
  }
  try {
    if (checkpoint) {
      const speech = tx.objectStore("chunkSpeech");
      for (const chunk of checkpoint.chunks) await speech.add(chunk.speech, [value.id, chunk.index]);
    }
    await tx.objectStore("meetings").put(value);
    if (audio === null) await tx.objectStore("audio").delete(m.id);
    else if (encoded !== undefined)
      await tx.objectStore("audio").put(encoded, m.id);
    const previousAudioHash = previous?.audio?.hash;
    const nextAudioHash = value.audio?.hash;
    if (previousAudioHash !== undefined && previousAudioHash !== nextAudioHash) {
      // Recording replacement invalidates only derived acoustic state. Historical
      // provider pages/attempts remain immutable and are retained for citation.
      await Promise.all([
        tx.objectStore("acousticEmbeddings").delete(IDBKeyRange.bound([m.id, ""], [m.id, "\uffff"])),
        tx.objectStore("acousticIdentities").delete(IDBKeyRange.bound([m.id, ""], [m.id, "\uffff"])),
        tx.objectStore("acousticAssignments").delete(IDBKeyRange.bound([m.id, ""], [m.id, "\uffff"])),
        tx.objectStore("acousticCheckpoints").delete(m.id),
      ]);
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* A failed request may already have aborted the transaction. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
  // trackMeetingWrite broadcasts the change after the write settles.
  if (checkpoint) pendingChunkSpeech.delete(m);
  return value;
}
export async function getAudio(id: string) {
  const stored = await (await db()).get("audio", id);
  return !stored
    ? undefined
    : stored instanceof Blob
      ? stored
      : new Blob([stored.bytes], { type: stored.type });
}
export async function deleteMeeting(id: string) {
  const database = await db();
  const tx = database.transaction(
    [
      "meetings",
      "audio",
      "audioChunks",
      "audioManifests",
      "chunkSpeech",
      "acousticEmbeddings",
      "acousticIdentities",
      "acousticAssignments",
      "acousticCheckpoints",
      "transcriptPages",
      "chunkAttempts",
    ],
    "readwrite",
  );
  const chunkRange = IDBKeyRange.bound([id, 0], [id, Infinity]);
  await Promise.all([
    tx.objectStore("meetings").delete(id),
    tx.objectStore("audio").delete(id),
    tx.objectStore("audioChunks").delete(chunkRange),
    tx.objectStore("audioManifests").delete(id),
    tx.objectStore("chunkSpeech").delete(IDBKeyRange.bound([id, 0], [id, Infinity])),
    tx.objectStore("acousticEmbeddings").delete(IDBKeyRange.bound([id, ""], [id, "\uffff"])),
    tx.objectStore("acousticIdentities").delete(IDBKeyRange.bound([id, ""], [id, "\uffff"])),
    tx.objectStore("acousticAssignments").delete(IDBKeyRange.bound([id, ""], [id, "\uffff"])),
    tx.objectStore("acousticCheckpoints").delete(id),
    tx.objectStore("transcriptPages").delete(IDBKeyRange.bound([id, "", 0], [id, "\uffff", Infinity])),
    tx.objectStore("chunkAttempts").delete(IDBKeyRange.bound([id, "", 0], [id, "\uffff", Infinity])),
  ]);
  await tx.done;
  channel?.postMessage(id);
  try { await trackAvatarWrite(removeMeetingAvatars(id)); }
  catch { throw new Error("The meeting was deleted, but its profile images could not be removed from local storage."); }
}
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("meeting-memo-byok-changes")
    : null;
channel?.addEventListener("message", () =>
  window.dispatchEvent(new Event("memo-storage-changed")),
);
export async function recoverJobs(m: Meeting): Promise<Meeting> {
  if (!m.jobs.some((j) => j.state === "in_flight")) return m;
  return saveMeeting({
    ...m,
    memoPipelines: m.memoPipelines?.map(p => ({...p,state: m.jobs.some(j=>j.pipelineId===p.id && j.state==="in_flight") ? "blocked" as const : p.state})),
    memoAgents: m.memoAgents?.map(p => ({...p,state:m.jobs.some(j=>j.agentId===p.id && j.state==="in_flight") ? "blocked" as const : p.state})),
    jobs: m.jobs.map((j) =>
      j.state === "in_flight"
        ? {
            ...j,
            state: "outcome_unknown",
            billing: "possibly_charged",
            message:
              "The page closed before completion was saved. Review the provider account before retrying.",
          }
        : j,
    ),
  });
}
