import {
  getLongAudioChunk,
  type LongAudioManifest,
} from "../storage/long-audio-store";
import { splitMp3 } from "./mp3-split";
import { encodePcm16Wav, mixToMono } from "./wav";

type ChunkElement = Pick<
  HTMLAudioElement,
  | "currentTime"
  | "duration"
  | "paused"
  | "ended"
  | "playbackRate"
  | "error"
  | "readyState"
  | "networkState"
  | "src"
  | "play"
  | "pause"
  | "addEventListener"
  | "removeEventListener"
>;

export type PlayerLike = Pick<
  HTMLAudioElement,
  | "currentTime"
  | "duration"
  | "paused"
  | "ended"
  | "playbackRate"
  | "error"
  | "readyState"
  | "networkState"
  | "play"
  | "pause"
  | "addEventListener"
  | "removeEventListener"
>;

type WindowPlan = {
  bytes: Uint8Array;
  byteOffset?: number;
  byteLength?: number;
  leadInSeconds: number;
  ownStartSeconds: number;
  ownDurationSeconds: number;
};
type ChunkedAudioOptions = {
  loadChunk?: (meetingId: string, index: number) => Promise<Blob>;
  createElement?: () => ChunkElement;
  planWindows?: (bytes: Uint8Array) => WindowPlan[];
  decodeWindow?: (bytes: Uint8Array, leadInSeconds: number, ownDurationSeconds: number) => Promise<Blob>;
};

const forwardedEvents = [
  "timeupdate", "play", "playing", "pause", "ended", "waiting", "seeking",
  "seeked", "ratechange", "durationchange", "loadedmetadata", "error", "canplay",
] as const;

/** Plays local long recordings on one continuous, absolute meeting timeline. */
export class ChunkedAudio extends EventTarget implements PlayerLike {
  private readonly element: ChunkElement;
  private readonly loadChunk: (meetingId: string, index: number) => Promise<Blob>;
  private readonly planWindows: (bytes: Uint8Array) => WindowPlan[];
  private readonly decodeWindow: NonNullable<ChunkedAudioOptions["decodeWindow"]>;
  private activeIndex = -1;
  private activeWindow = -1;
  private activeStart = 0;
  private requestedTime = 0;
  private activeUrl = "";
  private switching = false;
  private generation = 0;
  private disposed = false;
  private isPlaying = false;
  private isEnded = false;
  private mediaError: MediaError | null = null;
  private readonly plans = new Map<number, WindowPlan[]>();
  private readonly windowBlobs = new Map<string, Blob>();
  private readonly windowLoads = new Map<string, Promise<Blob>>();
  private readonly handlers = new Map<string, EventListener>();
  private audioContext?: AudioContext;

  constructor(readonly manifest: LongAudioManifest, options: ChunkedAudioOptions = {}) {
    super();
    if (manifest.chunks.length === 0) throw new Error("The long-audio manifest has no chunks.");
    this.loadChunk = options.loadChunk ?? getLongAudioChunk;
    this.planWindows = options.planWindows ?? ((bytes) => splitMp3(bytes, {
      targetSeconds: 60, maxBytes: 24_000_000, minLeadInSeconds: 1,
    }).chunks);
    this.decodeWindow = options.decodeWindow ?? ((bytes, leadInSeconds, ownDurationSeconds) =>
      this.decodeMp3Window(bytes, leadInSeconds, ownDurationSeconds));
    this.element = (options.createElement ?? (() => document.createElement("audio")))();
    for (const type of forwardedEvents) {
      const handler: EventListener = (event) => this.onMediaEvent(type, event);
      this.handlers.set(type, handler);
      this.element.addEventListener(type, handler);
    }
  }

  get currentTime(): number {
    if (this.activeIndex < 0) return this.requestedTime;
    if (this.manifest.format === "mp3") {
      return Math.max(0, Math.min(this.manifest.totalSeconds, this.activeStart + this.element.currentTime));
    }
    const chunk = this.manifest.chunks[this.activeIndex];
    return Math.max(0, Math.min(this.manifest.totalSeconds,
      chunk.ownStartSeconds + this.element.currentTime - chunk.leadInSeconds));
  }

  set currentTime(value: number) {
    const time = Math.max(0, Math.min(this.manifest.totalSeconds, Number.isFinite(value) ? value : 0));
    this.requestedTime = time;
    this.isEnded = false;
    this.dispatchEvent(new Event("seeking"));
    void (this.manifest.format === "mp3" ? this.loadMp3Time(time, this.isPlaying) : this.loadMp4Time(time, this.isPlaying))
      .then(() => this.dispatchEvent(new Event("seeked")))
      .catch((error: unknown) => this.emitError(error));
  }

  get duration() { return this.manifest.totalSeconds; }
  get paused() { return !this.isPlaying; }
  get ended() { return this.isEnded; }
  get playbackRate() { return this.element.playbackRate; }
  set playbackRate(value: number) { this.element.playbackRate = value; }
  get error() { return this.mediaError; }
  get readyState() { return this.element.readyState; }
  get networkState() { return this.element.networkState; }

  async play(): Promise<void> {
    if (this.disposed) throw new Error("Chunked audio has been disposed.");
    const time = this.isEnded ? 0 : this.currentTime;
    this.isEnded = false;
    if (this.manifest.format === "mp3") await this.loadMp3Time(time, false);
    else await this.loadMp4Time(time, false);
    await this.element.play();
    this.isPlaying = true;
  }

  pause(): void {
    this.element.pause();
    this.isPlaying = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.element.pause();
    for (const [type, handler] of this.handlers) this.element.removeEventListener(type, handler);
    this.revokeActiveUrl();
    this.plans.clear();
    this.windowBlobs.clear();
    this.windowLoads.clear();
    void this.audioContext?.close();
  }

  private chunkForTime(time: number) {
    const chunks = this.manifest.chunks;
    const index = chunks.findIndex((chunk, i) =>
      time >= chunk.ownStartSeconds &&
      (time < chunk.ownStartSeconds + chunk.ownDurationSeconds ||
        (i === chunks.length - 1 && time <= this.manifest.totalSeconds)),
    );
    const position = index >= 0 ? index : Math.max(0, chunks.length - 1);
    return { ...chunks[position], position };
  }

  private async getPlans(index: number): Promise<WindowPlan[]> {
    const cached = this.plans.get(index);
    if (cached) return cached;
    const meta = this.manifest.chunks[index];
    const blob = await this.loadChunk(this.manifest.meetingId, meta.index);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const plans = this.planWindows(bytes);
    if (!plans.length) throw new Error("The MP3 chunk contains no playable frames.");
    this.plans.set(index, plans);
    return plans;
  }

  private async getWindowBlob(chunkIndex: number, windowIndex: number): Promise<Blob> {
    const key = `${chunkIndex}:${windowIndex}`;
    const cached = this.windowBlobs.get(key);
    if (cached) return cached;
    const pending = this.windowLoads.get(key);
    if (pending) return pending;
    const load = (async () => {
      const plans = await this.getPlans(chunkIndex);
      const plan = plans[windowIndex];
      const wav = await this.decodeWindow(plan.bytes, plan.leadInSeconds, plan.ownDurationSeconds);
      if (!this.disposed) {
        this.windowBlobs.set(key, wav);
        while (this.windowBlobs.size > 2) {
          const oldest = this.windowBlobs.keys().next().value;
          if (oldest === undefined) break;
          this.windowBlobs.delete(oldest);
        }
      }
      return wav;
    })();
    this.windowLoads.set(key, load);
    try { return await load; }
    finally { if (this.windowLoads.get(key) === load) this.windowLoads.delete(key); }
  }

  private async loadMp3Time(time: number, resume: boolean): Promise<void> {
    const generation = ++this.generation;
    const chunk = this.chunkForTime(time);
    const windows = await this.getPlans(chunk.position);
    // Window times are relative to the chunk blob, which begins leadInSeconds before the chunk's own range.
    const blobStart = chunk.ownStartSeconds - chunk.leadInSeconds;
    let windowIndex = windows.findIndex((window, index) =>
      time >= blobStart + window.ownStartSeconds &&
      (time < blobStart + window.ownStartSeconds + window.ownDurationSeconds ||
        (index === windows.length - 1 && time <= chunk.ownStartSeconds + chunk.ownDurationSeconds)),
    );
    if (windowIndex < 0) windowIndex = windows.length - 1;
    const window = windows[windowIndex];
    const start = blobStart + window.ownStartSeconds;
    const blob = await this.getWindowBlob(chunk.position, windowIndex);
    if (this.disposed || generation !== this.generation) return;
    for (const key of this.windowBlobs.keys()) {
      if (key !== `${chunk.position}:${windowIndex}`) this.windowBlobs.delete(key);
    }
    const url = URL.createObjectURL(blob);
    this.revokeActiveUrl();
    this.activeUrl = url;
    this.activeIndex = chunk.position;
    this.activeWindow = windowIndex;
    this.activeStart = start;
    this.element.src = url;
    this.element.currentTime = Math.max(0, Math.min(window.ownDurationSeconds, time - start));
    this.mediaError = null;
    this.dispatchEvent(new Event("durationchange"));
    if (resume) await this.element.play();
  }

  private async loadMp4Time(time: number, resume: boolean): Promise<void> {
    const chunk = this.chunkForTime(time);
    const offset = chunk.leadInSeconds + time - chunk.ownStartSeconds;
    if (chunk.position === this.activeIndex) {
      this.element.currentTime = offset;
      return;
    }
    const generation = ++this.generation;
    const blob = await this.loadChunk(this.manifest.meetingId, chunk.index);
    if (this.disposed || generation !== this.generation) return;
    const url = URL.createObjectURL(blob);
    this.revokeActiveUrl();
    this.activeUrl = url;
    this.activeIndex = chunk.position;
    this.element.src = url;
    this.element.currentTime = offset;
    this.mediaError = null;
    this.dispatchEvent(new Event("durationchange"));
    if (resume) await this.element.play();
  }

  private onMediaEvent(type: string, event: Event): void {
    if (this.disposed) return;
    if (type === "error") {
      this.mediaError = this.element.error;
      this.isPlaying = false;
      this.dispatchEvent(new Event("error"));
      return;
    }
    if (type === "playing" || type === "play") { this.isPlaying = true; this.isEnded = false; }
    if (type === "pause") this.isPlaying = false;
    if (type === "ended" || type === "timeupdate") {
      if (this.manifest.format === "mp3") {
        const plan = this.plans.get(this.activeIndex)?.[this.activeWindow];
        if (plan) {
          const remaining = plan.ownDurationSeconds - this.element.currentTime;
          if (remaining <= 5) this.prefetchNextWindow();
          if (type === "ended" || remaining <= 0.04) {
            if (this.switchNextWindow()) {
              if (type === "ended") return;
            } else {
              this.isEnded = true;
              this.isPlaying = false;
              this.dispatchEvent(new Event("ended"));
              return;
            }
          }
        }
      } else if (type === "ended" || this.isMp4Boundary()) {
        if (this.activeIndex + 1 < this.manifest.chunks.length) {
          this.switchNextMp4();
          if (type === "ended") return;
        } else {
          this.isEnded = true;
          this.isPlaying = false;
          this.dispatchEvent(new Event("ended"));
          return;
        }
      }
    }
    this.dispatchEvent(new Event(type, { bubbles: false, cancelable: event.cancelable }));
  }

  private isMp4Boundary(): boolean {
    const chunk = this.manifest.chunks[this.activeIndex];
    return !!chunk && this.element.currentTime + 0.04 >= chunk.leadInSeconds + chunk.ownDurationSeconds;
  }

  private nextWindow(): { chunkIndex: number; windowIndex: number } | undefined {
    const windows = this.plans.get(this.activeIndex) ?? [];
    if (this.activeWindow + 1 < windows.length) return { chunkIndex: this.activeIndex, windowIndex: this.activeWindow + 1 };
    if (this.activeIndex + 1 < this.manifest.chunks.length) return { chunkIndex: this.activeIndex + 1, windowIndex: 0 };
    return undefined;
  }

  private prefetchNextWindow(): void {
    const next = this.nextWindow();
    if (next) void this.getWindowBlob(next.chunkIndex, next.windowIndex).catch(() => undefined);
  }

  private switchNextWindow(): boolean {
    if (this.switching) return true;
    const next = this.nextWindow();
    if (!next) return false;
    this.switching = true;
    const startPlaying = this.isPlaying;
    void this.getWindowBlob(next.chunkIndex, next.windowIndex)
      .then((blob) => {
        if (this.disposed) return;
        const plan = this.plans.get(next.chunkIndex)?.[next.windowIndex];
        for (const key of this.windowBlobs.keys()) {
          if (key !== `${next.chunkIndex}:${next.windowIndex}`) this.windowBlobs.delete(key);
        }
        if (!plan) return;
        const url = URL.createObjectURL(blob);
        this.revokeActiveUrl();
        this.activeUrl = url;
        this.activeIndex = next.chunkIndex;
        this.activeWindow = next.windowIndex;
        const nextChunk = this.manifest.chunks[next.chunkIndex];
        this.activeStart = nextChunk.ownStartSeconds - nextChunk.leadInSeconds + plan.ownStartSeconds;
        this.element.src = url;
        // Entering a new chunk skips its lead-in overlap, which was already played from the previous chunk.
        this.element.currentTime = Math.max(0, nextChunk.ownStartSeconds - this.activeStart);
        if (startPlaying) void this.element.play();
        this.dispatchEvent(new Event("durationchange"));
      })
      .catch((error: unknown) => this.emitError(error))
      .finally(() => { this.switching = false; });
    return true;
  }

  private switchNextMp4(): void {
    if (this.switching) return;
    const nextIndex = this.activeIndex + 1;
    if (nextIndex >= this.manifest.chunks.length) return;
    this.switching = true;
    const next = this.manifest.chunks[nextIndex];
    void this.loadMp4Time(next.ownStartSeconds, this.isPlaying)
      .catch((error: unknown) => this.emitError(error))
      .finally(() => { this.switching = false; });
  }

  private async decodeMp3Window(bytes: Uint8Array, leadInSeconds: number, ownDurationSeconds: number): Promise<Blob> {
    const Context = window.AudioContext;
    this.audioContext ??= new Context();
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    const decoded = await this.audioContext.decodeAudioData(input);
    const rate = decoded.sampleRate;
    const start = Math.round(leadInSeconds * rate);
    const count = Math.round(ownDurationSeconds * rate);
    const mono = mixToMono(
      Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)),
      start,
      count,
    );
    return encodePcm16Wav(mono, rate);
  }

  private emitError(_error: unknown): void {
    if (this.disposed) return;
    this.mediaError = this.element.error ?? ({} as MediaError);
    this.isPlaying = false;
    this.element.pause();
    this.dispatchEvent(new Event("error"));
  }

  private revokeActiveUrl(): void {
    if (this.activeUrl) URL.revokeObjectURL(this.activeUrl);
    this.activeUrl = "";
  }
}
