import { openDB, type DBSchema } from "idb";
interface AvatarDB extends DBSchema { avatars: { key: [string, string]; value: string } }
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("meeting-memo-speaker-avatars-v1") : undefined;
channel?.addEventListener("message", (event) => { if (typeof event.data === "string") window.dispatchEvent(new CustomEvent("meeting-memo-avatars-changed", { detail: event.data })); });
const database = () => openDB<AvatarDB>("meeting-memo-speaker-avatars-v1", 1, {
  upgrade(db) { db.createObjectStore("avatars"); },
});
const pendingWrites = new Set<Promise<unknown>>();
export function trackAvatarWrite<T>(write: Promise<T>): Promise<T> {
  pendingWrites.add(write);
  void write.then(() => pendingWrites.delete(write), () => pendingWrites.delete(write));
  return write;
}
export const avatarWritesPending = () => pendingWrites.size > 0;
export async function flushAvatarWrites() { while (pendingWrites.size) await Promise.all([...pendingWrites]); }
export function validAvatar(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}
export async function getSpeakerAvatars(meetingId: string): Promise<Record<string, string>> {
  const db = await database();
  try {
    const entries: Record<string, string> = Object.create(null) as Record<string, string>;
    const range = IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"]);
    let cursor = await db.transaction("avatars").store.openCursor(range);
    while (cursor) { if (validAvatar(cursor.value)) entries[cursor.key[1]] = cursor.value; cursor = await cursor.continue(); }
    return entries;
  } finally { db.close(); }
}
export async function setSpeakerAvatar(meetingId: string, speakerId: string, value: string | null) {
  if (value !== null && !validAvatar(value)) throw new Error("Avatar image is invalid or too large.");
  const db = await database();
  try { if (value === null) await db.delete("avatars", [meetingId, speakerId]); else await db.put("avatars", value, [meetingId, speakerId]); }
  finally { db.close(); }
  window.dispatchEvent(new CustomEvent("meeting-memo-avatars-changed", { detail: meetingId }));
  channel?.postMessage(meetingId);
}
export async function restoreSpeakerAvatars(meetingId: string, avatars: Record<string, string>) {
  if (Object.values(avatars).some((image) => !validAvatar(image))) throw new Error("Backup speaker avatars are invalid.");
  const db = await database();
  try {
    const tx = db.transaction("avatars", "readwrite");
    for (const [speakerId, image] of Object.entries(avatars)) await tx.store.put(image, [meetingId, speakerId]);
    await tx.done;
  } finally { db.close(); }
  window.dispatchEvent(new CustomEvent("meeting-memo-avatars-changed", { detail: meetingId }));
  channel?.postMessage(meetingId);
}
export async function removeMeetingAvatars(meetingId: string) {
  const db = await database();
  try { await db.delete("avatars", IDBKeyRange.bound([meetingId, ""], [meetingId, "\uffff"])); } finally { db.close(); }
}
/** Decode and resize before saving; untrusted SVG is never accepted. */
export async function prepareAvatar(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5_000_000) throw new Error("Choose a JPEG, PNG, or WebP image under 5 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error("Image dimensions are too large.");
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Image editing is unavailable in this browser.");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const result = canvas.toDataURL("image/jpeg", .78);
    if (!validAvatar(result)) throw new Error("The resized image is too large.");
    return result;
  } finally { bitmap.close(); }
}
