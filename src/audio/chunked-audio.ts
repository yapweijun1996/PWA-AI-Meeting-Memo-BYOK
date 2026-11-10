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
  | "defaultPlaybackRate"
  | "error"
  | "readyState"
  | "networkState"
  | "src"
  | "preload"
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

const MAX_CACHED_PLAN_CHUNKS = 3;
// Start decoding and buffering the next window this long before the current one ends.
const PREFETCH_LEAD_SECONDS = 10;
// HAVE_FUTURE_DATA: enough buffered that play() starts immediately instead of loading.
const HAVE_FUTURE_DATA = 3;

const forwardedEvents = [
  "timeupdate", "play", "playing", "pause", "ended", "waiting", "seeking",
  "seeked", "ratechange", "durationchange", "loadedmetadata", "error", "canplay",
] as const;

/** Plays local long recordings on one continuous, absolute meeting timeline. */
export class ChunkedAudio extends EventTarget implements PlayerLike {
  // The element that is audible now. It changes only when a preloaded spare takes over at a window boundary.
  private element: ChunkElement;
  private readonly createElement: () => ChunkElement;
  // A second element that already holds the next window, so the boundary is a play() on buffered media instead of
  // a src change and reload (about 40-80 ms of silence in Chromium). Browsers that refuse play() on an element
  // the user never started (iOS) make the swap fall back to the single-element path and turn the spare off.
  private spare?: { element: ChunkElement; url: string; key: string };
  private spareDisabled = false;
  private rate = 1;
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
  private playIntent = 0;
  private wantsPlayback = false;
  private disposed = false;
  private isPlaying = false;
  private isEnded = false;
  private mediaError: MediaError | null = null;
  private pendingSeeks = 0;
  // Window plans keep a subarray of the whole chunk's bytes alive (up to maxBytes each), so only a few chunks
  // are cached, least recently used first out. Insertion order of the Map is the recency order.
  private readonly plans = new Map<number, WindowPlan[]>();
  private readonly planLoads = new Map<number, Promise<WindowPlan[]>>();
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
    this.createElement = options.createElement ?? (() => document.createElement("audio"));
    for (const type of forwardedEvents) {
      this.handlers.set(type, (event) => this.onMediaEvent(type, event));
    }
    this.element = this.createElement();
    this.attach(this.element);
  }

  private attach(element: ChunkElement): void {
    for (const [type, handler] of this.handlers) element.addEventListener(type, handler);
  }

  private detach(element: ChunkElement): void {
    for (const [type, handler] of this.handlers) element.removeEventListener(type, handler);
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
    this.switching = false;
    this.dispatchEvent(new Event("seeking"));
    this.pendingSeeks++;
    const load = this.manifest.format === "mp3" ? this.loadMp3Time(time, this.wantsPlayback) : this.loadMp4Time(time, this.wantsPlayback);
    const generation = this.generation;
    void load
      .then(() => { if (!this.disposed && generation === this.generation) this.dispatchEvent(new Event("seeked")); })
      .catch((error: unknown) => { if (!this.disposed && generation === this.generation) this.emitError(error); })
      .finally(() => { this.pendingSeeks--; });
  }

  get duration() { return this.manifest.totalSeconds; }
  get paused() { return !this.isPlaying; }
  get ended() { return this.isEnded; }
  get playbackRate() { return this.rate; }
  set playbackRate(value: number) {
    this.rate = value;
    this.tune(this.element);
    if (this.spare) this.tune(this.spare.element);
  }

  /**
   * Assigning `src` runs the media load algorithm, which resets playbackRate to defaultPlaybackRate. Without this,
   * the speed the listener chose is lost on every start, seek and window switch. Set both, and call it after every
   * `src` assignment.
   */
  private tune(element: ChunkElement): void {
    element.defaultPlaybackRate = this.rate;
    element.playbackRate = this.rate;
  }
  get error() { return this.mediaError; }
  get readyState() { return this.element.readyState; }
  get networkState() { return this.element.networkState; }

  async play(): Promise<void> {
    if (this.disposed) throw new Error("Chunked audio has been disposed.");
    const intent = ++this.playIntent;
    this.wantsPlayback = true;
    // A seek that is still loading owns the playhead: the element still reports the old position until it lands.
    const seekPending = this.pendingSeeks > 0;
    const time = this.isEnded ? 0 : seekPending ? this.requestedTime : this.currentTime;
    this.isEnded = false;
    let load: Promise<void> | undefined;
    if (this.manifest.format === "mp3") {
      // Resuming inside the window that is already loaded needs no new source, decode, or buffering.
      if (seekPending || !this.holdsMp3Time(time)) {
        this.switching = false;
        load = this.loadMp3Time(time, false);
      }
    } else {
      this.switching = false;
      load = this.loadMp4Time(time, false);
    }
    const generation = this.generation;
    try { if (load) await load; }
    catch (error) {
      if (this.disposed || intent !== this.playIntent || generation !== this.generation) return;
      this.wantsPlayback = false;
      throw error;
    }
    if (this.disposed || intent !== this.playIntent || generation !== this.generation || !this.wantsPlayback) return;
    try { await this.element.play(); }
    catch (error) {
      if (this.disposed || intent !== this.playIntent || generation !== this.generation) return;
      this.wantsPlayback = false;
      throw error;
    }
    if (!this.disposed && intent === this.playIntent && this.wantsPlayback) this.isPlaying = true;
  }

  private holdsMp3Time(time: number): boolean {
    if (this.activeIndex < 0 || !this.activeUrl || this.mediaError) return false;
    if (this.chunkForTime(time).position !== this.activeIndex) return false;
    const window = this.plans.get(this.activeIndex)?.[this.activeWindow];
    return !!window && time >= this.activeStart && time < this.activeStart + window.ownDurationSeconds;
  }

  pause(): void {
    this.wantsPlayback = false;
    this.playIntent++;
    this.element.pause();
    this.isPlaying = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wantsPlayback = false;
    this.playIntent++;
    this.generation++;
    this.element.pause();
    this.detach(this.element);
    if (this.spare) {
      this.spare.element.pause();
      this.detach(this.spare.element);
      if (this.spare.url) URL.revokeObjectURL(this.spare.url);
      this.spare = undefined;
    }
    this.revokeActiveUrl();
    this.plans.clear();
    this.planLoads.clear();
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
    if (cached) {
      this.plans.delete(index);
      this.plans.set(index, cached);
      return cached;
    }
    // A prefetch and a seek into the same chunk share one read and one frame scan.
    const pending = this.planLoads.get(index);
    if (pending) return pending;
    const load = (async () => {
      const meta = this.manifest.chunks[index];
      const blob = await this.loadChunk(this.manifest.meetingId, meta.index);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const plans = this.planWindows(bytes);
      if (!plans.length) throw new Error("The MP3 chunk contains no playable frames.");
      if (!this.disposed) {
        this.plans.set(index, plans);
        this.trimPlans();
      }
      return plans;
    })();
    this.planLoads.set(index, load);
    try { return await load; }
    finally { if (this.planLoads.get(index) === load) this.planLoads.delete(index); }
  }

  /** Drops the least recently used chunk plans, but never the chunk that is playing (its plan drives window switching). */
  private trimPlans(): void {
    for (const key of this.plans.keys()) {
      if (this.plans.size <= MAX_CACHED_PLAN_CHUNKS) break;
      if (key !== this.activeIndex) this.plans.delete(key);
    }
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
    const intent = this.playIntent;
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
    this.tune(this.element);
    this.element.currentTime = Math.max(0, Math.min(window.ownDurationSeconds, time - start));
    this.mediaError = null;
    this.dispatchEvent(new Event("durationchange"));
    if (resume && intent === this.playIntent && this.wantsPlayback) {
      try { await this.element.play(); }
      catch (error) {
        if (this.disposed || generation !== this.generation || intent !== this.playIntent) return;
        throw error;
      }
    }
  }

  private async loadMp4Time(time: number, resume: boolean): Promise<void> {
    const generation = ++this.generation;
    const intent = this.playIntent;
    const chunk = this.chunkForTime(time);
    const offset = chunk.leadInSeconds + time - chunk.ownStartSeconds;
    if (chunk.position === this.activeIndex) {
      this.element.currentTime = offset;
      return;
    }
    const blob = await this.loadChunk(this.manifest.meetingId, chunk.index);
    if (this.disposed || generation !== this.generation) return;
    const url = URL.createObjectURL(blob);
    this.revokeActiveUrl();
    this.activeUrl = url;
    this.activeIndex = chunk.position;
    this.element.src = url;
    this.tune(this.element);
    this.element.currentTime = offset;
    this.mediaError = null;
    this.dispatchEvent(new Event("durationchange"));
    if (resume && intent === this.playIntent && this.wantsPlayback) {
      try { await this.element.play(); }
      catch (error) {
        if (this.disposed || generation !== this.generation || intent !== this.playIntent) return;
        throw error;
      }
    }
  }

  private onMediaEvent(type: string, event: Event): void {
    if (this.disposed) return;
    // Only the audible element drives state; a spare's loading events and a retired element's late
    // pause/ended must not look like playback events.
    if (event.target !== (this.element as unknown)) return;
    if (type === "error") {
      this.mediaError = this.element.error;
      this.wantsPlayback = false;
      this.playIntent++;
      this.isPlaying = false;
      this.dispatchEvent(new Event("error"));
      return;
    }
    if (type === "playing" || type === "play") {
      if (!this.wantsPlayback) { this.element.pause(); return; }
      this.isPlaying = true;
      this.isEnded = false;
    }
    if (type === "pause") this.isPlaying = false;
    if (type === "ended" || type === "timeupdate") {
      if (this.manifest.format === "mp3") {
        const plan = this.plans.get(this.activeIndex)?.[this.activeWindow];
        if (plan) {
          const remaining = plan.ownDurationSeconds - this.element.currentTime;
          if (remaining <= PREFETCH_LEAD_SECONDS) this.prefetchNextWindow();
          if (type === "ended" || remaining <= 0.04) {
            if (this.switchNextWindow()) {
              if (type === "ended") return;
            } else {
              this.isEnded = true;
              this.isPlaying = false;
              this.wantsPlayback = false;
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
          this.wantsPlayback = false;
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
    if (!next) return;
    void this.getWindowBlob(next.chunkIndex, next.windowIndex)
      .then((blob) => this.prepareSpare(next, blob))
      .catch(() => undefined);
  }

  /** Loads the next window into the spare element so the boundary can start already-buffered media. */
  private prepareSpare(next: { chunkIndex: number; windowIndex: number }, blob: Blob): void {
    if (this.spareDisabled || this.disposed || this.manifest.format !== "mp3") return;
    // The decode finishes later: skip it if playback has since moved on (a boundary swap or a seek), otherwise
    // the spare would be loaded with the window that is already playing.
    const current = this.nextWindow();
    if (!current || current.chunkIndex !== next.chunkIndex || current.windowIndex !== next.windowIndex) return;
    const key = `${next.chunkIndex}:${next.windowIndex}`;
    if (this.spare?.key === key) return;
    let element = this.spare?.element;
    if (!element) {
      element = this.createElement();
      // A factory that hands back the same element (tests, or an embedder with one element) cannot have a spare.
      if (element === this.element) {
        this.spareDisabled = true;
        return;
      }
      this.attach(element);
    }
    if (this.spare?.url) URL.revokeObjectURL(this.spare.url);
    const url = URL.createObjectURL(blob);
    element.preload = "auto";
    element.src = url;
    this.tune(element);
    this.spare = { element, url, key };
  }

  /**
   * Hands playback to the spare if it already holds the next window and has buffered it. Returns false (nothing
   * changed) when it cannot, so the caller uses the single-element path. If the browser refuses play() on the
   * spare afterwards, playback is moved back to the original element and the spare is turned off.
   */
  private swapToSpare(next: { chunkIndex: number; windowIndex: number }): boolean {
    const spare = this.spare;
    if (!spare || spare.key !== `${next.chunkIndex}:${next.windowIndex}` || spare.element.readyState < HAVE_FUTURE_DATA) return false;
    const plan = this.plans.get(next.chunkIndex)?.[next.windowIndex];
    if (!plan) return false;
    const nextChunk = this.manifest.chunks[next.chunkIndex];
    const start = nextChunk.ownStartSeconds - nextChunk.leadInSeconds + plan.ownStartSeconds;
    const incoming = spare.element;
    const outgoing = this.element;
    this.tune(incoming);
    // Entering a new chunk skips its lead-in overlap, which was already played from the previous chunk.
    const offset = Math.max(0, nextChunk.ownStartSeconds - start);
    if (offset > 0) incoming.currentTime = offset;
    let started: Promise<void>;
    const generation = this.generation;
    const intent = this.playIntent;
    try { started = incoming.play(); } catch { return false; }
    const retiredUrl = this.activeUrl;
    this.activeUrl = spare.url;
    this.activeIndex = next.chunkIndex;
    this.activeWindow = next.windowIndex;
    this.activeStart = start;
    this.element = incoming;
    this.spare = { element: outgoing, url: "", key: "" };
    outgoing.pause();
    if (retiredUrl) URL.revokeObjectURL(retiredUrl);
    for (const key of this.windowBlobs.keys()) {
      if (key !== spare.key) this.windowBlobs.delete(key);
    }
    this.dispatchEvent(new Event("durationchange"));
    started.catch((error: unknown) => {
      // AbortError means the user paused or sought meanwhile; only a refusal to start is a reason to fall back.
      if (this.disposed || this.element !== incoming || generation !== this.generation || intent !== this.playIntent || !this.wantsPlayback) return;
      if ((error as { name?: string } | null)?.name === "AbortError") return;
      this.spareDisabled = true;
      this.spare = undefined;
      const position = incoming.currentTime;
      const source = this.activeUrl;
      incoming.pause();
      this.detach(incoming);
      this.element = outgoing;
      outgoing.src = source;
      this.tune(outgoing);
      outgoing.currentTime = position;
      void outgoing.play().catch((failure: unknown) => this.emitError(failure));
    });
    return true;
  }

  private switchNextWindow(): boolean {
    if (this.switching) return true;
    const next = this.nextWindow();
    if (!next) return false;
    const startPlaying = this.isPlaying;
    if (startPlaying && this.swapToSpare(next)) return true;
    const generation = this.generation;
    const intent = this.playIntent;
    this.switching = true;
    void this.getWindowBlob(next.chunkIndex, next.windowIndex)
      .then(async (blob) => {
        if (this.disposed || generation !== this.generation) return;
        // Normally still cached (it was just used); reload instead of silently stalling if it was trimmed meanwhile.
        const plan = (this.plans.get(next.chunkIndex) ?? await this.getPlans(next.chunkIndex))[next.windowIndex];
        if (this.disposed || generation !== this.generation) return;
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
        this.tune(this.element);
        // Entering a new chunk skips its lead-in overlap, which was already played from the previous chunk.
        this.element.currentTime = Math.max(0, nextChunk.ownStartSeconds - this.activeStart);
        if (startPlaying && intent === this.playIntent && this.wantsPlayback) void this.element.play().catch((error: unknown) => {
          if (!this.disposed && generation === this.generation && intent === this.playIntent) this.emitError(error);
        });
        this.dispatchEvent(new Event("durationchange"));
      })
      .catch((error: unknown) => { if (!this.disposed && generation === this.generation) this.emitError(error); })
      .finally(() => { if (generation === this.generation) this.switching = false; });
    return true;
  }

  private switchNextMp4(): void {
    if (this.switching) return;
    const nextIndex = this.activeIndex + 1;
    if (nextIndex >= this.manifest.chunks.length) return;
    this.switching = true;
    const next = this.manifest.chunks[nextIndex];
    const load = this.loadMp4Time(next.ownStartSeconds, this.wantsPlayback);
    const generation = this.generation;
    void load
      .catch((error: unknown) => { if (!this.disposed && generation === this.generation) this.emitError(error); })
      .finally(() => { if (generation === this.generation) this.switching = false; });
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
    this.wantsPlayback = false;
    this.playIntent++;
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
