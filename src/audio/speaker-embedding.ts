import { ACOUSTIC_POLICY, normalizeEmbedding } from "../domain/acoustic-speaker";
import {
  downloadRemoteSpeakerModel,
  isRemoteSpeakerModelInstalled,
  SpeakerModelDownloadError,
  type PinnedModelFile,
  type RemoteModelSource,
} from "./speaker-model-store";

export const SPEAKER_MODEL_ASSET_MANIFEST = {
  modelId: ACOUSTIC_POLICY.modelId,
  revision: ACOUSTIC_POLICY.modelRevision,
  quantizedOnnxBytes: 101_683_453,
  quantizedOnnxSha256: "576bf6017796bdd179824d801b3a355a1dda2451559c6a398562175e33589f68",
  runtime: "wasm",
  dtype: "q8",
  wasmThreads: 1,
  transformersVersion: "4.3.2",
  calibrationStatus: "uncalibrated",
} as const;

const SPEAKER_ASSET_FILES = [
  { path: "model/wavlm-base-plus-sv/config.json", bytes: 58_609, sha256: "75efe37fb015f22d82af367dcef974c39119fa4c6505d16a82d86f604a431f4e" },
  { path: "model/wavlm-base-plus-sv/preprocessor_config.json", bytes: 215, sha256: "99272fe8ccfab114b68b478681ea47ee3a1ce62bb788cb92dd6e4f69fb1f1da2" },
  { path: "model/wavlm-base-plus-sv/quantize_config.json", bytes: 1_154, sha256: "b073ca6f0ade094cfa676150989f20dc15e1a5b40826f6f0aac85fa99626dbea" },
  { path: "model/wavlm-base-plus-sv/onnx/model_quantized.onnx", bytes: 101_683_453, sha256: "576bf6017796bdd179824d801b3a355a1dda2451559c6a398562175e33589f68" },
  { path: "runtime/ort-wasm-simd-threaded.asyncify.mjs", bytes: 53_057, sha256: "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611" },
  { path: "runtime/ort-wasm-simd-threaded.asyncify.wasm", bytes: 26_861_777, sha256: "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082" },
] as const;

const REMOTE_MODEL_DIRECTORY = "model/wavlm-base-plus-sv/";
/** Where the pinned weights may be fetched from at run time (after consent). */
export const SPEAKER_REMOTE_MODEL_SOURCE: RemoteModelSource = {
  host: "https://huggingface.co",
  repository: SPEAKER_MODEL_ASSET_MANIFEST.modelId,
  revision: SPEAKER_MODEL_ASSET_MANIFEST.revision,
};
export const SPEAKER_REMOTE_MODEL_FILES: PinnedModelFile[] = SPEAKER_ASSET_FILES.filter((file) =>
  file.path.startsWith(REMOTE_MODEL_DIRECTORY),
).map((file) => ({ path: file.path.slice(REMOTE_MODEL_DIRECTORY.length), bytes: file.bytes, sha256: file.sha256 }));

type ManifestMode = "ready" | "remote_model";

async function verifySpeakerAssetManifest(base: string, signal?: AbortSignal): Promise<ManifestMode> {
  const response = await fetch(`${base}speaker-assets/manifest.json`, { cache: "force-cache", credentials: "omit", signal });
  if (!response.ok) throw new SpeakerModelUnavailableError("The local speaker asset manifest is unavailable.");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new SpeakerModelUnavailableError("The local speaker asset manifest is invalid.");
  const manifest = value as { status?: unknown; deferred?: unknown; precache?: unknown; model?: Record<string, unknown>; runtime?: Record<string, unknown>; assets?: unknown; remoteModel?: Record<string, unknown> };
  const remote = manifest.status === "remote_model";
  if ((manifest.status !== "ready" && !remote) || manifest.deferred !== true || manifest.precache !== false) {
    throw new SpeakerModelUnavailableError("Verified local speaker assets are unavailable; prepare the pinned model before use.");
  }
  if (
    manifest.model?.id !== SPEAKER_MODEL_ASSET_MANIFEST.modelId ||
    manifest.model.revision !== SPEAKER_MODEL_ASSET_MANIFEST.revision ||
    manifest.model.dtype !== SPEAKER_MODEL_ASSET_MANIFEST.dtype ||
    manifest.runtime?.package !== "onnxruntime-web" ||
    manifest.runtime.version !== "1.31.0-dev.20260914-8d85527a0" ||
    manifest.runtime.backend !== SPEAKER_MODEL_ASSET_MANIFEST.runtime ||
    manifest.runtime.numThreads !== 1 ||
    !Array.isArray(manifest.assets)
  ) {
    throw new SpeakerModelUnavailableError("The local speaker asset manifest does not match the pinned runtime.");
  }
  if (
    remote &&
    (manifest.remoteModel?.host !== SPEAKER_REMOTE_MODEL_SOURCE.host ||
      manifest.remoteModel.repository !== SPEAKER_REMOTE_MODEL_SOURCE.repository ||
      manifest.remoteModel.revision !== SPEAKER_REMOTE_MODEL_SOURCE.revision)
  ) {
    throw new SpeakerModelUnavailableError("The speaker asset manifest names a model source that is not the pinned one.");
  }
  // A remote-model build ships only the runtime; the weights are fetched and verified here.
  const expectedFiles = remote ? SPEAKER_ASSET_FILES.filter((file) => file.path.startsWith("runtime/")) : SPEAKER_ASSET_FILES;
  const assets = manifest.assets as { path?: unknown; bytes?: unknown; sha256?: unknown }[];
  if (assets.length !== expectedFiles.length || assets.some((asset, index) => {
    const expected = expectedFiles[index];
    return !expected || asset.path !== `speaker-assets/${expected.path}` || asset.bytes !== expected.bytes || asset.sha256 !== expected.sha256;
  })) {
    throw new SpeakerModelUnavailableError("The local speaker asset manifest failed its pinned hash/size check.");
  }
  return remote ? "remote_model" : "ready";
}

export interface SpeakerModelProgress {
  status: string;
  loaded?: number;
  total?: number;
  file?: string;
}

export class SpeakerModelConsentRequiredError extends Error {
  constructor() {
    super("Local speaker model download requires explicit consent.");
    this.name = "SpeakerModelConsentRequiredError";
  }
}

export class SpeakerModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeakerModelUnavailableError";
  }
}

type ModelSource = "assets" | "remote-cache";
type WorkerRequest =
  | { type: "load"; requestId: number; modelPath: string; wasmPath: string; modelSource?: ModelSource }
  | { type: "embed"; requestId: number; samples: Float32Array; sampleRate: number }
  | { type: "dispose"; requestId: number };
type WorkerResponse =
  | { type: "progress"; requestId: number; status: string; loaded?: number; total?: number; file?: string }
  | { type: "ready"; requestId: number; modelId: string; modelRevision: string; transformersVersion: string }
  | { type: "embedding"; requestId: number; values: Float32Array }
  | { type: "error"; requestId: number; message: string; code: "model" | "input" | "inference" };
type WorkerBody =
  | { type: "load"; modelPath: string; wasmPath: string; modelSource?: ModelSource }
  | { type: "embed"; samples: Float32Array; sampleRate: number };

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
}

export interface BrowserSpeakerEmbeddingProvider {
  load(options: { consent: boolean; onProgress?: (progress: SpeakerModelProgress) => void; signal?: AbortSignal }): Promise<void>;
  embed(samples: Float32Array, sampleRate: number, signal?: AbortSignal): Promise<number[]>;
  dispose(): void;
}

/**
 * Main-thread handle for the pinned local WavLM worker. No vectors or audio
 * are logged, exported, sent to a provider, or put into the service-worker
 * cache by this class.
 */
export class WavLmSpeakerEmbeddingProvider implements BrowserSpeakerEmbeddingProvider {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending<unknown>>();
  private disposed = false;
  private loaded = false;
  private manifestVerified = false;
  private readonly modelPath: string;
  private readonly wasmPath: string;
  private readonly assetBase: string;
  private readonly shouldVerifyManifest: boolean;
  private readonly allowRemoteDownload: boolean;
  private modelSource: ModelSource = "assets";

  constructor(options: { modelPath?: string; wasmPath?: string; worker?: Worker; assetBase?: string; verifyManifest?: boolean; allowRemoteDownload?: boolean } = {}) {
    const base = import.meta.env.BASE_URL || "/";
    this.allowRemoteDownload = options.allowRemoteDownload ?? false;
    this.assetBase = options.assetBase ?? base;
    this.modelPath = options.modelPath ?? `${base}speaker-assets/model/`;
    this.wasmPath = options.wasmPath ?? `${base}speaker-assets/runtime/`;
    this.shouldVerifyManifest = options.verifyManifest ?? true;
    this.worker = options.worker ?? new Worker(new URL("./speaker-embedding.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onWorkerError);
  }

  async load(options: { consent: boolean; onProgress?: (progress: SpeakerModelProgress) => void; signal?: AbortSignal }): Promise<void> {
    if (!options.consent) throw new SpeakerModelConsentRequiredError();
    if (this.disposed) throw new SpeakerModelUnavailableError("Local speaker model provider is disposed.");
    if (this.loaded) return;
    if (this.shouldVerifyManifest && !this.manifestVerified) {
      const mode = await verifySpeakerAssetManifest(this.assetBase, options.signal);
      this.manifestVerified = true;
      this.modelSource = mode === "remote_model" ? "remote-cache" : "assets";
    }
    if (this.modelSource === "remote-cache") await this.ensureRemoteModel(options);
    const result = this.request<void>({ type: "load", modelPath: this.modelPath, wasmPath: this.wasmPath, modelSource: this.modelSource }, options.signal, options.onProgress);
    await result;
    this.loaded = true;
  }

  /**
   * The build ships only the runtime. Use the verified copy stored in this
   * browser, or (after the caller's explicit confirmation) download it from the
   * pinned host. Nothing is requested unless allowRemoteDownload was set.
   */
  private async ensureRemoteModel(options: { consent: boolean; onProgress?: (progress: SpeakerModelProgress) => void; signal?: AbortSignal }): Promise<void> {
    if (await isRemoteSpeakerModelInstalled(SPEAKER_REMOTE_MODEL_FILES, SPEAKER_REMOTE_MODEL_SOURCE)) return;
    if (!this.allowRemoteDownload) {
      throw new SpeakerModelUnavailableError("The speaker model has not been downloaded. Confirm the download in the voice matching dialog first.");
    }
    try {
      await downloadRemoteSpeakerModel({
        files: SPEAKER_REMOTE_MODEL_FILES,
        source: SPEAKER_REMOTE_MODEL_SOURCE,
        consent: options.consent,
        signal: options.signal,
        onProgress: (progress) => options.onProgress?.({ status: progress.status, loaded: progress.loaded, total: progress.total, file: progress.file }),
      });
    } catch (error) {
      if (error instanceof SpeakerModelDownloadError) {
        if (error.code === "aborted") throw options.signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
        throw new SpeakerModelUnavailableError(error.message);
      }
      throw error;
    }
  }

  async embed(samples: Float32Array, sampleRate: number, signal?: AbortSignal): Promise<number[]> {
    if (!this.loaded) throw new SpeakerModelUnavailableError("Load the local speaker model before inference.");
    if (samples.length < 1600 || sampleRate !== 16000) throw new SpeakerModelUnavailableError("Speaker inference requires 16 kHz PCM with at least 0.1 seconds.");
    const copy = new Float32Array(samples);
    const values = await this.request<Float32Array>({ type: "embed", samples: copy, sampleRate }, signal, undefined, [copy.buffer]);
    return normalizeEmbedding(Array.from(values), ACOUSTIC_POLICY.dimensions);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onWorkerError);
    for (const pending of this.pending.values()) pending.reject(new SpeakerModelUnavailableError("Local speaker model provider was disposed."));
    this.pending.clear();
    this.worker.terminate();
  }

  private readonly onMessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    if (response.type === "progress") {
      const pending = this.pending.get(response.requestId);
      if (pending) (pending as Pending<void> & { onProgress?: (progress: SpeakerModelProgress) => void }).onProgress?.(response);
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    if (response.type === "error") {
      pending.reject(new SpeakerModelUnavailableError(response.message));
      return;
    }
    if (response.type === "embedding") {
      pending.resolve(response.values);
      return;
    }
    if (
      response.modelId !== SPEAKER_MODEL_ASSET_MANIFEST.modelId ||
      response.modelRevision !== SPEAKER_MODEL_ASSET_MANIFEST.revision ||
      response.transformersVersion !== SPEAKER_MODEL_ASSET_MANIFEST.transformersVersion
    ) {
      pending.reject(new SpeakerModelUnavailableError("The local speaker worker reported an unexpected model runtime."));
      return;
    }
    pending.resolve(undefined);
  };

  private readonly onWorkerError = () => {
    const error = new SpeakerModelUnavailableError("The local speaker worker stopped unexpectedly.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.loaded = false;
  };

  private request<T>(
    body: WorkerBody,
    signal?: AbortSignal,
    onProgress?: (progress: SpeakerModelProgress) => void,
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new SpeakerModelUnavailableError("Local speaker model provider is disposed."));
    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const pending: Pending<T> & { onProgress?: (progress: SpeakerModelProgress) => void } = { resolve, reject, signal, onProgress };
      this.pending.set(requestId, pending as Pending<unknown>);
      const abort = () => {
        this.pending.delete(requestId);
        reject(signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      const request = { ...body, requestId } as WorkerRequest;
      try {
        this.worker.postMessage(request, transfer);
      } catch (error) {
        signal?.removeEventListener("abort", abort);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new SpeakerModelUnavailableError("Could not start local speaker inference."));
      }
    });
  }
}

