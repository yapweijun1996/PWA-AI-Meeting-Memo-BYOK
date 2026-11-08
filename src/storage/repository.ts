import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { validateMeeting, type Meeting } from "../domain/model";
interface Store extends DBSchema {
  meetings: { key: string; value: Meeting };
  audio: { key: string; value: { bytes: ArrayBuffer; type: string } | Blob };
  audioChunks: { key: [string, number]; value: ArrayBuffer };
  audioManifests: { key: string; value: unknown };
  chunkSpeech: { key: [string, number]; value: unknown };
}
let pending: Promise<IDBPDatabase<Store>> | undefined;
export function db() {
  pending ??= openDB<Store>("meeting-memo-byok-v1", 3, {
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
export function saveMeeting(m: Meeting, audio?: Blob | null): Promise<Meeting> {
  const write = writeMeeting(m, audio);
  writes.add(write);
  void write.then(
    () => {
      writes.delete(write);
      failedMeetings.delete(m.id);
    },
    () => {
      writes.delete(write);
      failedMeetings.add(m.id);
    },
  );
  return write;
}
export async function flushWrites() {
  await Promise.all([...writes]);
  if (failedMeetings.size)
    throw new Error(
      "Resolve the local save error before updating. Your unsaved changes are still in this page.",
    );
}
async function writeMeeting(m: Meeting, audio?: Blob | null): Promise<Meeting> {
  const value = validateMeeting({
    ...m,
    version: m.version + 1,
    updatedAt: new Date().toISOString(),
  });
  const encoded = audio
    ? { bytes: await audio.arrayBuffer(), type: audio.type }
    : undefined;
  const tx = (await db()).transaction(["meetings", "audio"], "readwrite");
  const previous = await tx.objectStore("meetings").get(m.id);
  if ((previous?.version ?? 0) !== m.version) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new ConflictError();
  }
  await tx.objectStore("meetings").put(value);
  if (audio === null) await tx.objectStore("audio").delete(m.id);
  else if (encoded !== undefined)
    await tx.objectStore("audio").put(encoded, m.id);
  await tx.done;
  channel?.postMessage(m.id);
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
    ["meetings", "audio", "audioChunks", "audioManifests", "chunkSpeech"],
    "readwrite",
  );
  const chunkRange = IDBKeyRange.bound([id, 0], [id, Infinity]);
  await Promise.all([
    tx.objectStore("meetings").delete(id),
    tx.objectStore("audio").delete(id),
    tx.objectStore("audioChunks").delete(chunkRange),
    tx.objectStore("audioManifests").delete(id),
    tx.objectStore("chunkSpeech").delete(IDBKeyRange.bound([id, 0], [id, Infinity])),
  ]);
  await tx.done;
  channel?.postMessage(id);
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
