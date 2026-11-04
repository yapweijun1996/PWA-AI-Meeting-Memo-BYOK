import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateMeeting, type Meeting, id } from "../domain/model";
import { getAudio } from "./repository";
const MAX_BACKUP = 120 * 1024 * 1024;
export async function backupMeeting(m: Meeting): Promise<Blob> {
  const audio = await getAudio(m.id);
  const document = {
    ...m,
    audio: m.audio ? { ...m.audio, present: !!audio } : null,
  };
  const files: Record<string, Uint8Array> = {
    "meeting.json": strToU8(JSON.stringify(document)),
  };
  if (audio) files["recording.bin"] = new Uint8Array(await audio.arrayBuffer());
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
    type: "application/zip",
  });
}
export async function readBackup(
  file: File,
): Promise<{ meeting: Meeting; audio?: Blob }> {
  if (file.size > MAX_BACKUP)
    throw new Error("Backup exceeds the 120 MB import limit.");
  let value: unknown, audio: Blob | undefined;
  if (file.name.toLowerCase().endsWith(".zip")) {
    let total = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(info) {
        if (!["meeting.json", "recording.bin"].includes(info.name))
          throw new Error("Unexpected backup entry.");
        total += info.originalSize;
        if (
          total > MAX_BACKUP ||
          (info.name === "meeting.json" && info.originalSize > 12 * 1024 * 1024)
        )
          throw new Error("Expanded backup is too large.");
        return true;
      },
    });
    if (!files["meeting.json"]) throw new Error("Backup has no meeting.json.");
    value = JSON.parse(strFromU8(files["meeting.json"]));
    const checked = validateMeeting(value);
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
      jobs: m.jobs.map((j) =>
        j.state === "in_flight"
          ? { ...j, state: "outcome_unknown", billing: "possibly_charged" }
          : j,
      ),
    },
    audio,
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
