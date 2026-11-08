import {
  getLongAudioChunk,
  type LongAudioManifest,
} from "../storage/long-audio-store";

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

type ChunkedAudioOptions = {
  loadChunk?: (meetingId: string, index: number) => Promise<Blob>;
  createElement?: () => ChunkElement;
};

const forwardedEvents = [
  "timeupdate", "play", "playing", "pause", "ended", "waiting", "seeking",
  "seeked", "ratechange", "durationchange", "loadedmetadata", "error", "canplay",
] as const;

/** Plays verified local chunks against one continuous, absolute meeting timeline. */
export class ChunkedAudio extends EventTarget implements PlayerLike {
  private readonly element: ChunkElement;
  private readonly loadChunk: (meetingId: string, index: number) => Promise<Blob>;
  private activeIndex = -1;
  private requestedTime = 0;
  private activeUrl = "";
  private switchingIndex = -1;
  private generation = 0;
  private disposed = false;
  private isPlaying = false;
  private isEnded = false;
  private mediaError: MediaError | null = null;
  private cached = new Map<number, Blob>();
  private prefetching = new Map<number, Promise<Blob>>();
  private readonly handlers = new Map<string, EventListener>();

  constructor(readonly manifest: LongAudioManifest, options: ChunkedAudioOptions = {}) {
    super();
    if (manifest.chunks.length === 0) throw new Error("The long-audio manifest has no chunks.");
    this.loadChunk = options.loadChunk ?? getLongAudioChunk;
    this.element = (options.createElement ?? (() => document.createElement("audio")))();
    for (const type of forwardedEvents) {
      const handler: EventListener = (event) => this.onMediaEvent(type, event);
      this.handlers.set(type, handler);
      this.element.addEventListener(type, handler);
    }
  }

  get currentTime(): number {
    if (this.activeIndex < 0) return this.requestedTime;
    const chunk = this.manifest.chunks[this.activeIndex];
    return Math.max(0, Math.min(this.manifest.totalSeconds,
      chunk.ownStartSeconds + this.element.currentTime - chunk.leadInSeconds));
  }

  set currentTime(value: number) {
    const time = Math.max(0, Math.min(this.manifest.totalSeconds, Number.isFinite(value) ? value : 0));
    this.requestedTime = time;
    this.isEnded = false;
    const chunk = this.chunkForTime(time);
    this.dispatchEvent(new Event("seeking"));
    void this.loadIndex(chunk.position, chunk.leadInSeconds + time - chunk.ownStartSeconds, this.isPlaying)
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
    const chunk = this.chunkForTime(time);
    await this.loadIndex(chunk.position, chunk.leadInSeconds + time - chunk.ownStartSeconds, false);
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
    this.cached.clear();
    this.prefetching.clear();
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

  private async loadIndex(index: number, elementTime: number, resume: boolean): Promise<void> {
    if (this.disposed) return;
    if (index === this.activeIndex) {
      this.element.currentTime = elementTime;
      return;
    }
    const generation = ++this.generation;
    const meta = this.manifest.chunks[index];
    const pending = this.prefetching.get(index);
    const blob = this.cached.get(index) ?? await (pending ?? this.loadChunk(this.manifest.meetingId, meta.index));
    if (this.disposed || generation !== this.generation) return;
    this.cached.delete(index);
    const url = URL.createObjectURL(blob);
    this.revokeActiveUrl();
    this.activeUrl = url;
    this.activeIndex = index;
    this.element.src = url;
    this.element.currentTime = elementTime;
    this.mediaError = null;
    this.dispatchEvent(new Event("durationchange"));
    if (resume) await this.element.play();
  }

  private prefetch(index: number): void {
    if (index >= this.manifest.chunks.length || this.cached.has(index) || this.prefetching.has(index)) return;
    const pending = this.loadChunk(this.manifest.meetingId, this.manifest.chunks[index].index);
    this.prefetching.set(index, pending);
    void pending.then(
      (blob) => { if (!this.disposed) this.cached.set(index, blob); },
      () => undefined,
    ).finally(() => {
      if (this.prefetching.get(index) === pending) this.prefetching.delete(index);
    });
  }
  private onMediaEvent(type: string, event: Event): void {
    if (this.disposed) return;
    if (type === "error") {
      this.mediaError = this.element.error;
      this.isPlaying = false;
      this.dispatchEvent(new Event("error"));
      return;
    }
    if (type === "ended") {
      if (this.activeIndex + 1 < this.manifest.chunks.length) {
        this.switchToNextChunk();
        return;
      }
      this.isEnded = true;
      this.isPlaying = false;
      this.dispatchEvent(new Event("ended"));
      return;
    }
    if (type === "playing" || type === "play") { this.isPlaying = true; this.isEnded = false; }
    if (type === "pause") this.isPlaying = false;
    if (type === "timeupdate") {
      const chunk = this.manifest.chunks[this.activeIndex];
      if (chunk) {
        const boundary = chunk.leadInSeconds + chunk.ownDurationSeconds;
        if (this.activeIndex + 1 < this.manifest.chunks.length && this.element.currentTime >= boundary - 3) {
          this.prefetch(this.activeIndex + 1);
        }
        if (this.element.currentTime + 0.04 >= boundary) {
          if (this.activeIndex + 1 < this.manifest.chunks.length) this.switchToNextChunk();
          else {
            this.isEnded = true;
            this.isPlaying = false;
            this.dispatchEvent(new Event("ended"));
          }
        }
      }
    }
    this.dispatchEvent(new Event(type, { bubbles: false, cancelable: event.cancelable }));
  }

  private switchToNextChunk(): void {
    const index = this.activeIndex + 1;
    if (index >= this.manifest.chunks.length || this.switchingIndex === index) return;
    this.switchingIndex = index;
    const next = this.manifest.chunks[index];
    void this.loadIndex(index, next.leadInSeconds, this.isPlaying)
      .catch((error: unknown) => this.emitError(error))
      .finally(() => {
        if (this.switchingIndex === index) this.switchingIndex = -1;
      });
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
