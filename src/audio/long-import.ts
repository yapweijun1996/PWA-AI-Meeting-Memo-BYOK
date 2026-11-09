import type { Meeting } from "../domain/model";
import { planMp3Split, readMp3Chunk } from "./mp3-split";
import { planMp4Split, readMp4Chunk } from "./mp4-split";
import {
  checkCapacity,
  requestPersistence,
  storeLongAudio,
} from "../storage/long-audio-store";

const SINGLE_REQUEST_LIMIT = 24_000_000;
const MAX_LONG_AUDIO = 4 * 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES = 20_000_000;
// Make each part as long as the byte cap allows. Every part is transcribed on its own and numbers its speakers
// from scratch, so more parts means more duplicate speakers for the same people.
const TARGET_PART_SECONDS = 3600;

type ImportProgress = {
  phase: "planning" | "checking-space" | "storing";
  done: number;
  total: number;
};

type LongImportOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  targetSeconds?: number;
  minLeadInSeconds?: number;
  replace?: boolean;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
};

export function isLongRecordingCandidate(file: File): boolean {
  return file.size > SINGLE_REQUEST_LIMIT;
}

export async function importLongRecording(
  file: File,
  meetingId: string,
  opts: LongImportOptions = {},
): Promise<{
  audio: NonNullable<Meeting["audio"]>;
  warnings: string[];
  persistence: "granted" | "denied" | "unsupported" | "skipped";
}> {
  if (file.size > MAX_LONG_AUDIO) throw new Error("Long recordings must be 4 GiB or smaller.");
  const extension = file.name.toLowerCase().split(".").pop();
  const mime = file.type.toLowerCase().split(";")[0]?.trim();
  const format = extension === "mp3" || extension === "mpeg" || extension === "mpga" ||
    mime === "audio/mpeg" || mime === "audio/mp3" || mime === "audio/mpga"
    ? "mp3"
    : extension === "m4a" || extension === "mp4" ||
        mime === "audio/mp4" || mime === "audio/x-m4a"
      ? "mp4"
      : undefined;
  if (format === undefined)
    throw new Error("Convert this recording to MP3 or M4A before importing a file this large; the browser cannot re-encode it.");

  opts.onProgress?.({ phase: "planning", done: 0, total: 0 });
  const splitOptions = {
    targetSeconds: opts.targetSeconds ?? TARGET_PART_SECONDS,
    maxBytes: MAX_CHUNK_BYTES,
    minLeadInSeconds: opts.minLeadInSeconds ?? 10,
  };
  const mp3Plan = format === "mp3" ? await planMp3Split(file, { ...splitOptions, signal: opts.signal }) : undefined;
  const mp4Plan = format === "mp4" ? await planMp4Split(file, splitOptions) : undefined;
  const plan = mp3Plan ?? mp4Plan;
  if (plan === undefined) throw new Error("Unable to plan the recording.");
  if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

  opts.onProgress?.({ phase: "checking-space", done: 0, total: file.size });
  const capacity = await checkCapacity(file.size, opts.estimate);
  if (capacity.ok === false) throw new Error(capacity.message);
  const warnings = [...plan.warnings];
  if (capacity.ok === "unknown") warnings.push(capacity.message);
  const persistence = await requestPersistence();

  const metaOf = (chunk: { ownStartSeconds: number; ownDurationSeconds: number; leadInSeconds: number }, index: number) => ({
    index,
    ownStartSeconds: chunk.ownStartSeconds,
    ownDurationSeconds: chunk.ownDurationSeconds,
    leadInSeconds: chunk.leadInSeconds,
  });
  const chunks = mp3Plan !== undefined
    ? mp3Plan.chunks.map((chunk, index) => ({
        meta: metaOf(chunk, index),
        read: async () => readMp3Chunk(file, chunk),
      }))
    : (mp4Plan?.chunks ?? []).map((chunk, index) => ({
        meta: metaOf(chunk, index),
        read: () => readMp4Chunk(file, mp4Plan!, index),
      }));
  const manifest = await storeLongAudio({
    meetingId,
    format,
    mimeType: file.type || (format === "mp3" ? "audio/mpeg" : "audio/mp4"),
    totalSeconds: plan.totalSeconds,
    sampleRate: plan.sampleRate,
    chunks,
    signal: opts.signal,
    replace: opts.replace,
    onProgress: (done, total) => opts.onProgress?.({ phase: "storing", done, total }),
  });
  return {
    audio: {
      name: file.name,
      type: file.type || (format === "mp3" ? "audio/mpeg" : "audio/mp4"),
      size: file.size,
      duration: manifest.totalSeconds,
      hash: manifest.manifestSha256,
      present: true,
      chunked: {
        format,
        chunkCount: manifest.chunks.length,
        totalSeconds: manifest.totalSeconds,
        manifestSha256: manifest.manifestSha256,
      },
    },
    warnings,
    persistence,
  };
}
