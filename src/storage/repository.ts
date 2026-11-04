import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { validateMeeting, type Meeting } from "../domain/model";
interface Store extends DBSchema {
  meetings: { key: string; value: Meeting };
  audio: { key: string; value: Blob };
}
let pending: Promise<IDBPDatabase<Store>> | undefined;
function db() {
  pending ??= openDB<Store>("meeting-memo-byok-v1", 1, {
    upgrade(d) {
      d.createObjectStore("meetings", { keyPath: "id" });
      d.createObjectStore("audio");
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
export async function saveMeeting(
  m: Meeting,
  audio?: Blob | null,
): Promise<Meeting> {
  const value = validateMeeting({
    ...m,
    version: m.version + 1,
    updatedAt: new Date().toISOString(),
  });
  const tx = (await db()).transaction(["meetings", "audio"], "readwrite");
  const previous = await tx.objectStore("meetings").get(m.id);
  if ((previous?.version ?? 0) !== m.version) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new ConflictError();
  }
  await tx.objectStore("meetings").put(value);
  if (audio === null) await tx.objectStore("audio").delete(m.id);
  else if (audio !== undefined) await tx.objectStore("audio").put(audio, m.id);
  await tx.done;
  channel?.postMessage(m.id);
  return value;
}
export async function getAudio(id: string) {
  return (await db()).get("audio", id);
}
export async function deleteMeeting(id: string) {
  const tx = (await db()).transaction(["meetings", "audio"], "readwrite");
  await Promise.all([
    tx.objectStore("meetings").delete(id),
    tx.objectStore("audio").delete(id),
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
