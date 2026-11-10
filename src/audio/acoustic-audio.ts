import { mixToMono } from "./wav";
import type { AcousticSampleWindow, AcousticSourcePart } from "../domain/acoustic-speaker";
import { planMp3Split, readMp3Chunk } from "./mp3-split";
import { planMp4Split, readMp4Chunk } from "./mp4-split";

export interface AcousticDecodeOptions {
  createContext?: () => AudioContext;
  signal?: AbortSignal;
  format: "mp3" | "mp4";
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function resample(source: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return source;
  const output = new Float32Array(Math.max(1, Math.round(source.length * targetRate / sourceRate)));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * sourceRate / targetRate;
    const left = Math.min(source.length - 1, Math.max(0, Math.floor(position)));
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (source[left] ?? 0) * (1 - fraction) + (source[right] ?? 0) * fraction;
  }
  return output;
}

async function boundedEncodedWindow(
  bytes: ArrayBuffer,
  chunk: AcousticSourcePart,
  sample: AcousticSampleWindow,
  format: "mp3" | "mp4",
  signal?: AbortSignal,
): Promise<{ bytes: ArrayBuffer; startSeconds: number }> {
  abortIfRequested(signal);
  const source = new Blob([bytes], { type: format === "mp3" ? "audio/mpeg" : "audio/mp4" });
  const sourceStart = chunk.ownStartSeconds - chunk.leadInSeconds;
  const findWindow = <T extends { ownStartSeconds: number; ownDurationSeconds: number; leadInSeconds: number }>(windows: readonly T[]): T => {
    const window = windows.find((candidate) => {
      const start = sourceStart + candidate.ownStartSeconds - candidate.leadInSeconds;
      const end = sourceStart + candidate.ownStartSeconds + candidate.ownDurationSeconds;
      return sample.startSeconds >= start && sample.endSeconds <= end;
    });
    if (!window) throw new Error("No independently decodable audio window contains the selected acoustic sample.");
    return window;
  };
  if (format === "mp3") {
    const plan = await planMp3Split(source, {
      targetSeconds: 60,
      maxBytes: 24_000_000,
      minLeadInSeconds: 4,
    });
    const window = findWindow(plan.chunks);
    const encoded = readMp3Chunk(source, window);
    abortIfRequested(signal);
    return {
      bytes: await encoded.arrayBuffer(),
      startSeconds: sourceStart + window.ownStartSeconds - window.leadInSeconds,
    };
  }
  const plan = await planMp4Split(source, {
    targetSeconds: 60,
    maxBytes: 24_000_000,
    minLeadInSeconds: 4,
  });
  const window = findWindow(plan.chunks);
  const encoded = await readMp4Chunk(source, plan, window.index);
  abortIfRequested(signal);
  return {
    bytes: await encoded.arrayBuffer(),
    startSeconds: sourceStart + window.ownStartSeconds - window.leadInSeconds,
  };
}

/**
 * Decode one selected part window. The current browser contract uses one
 * bounded chunk decode and immediately drops the decoded AudioBuffer; it never
 * decodes the full long recording or retains windows between samples.
 */
export async function decodeAcousticWindow(
  bytes: ArrayBuffer,
  chunk: AcousticSourcePart,
  sample: AcousticSampleWindow,
  options: AcousticDecodeOptions,
): Promise<Float32Array> {
  abortIfRequested(options.signal);
  if (sample.chunkIndex !== chunk.index || sample.endSeconds <= sample.startSeconds) {
    throw new Error("Acoustic sample does not belong to the requested chunk.");
  }
  const bounded = await boundedEncodedWindow(bytes, chunk, sample, options.format, options.signal);
  const Context = options.createContext ?? (() => new AudioContext({ latencyHint: "playback" }));
  const context = Context();
  try {
    // Decode only an independently decodable window. Decoding the stored part
    // here would expand a long low-bitrate part into hundreds of megabytes of
    // PCM before the four-second acoustic sample is cropped.
    const decoded = await context.decodeAudioData(bounded.bytes.slice(0));
    abortIfRequested(options.signal);
    const start = Math.max(0, Math.floor((sample.startSeconds - bounded.startSeconds) * decoded.sampleRate));
    const end = Math.min(decoded.length, Math.ceil((sample.endSeconds - bounded.startSeconds) * decoded.sampleRate));
    if (end <= start) throw new Error("Selected acoustic window is outside decoded audio.");
    const mono = mixToMono(
      Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)),
      start,
      end - start,
    );
    return resample(mono, decoded.sampleRate, 16000);
  } finally {
    await context.close().catch(() => undefined);
  }
}
