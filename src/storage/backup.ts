import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateMeeting, type Meeting, id } from "../domain/model";
import { getAudio } from "./repository";
import { getSpeakerAvatars, validAvatar, flushAvatarWrites } from "./speaker-avatars";
const MAX_BACKUP = 120 * 1024 * 1024;
export async function backupMeeting(m: Meeting): Promise<Blob> {
  await flushAvatarWrites();
  const chunked = !!m.audio?.chunked;
  const audio = chunked ? undefined : await getAudio(m.id);
  const document = {
    ...m,
    audio: m.audio ? { ...m.audio, present: !!audio } : null,
  };
  const files: Record<string, Uint8Array> = {
    "meeting.json": strToU8(JSON.stringify(document)),
  };
  const avatars = await getSpeakerAvatars(m.id);
  if (Object.keys(avatars).length) {
    const data = strToU8(JSON.stringify(avatars));
    if (data.byteLength > 12 * 1024 * 1024) throw new Error("Speaker profile images exceed the backup size limit.");
    files["speaker-avatars.json"] = data;
  }
  if (audio) files["recording.bin"] = new Uint8Array(await audio.arrayBuffer());
  if (Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0) > MAX_BACKUP) throw new Error("Backup exceeds the 120 MB import limit.");
  const archive = new Uint8Array(zipSync(files, { level: 0 }));
  if (archive.byteLength > MAX_BACKUP) throw new Error("Backup exceeds the 120 MB import limit.");
  return new Blob([archive], { type: "application/zip" });
}
export async function readBackup(
  file: File,
): Promise<{ meeting: Meeting; audio?: Blob; avatars?: Record<string, string> }> {
  if (file.size > MAX_BACKUP)
    throw new Error("Backup exceeds the 120 MB import limit.");
  let value: unknown, audio: Blob | undefined, avatars: Record<string, string> | undefined;
  if (file.name.toLowerCase().endsWith(".zip")) {
    let total = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(info) {
        if (!["meeting.json", "recording.bin", "speaker-avatars.json"].includes(info.name))
          throw new Error("Unexpected backup entry.");
        total += info.originalSize;
        if (
          total > MAX_BACKUP ||
          ((info.name === "meeting.json" || info.name === "speaker-avatars.json") && info.originalSize > 12 * 1024 * 1024)
        )
          throw new Error("Expanded backup is too large.");
        return true;
      },
    });
    if (!files["meeting.json"]) throw new Error("Backup has no meeting.json.");
    value = JSON.parse(strFromU8(files["meeting.json"]));
    const checked = validateMeeting(value);
    if (files["speaker-avatars.json"]) {
      const parsed: unknown = JSON.parse(strFromU8(files["speaker-avatars.json"]));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).length > 1000 || Object.entries(parsed).some(([speakerId, image]) => !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|part-\d+:[A-Za-z0-9_-]+(?::\d+)?)$/i.test(speakerId) || !validAvatar(image))) throw new Error("Backup speaker avatars are invalid.");
      avatars = parsed as Record<string, string>;
    }
    if (files["recording.bin"]) {
      if (!checked.audio) throw new Error("Recording metadata is missing.");
      const bytes = new Uint8Array(files["recording.bin"]);
      const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
      if (
        hash !== checked.audio.hash ||
        bytes.byteLength !== checked.audio.size
      )
        throw new Error("Recording checksum mismatch.");
      audio = new Blob([bytes], { type: checked.audio.type });
    }
  } else {
    if (file.size > 12 * 1024 * 1024)
      throw new Error("JSON backup exceeds 12 MB.");
    value = JSON.parse(await file.text());
  }
  const m = validateMeeting(value);
  return {
    meeting: {
      ...m,
      id: id(),
      version: 0,
      title: `${m.title.slice(0, 140)} (restored)`,
      audio: m.audio ? { ...m.audio, present: !!audio } : null,
      memoPipelines: m.memoPipelines?.map(p => ({...p,state: m.jobs.some(j=>j.pipelineId===p.id && j.state==="in_flight") ? "blocked" as const : p.state})),
      jobs: m.jobs.map((j) =>
        j.state === "in_flight"
          ? { ...j, state: "outcome_unknown", billing: "possibly_charged" }
          : j,
      ),
    },
    audio,
    avatars,
  };
}
export const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const safeFilename = (name: string) =>
  name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100) || "meeting";
