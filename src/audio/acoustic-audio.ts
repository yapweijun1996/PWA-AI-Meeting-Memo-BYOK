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

/** Zero crossings of the low-pass kernel on each side; more is sharper and slower. */
const RESAMPLE_ZERO_CROSSINGS = 16;
/** Pass band as a share of the lower Nyquist frequency, leaving room for the filter's roll-off. */
const RESAMPLE_PASS_BAND = 0.92;

/**
 * Change the sample rate with a low-pass filter (Hann-windowed sinc). Reducing
 * the rate without one folds everything above the new Nyquist frequency back
 * into the speech band, and the folded content depends on the source rate, so
 * the same passage would give different voice vectors on 44.1 kHz and 48 kHz
 * devices.
 */
export function resampleBandLimited(source: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return source;
  const ratio = targetRate / sourceRate;
  // Frequencies are relative to the source Nyquist frequency.
  const cutoff = Math.min(1, ratio) * RESAMPLE_PASS_BAND;
  const halfWidth = Math.ceil(RESAMPLE_ZERO_CROSSINGS / Math.min(1, ratio));
  const output = new Float32Array(Math.max(1, Math.round(source.length * ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const centre = index / ratio;
    const first = Math.max(0, Math.ceil(centre - halfWidth));
    const last = Math.min(source.length - 1, Math.floor(centre + halfWidth));
    let sum = 0;
    let weight = 0;
    for (let n = first; n <= last; n += 1) {
      const offset = n - centre;
      const phase = Math.PI * cutoff * offset;
      const sinc = phase === 0 ? 1 : Math.sin(phase) / phase;
      const kernel = sinc * 0.5 * (1 + Math.cos((Math.PI * offset) / halfWidth));
      sum += (source[n] ?? 0) * kernel;
      weight += kernel;
    }
    // Dividing by the kernel sum keeps the level correct at the window's edges.
    output[index] = weight !== 0 ? sum / weight : 0;
  }
  return output;
}

/** Below this level (about -50 dBFS) a window holds no usable speech. Uncalibrated. */
const MIN_WINDOW_RMS = 0.003;
/** More than this share of samples at full scale means the window is clipped. Uncalibrated. */
const MAX_CLIPPED_SHARE = 0.2;

/**
 * Whether decoded audio is worth turning into a voice vector. Provider
 * timestamps can point at silence, and a clipped passage carries little of the
 * voice; a vector from either would be noise that counts as evidence.
 */
export function isUsableAcousticWindow(samples: Float32Array): boolean {
  if (!samples.length) return false;
  let energy = 0;
  let clipped = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    if (!Number.isFinite(value)) return false;
    energy += value * value;
    if (Math.abs(value) >= 0.999) clipped += 1;
  }
  return Math.sqrt(energy / samples.length) >= MIN_WINDOW_RMS && clipped / samples.length <= MAX_CLIPPED_SHARE;
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
    return resampleBandLimited(mono, decoded.sampleRate, 16000);
  } finally {
    await context.close().catch(() => undefined);
  }
}

