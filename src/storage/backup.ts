import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { z } from "zod";
import { agentContextOrderWarning, validateMeeting, MAX_JOBS, MAX_MEETING_JSON_BYTES, SegmentSchema, SpeakerSchema, type Meeting, id } from "../domain/model";
import { getAudio, prepareRestoredChunkSpeech } from "./repository";
import { getChunkSpeech } from "./chunk-speech-store";
import { contentIdentity, getLongAudioManifest, verifyManifestIdentity } from "./long-audio-store";
import { getSpeakerAvatars, validAvatar, flushAvatarWrites } from "./speaker-avatars";
const MAX_BACKUP = 120 * 1024 * 1024;
const CHUNK_SPEECH_ENTRY = "chunk-speech.json";
const STANDARD_RECEIPT_RESERVE_BYTES = 64 * 1024;
const BACKUP_METADATA_BYTES = 4096;
const ChunkSpeechBackupSchema = z.strictObject({
  version: z.literal(1),
  meetingId: z.uuid(),
  recordingHash: z.string().regex(/^[a-f0-9]{64}$/),
  chunks: z.array(z.strictObject({
    index: z.number().int().nonnegative(),
    speech: z.strictObject({
      speakers: z.array(SpeakerSchema),
      segments: z.array(SegmentSchema),
      duration: z.number().nonnegative().nullable(),
      requestId: z.string().max(200).nullable(),
    }),
  })).min(1).max(MAX_JOBS),
});

function checkpointIndexes(m: Meeting): Set<number> {
  const chunkCount = m.audio?.chunked?.chunkCount;
  const indexes = new Set<number>();
  if (chunkCount === undefined) return indexes;
  for (const job of m.jobs) {
    if (job.stage === "speech" && job.chunk?.total === chunkCount && job.chunk.index < chunkCount &&
        (job.state === "completed" || job.state === "outcome_unknown" || job.state === "in_flight")) {
      indexes.add(job.chunk.index);
    }
  }
  return indexes;
}

async function prepareBackupDocument(m: Meeting, audioPresent: boolean): Promise<{ document: Meeting; checkpointHash?: string }> {
  const document: Meeting = {
    ...m,
    audio: m.audio ? { ...m.audio, present: audioPresent } : null,
  };
  const audio = m.audio;
  if (audio?.chunked) {
    try {
      const manifest = await getLongAudioManifest(m.id);
      // A restored copy can be backed up again before reattaching its audio.
      if (!manifest && !audio.present) return { document, checkpointHash: audio.hash };
      if (manifest && manifest.manifestSha256 === audio.hash) {
        await verifyManifestIdentity(manifest);
        const hash = await contentIdentity(manifest);
        const { chunked } = audio;
        if (manifest.format === chunked.format && manifest.chunks.length === chunked.chunkCount && manifest.totalSeconds === chunked.totalSeconds) {
          // The legacy and portable identities were verified above against the same manifest.
          document.audio = { ...audio, present: audioPresent, hash, chunked: { ...chunked, manifestSha256: hash },
            ...(audio.overlapEvidence && { overlapEvidence: { ...audio.overlapEvidence, audioSha256: hash } }) };
          return { document, checkpointHash: hash };
        }
      }
    } catch { /* Preserve the meeting backup when the local manifest is damaged. */ }
  }
  return { document };
}

export async function meetingBackupDocument(m: Meeting, audioPresent = false): Promise<Meeting> {
  return (await prepareBackupDocument(m, audioPresent)).document;
}

async function backupChunkSpeech(m: Meeting, recordingHash: string): Promise<Uint8Array | undefined> {
  const chunks = [];
  for (const index of checkpointIndexes(m)) {
    const speech = await getChunkSpeech(m.id, index);
    if (speech) chunks.push({ index, speech });
  }
  if (!chunks.length) return undefined;
  const data = strToU8(JSON.stringify({ version: 1, meetingId: m.id, recordingHash, chunks }));
  if (data.byteLength > MAX_MEETING_JSON_BYTES) throw new Error("Chunk speech exceeds the backup size limit.");
  return data;
}

function readChunkSpeech(bytes: Uint8Array, meeting: Meeting) {
  const parsed = ChunkSpeechBackupSchema.safeParse(JSON.parse(strFromU8(bytes)));
  if (!parsed.success) throw new Error("Backup chunk speech is invalid.");
  if (!meeting.audio?.chunked || parsed.data.meetingId !== meeting.id || parsed.data.recordingHash !== meeting.audio.hash) {
    throw new Error("Backup chunk speech does not match the meeting's recording identity.");
  }
  const indexes = checkpointIndexes(meeting);
  for (const chunk of parsed.data.chunks) {
    if (!indexes.delete(chunk.index)) {
      throw new Error("Backup chunk speech has a duplicate or unmatched chunk index.");
    }
  }
  return parsed.data;
}

async function backupInputs(m: Meeting) {
  const chunked = !!m.audio?.chunked;
  const audio = chunked ? undefined : await getAudio(m.id);
  return { audio, ...await prepareBackupDocument(m, !!audio) };
}

async function backupMembers(m: Meeting, { audio, document, checkpointHash }: Awaited<ReturnType<typeof backupInputs>>) {
  const files: Record<string, Uint8Array | Blob> = { "meeting.json": strToU8(JSON.stringify(document)) };
  if (checkpointHash) {
    const data = await backupChunkSpeech(m, checkpointHash);
    if (data) files[CHUNK_SPEECH_ENTRY] = data;
  }
  const avatars = await getSpeakerAvatars(m.id);
  if (Object.keys(avatars).length) {
    const data = strToU8(JSON.stringify(avatars));
    if (data.byteLength > 12 * 1024 * 1024) throw new Error("Speaker profile images exceed the backup size limit.");
    files["speaker-avatars.json"] = data;
  }
  if (audio) files["recording.bin"] = audio;
  return files;
}

function storedZipSize(files: Record<string, Uint8Array | Blob>): number {
  // fflate's level-0 ZIP uses local and central headers for each ASCII member name.
  return Object.entries(files).reduce((size, [name, member]) =>
    size + 30 + 46 + 2 * name.length + (member instanceof Blob ? member.size : member.byteLength), 22);
}

export async function checkMemoBackupBudget(meeting: Meeting, reserveReceipt = false): Promise<Meeting> {
  const reserve = BACKUP_METADATA_BYTES + (reserveReceipt ? STANDARD_RECEIPT_RESERVE_BYTES : 0);
  const refused = () => new Error(reserveReceipt
    ? "Insufficient meeting backup space for the next memo response. No request was sent."
    : "The response cannot fit in the portable meeting backup.");
  // JSON export is pretty printed, with audio deliberately absent.
  const inputs = await backupInputs(meeting);
  const document = { ...inputs.document, audio: inputs.document.audio ? { ...inputs.document.audio, present: false } : null };
  if (new Blob([JSON.stringify(document, null, 2)]).size + reserve > MAX_MEETING_JSON_BYTES)
    throw refused();
  const files = await backupMembers(meeting, inputs);
  if (storedZipSize(files) + reserve > MAX_BACKUP) throw refused();
  return meeting;
}

export async function backupMeeting(m: Meeting): Promise<Blob> {
  await flushAvatarWrites();
  const files = await backupMembers(m, await backupInputs(m));
  if (storedZipSize(files) > MAX_BACKUP) throw new Error("Backup exceeds the 120 MB import limit.");
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files))
    entries[name] = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value;
  const archive = new Uint8Array(zipSync(entries, { level: 0 }));
  if (archive.byteLength > MAX_BACKUP) throw new Error("Backup exceeds the 120 MB import limit.");
  return new Blob([archive], { type: "application/zip" });
}
export async function readBackup(
  file: File,
): Promise<{ meeting: Meeting; audio?: Blob; avatars?: Record<string, string>; warning?: string }> {
  if (file.size > MAX_BACKUP)
    throw new Error("Backup exceeds the 120 MB import limit.");
  let m: Meeting, audio: Blob | undefined, avatars: Record<string, string> | undefined;
  let chunkSpeech: ReturnType<typeof readChunkSpeech> | undefined;
  if (file.name.toLowerCase().endsWith(".zip")) {
    let total = 0;
    const entries = new Set<string>();
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(info) {
        if (!["meeting.json", "recording.bin", "speaker-avatars.json", CHUNK_SPEECH_ENTRY].includes(info.name) || entries.has(info.name))
          throw new Error("Unexpected backup entry.");
        entries.add(info.name);
        total += info.originalSize;
        if (
          total > MAX_BACKUP ||
          ((info.name === "meeting.json" || info.name === CHUNK_SPEECH_ENTRY) && info.originalSize > MAX_MEETING_JSON_BYTES) ||
          (info.name === "speaker-avatars.json" && info.originalSize > 12 * 1024 * 1024)
        )
          throw new Error("Expanded backup is too large.");
        return true;
      },
    });
    if (!files["meeting.json"]) throw new Error("Backup has no meeting.json.");
    m = validateMeeting(JSON.parse(strFromU8(files["meeting.json"])));
    if (files[CHUNK_SPEECH_ENTRY]) chunkSpeech = readChunkSpeech(files[CHUNK_SPEECH_ENTRY], m);
    if (files["speaker-avatars.json"]) {
      const parsed: unknown = JSON.parse(strFromU8(files["speaker-avatars.json"]));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).length > 1000 || Object.entries(parsed).some(([speakerId, image]) => !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|part-\d+:[A-Za-z0-9_-]+(?::\d+)?)$/i.test(speakerId) || !validAvatar(image))) throw new Error("Backup speaker avatars are invalid.");
      avatars = parsed as Record<string, string>;
    }
    if (files["recording.bin"]) {
      if (!m.audio) throw new Error("Recording metadata is missing.");
      if (chunkSpeech) throw new Error("Chunked recording audio cannot be restored from a backup.");
      const bytes = new Uint8Array(files["recording.bin"]);
      const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
      if (
        hash !== m.audio.hash ||
        bytes.byteLength !== m.audio.size
      )
        throw new Error("Recording checksum mismatch.");
      audio = new Blob([bytes], { type: m.audio.type });
    }
  } else {
    if (file.size > MAX_MEETING_JSON_BYTES)
      throw new Error("JSON backup exceeds 64 MB.");
    m = validateMeeting(JSON.parse(await file.text()));
  }
  const meeting: Meeting = {
    ...m,
    id: id(),
    version: 0,
    title: `${m.title.slice(0, 140)} (restored)`,
    audio: m.audio ? { ...m.audio, present: !!audio } : null,
    memoPipelines: m.memoPipelines?.map(p => ({...p,state: m.jobs.some(j=>j.pipelineId===p.id && j.state==="in_flight") ? "blocked" as const : p.state})),
    memoAgents: m.memoAgents?.map(p => ({...p,state:m.jobs.some(j=>j.agentId===p.id && j.state==="in_flight") ? "blocked" as const : p.state})),
    jobs: m.jobs.map((j) =>
      j.state === "in_flight"
        ? { ...j, state: "outcome_unknown", billing: "possibly_charged" }
        : j,
    ),
  };
  if (chunkSpeech) prepareRestoredChunkSpeech(meeting, chunkSpeech);
  const warning = meeting.memoAgents?.map(agentContextOrderWarning).find(Boolean);
  return { meeting, audio, avatars, ...(warning && { warning }) };
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
