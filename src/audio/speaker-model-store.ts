/**
 * Run-time download of the pinned speaker model from its host (route B in
 * docs/SPEAKER-MODEL-DOWNLOAD-DESIGN.md). The app does not host the weights.
 *
 * Rules enforced here:
 * - nothing is requested without explicit consent;
 * - every byte comes from a URL built from pinned constants (never a remote manifest);
 * - a file is stored only after its size and SHA-256 match the pinned values;
 * - partial or mismatching data is never stored or used;
 * - the cache is app-scoped and can be deleted without touching other storage.
 * No recording, transcript, vector or key is ever sent by this module.
 */

export const SPEAKER_MODEL_CACHE_NAME = "meeting-memo-byok-speaker-model-remote-v1";

export interface PinnedModelFile {
  /** Path inside the model repository, for example "onnx/model_quantized.onnx". */
  path: string;
  bytes: number;
  sha256: string;
}

export interface RemoteModelSource {
  host: string;
  repository: string;
  revision: string;
}

export type SpeakerModelDownloadErrorCode =
  | "consent"
  | "network"
  | "remote"
  | "integrity"
  | "quota"
  | "aborted";

export class SpeakerModelDownloadError extends Error {
  readonly code: SpeakerModelDownloadErrorCode;
  constructor(code: SpeakerModelDownloadErrorCode, message: string) {
    super(message);
    this.name = "SpeakerModelDownloadError";
    this.code = code;
  }
}

export interface SpeakerModelDownloadProgress {
  status: "download" | "verify" | "ready";
  file: string;
  /** Bytes received so far across all files. */
  loaded: number;
  /** Total bytes of all pinned files. */
  total: number;
}

/** Cache key for a stored file. The reserved .invalid host can never resolve. */
export function speakerModelCacheKey(revision: string, relativePath: string): string {
  return `https://speaker-model.invalid/${revision}/${relativePath}`;
}

export function remoteSpeakerModelUrl(source: RemoteModelSource, relativePath: string): string {
  const host = source.host.replace(/\/+$/, "");
  return `${host}/${source.repository}/resolve/${source.revision}/${relativePath}`;
}

type CacheStorageLike = Pick<CacheStorage, "open" | "delete">;

function contentTypeFor(path: string): string {
  return path.endsWith(".json") ? "application/json" : "application/octet-stream";
}

async function defaultDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** True when every pinned file is stored (size recorded at store time matches). */
export async function isRemoteSpeakerModelInstalled(
  files: readonly PinnedModelFile[],
  source: RemoteModelSource,
  cacheStorage: CacheStorageLike = caches,
): Promise<boolean> {
  try {
    const cache = await cacheStorage.open(SPEAKER_MODEL_CACHE_NAME);
    for (const file of files) {
      const hit = await cache.match(speakerModelCacheKey(source.revision, file.path));
      if (!hit || hit.headers.get("content-length") !== String(file.bytes)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Remove the downloaded model. Returns true when something was removed. */
export async function deleteRemoteSpeakerModel(cacheStorage: CacheStorageLike = caches): Promise<boolean> {
  return cacheStorage.delete(SPEAKER_MODEL_CACHE_NAME);
}

export interface DownloadRemoteSpeakerModelOptions {
  files: readonly PinnedModelFile[];
  source: RemoteModelSource;
  consent: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: SpeakerModelDownloadProgress) => void;
  fetchImpl?: typeof fetch;
  cacheStorage?: CacheStorageLike;
  digest?: (bytes: ArrayBuffer) => Promise<string>;
}

function failureFor(status: number): SpeakerModelDownloadError {
  // The pinned revision or file is gone, or access was refused: not retryable by waiting.
  if (status === 401 || status === 403 || status === 404 || status === 410) {
    return new SpeakerModelDownloadError(
      "remote",
      `The model host refused the pinned file (HTTP ${status}). The pinned revision may have been removed; use the documented local preparation route.`,
    );
  }
  return new SpeakerModelDownloadError("network", `The model host returned HTTP ${status}. Try again later.`);
}

/**
 * Download, verify and store the pinned files. Files already stored are kept and
 * skipped, so an interrupted run resumes at the next missing file. A single file
 * restarts from its first byte if it was interrupted.
 */
export async function downloadRemoteSpeakerModel(options: DownloadRemoteSpeakerModelOptions): Promise<void> {
  if (!options.consent) {
    throw new SpeakerModelDownloadError("consent", "Downloading the speaker model requires explicit consent.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheStorage = options.cacheStorage ?? caches;
  const digest = options.digest ?? defaultDigest;
  const cache = await cacheStorage.open(SPEAKER_MODEL_CACHE_NAME);
  const total = options.files.reduce((sum, file) => sum + file.bytes, 0);
  let loaded = 0;
  const report = (status: SpeakerModelDownloadProgress["status"], file: string) =>
    options.onProgress?.({ status, file, loaded, total });

  // Small files first so a missing revision fails before the large transfer.
  const ordered = [...options.files].sort((a, b) => a.bytes - b.bytes);
  for (const file of ordered) {
    if (options.signal?.aborted) throw new SpeakerModelDownloadError("aborted", "The model download was cancelled.");
    const key = speakerModelCacheKey(options.source.revision, file.path);
    const existing = await cache.match(key);
    if (existing && existing.headers.get("content-length") === String(file.bytes)) {
      loaded += file.bytes;
      report("download", file.path);
      continue;
    }
    let response: Response;
    try {
      response = await fetchImpl(remoteSpeakerModelUrl(options.source, file.path), {
        method: "GET",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new SpeakerModelDownloadError("aborted", "The model download was cancelled.");
      throw new SpeakerModelDownloadError(
        "network",
        `Could not reach the model host: ${error instanceof Error ? error.message : "network error"}`,
      );
    }
    if (!response.ok || !response.body) throw failureFor(response.status);

    // Write straight into one pre-sized buffer: no second copy of the large file.
    const buffer = new Uint8Array(file.bytes);
    let received = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.byteLength > file.bytes) {
          await reader.cancel().catch(() => undefined);
          throw new SpeakerModelDownloadError(
            "integrity",
            `The model file ${file.path} is larger than the pinned size; nothing was stored.`,
          );
        }
        buffer.set(value, received);
        received += value.byteLength;
        loaded += value.byteLength;
        report("download", file.path);
      }
    } catch (error) {
      if (error instanceof SpeakerModelDownloadError) throw error;
      if (options.signal?.aborted) throw new SpeakerModelDownloadError("aborted", "The model download was cancelled.");
      throw new SpeakerModelDownloadError(
        "network",
        `The model download was interrupted: ${error instanceof Error ? error.message : "network error"}`,
      );
    }
    if (received !== file.bytes) {
      throw new SpeakerModelDownloadError(
        "integrity",
        `The model file ${file.path} is smaller than the pinned size; nothing was stored.`,
      );
    }
    report("verify", file.path);
    const actual = await digest(buffer.buffer as ArrayBuffer);
    if (actual !== file.sha256) {
      throw new SpeakerModelDownloadError(
        "integrity",
        `The model file ${file.path} does not match its pinned SHA-256; it was discarded.`,
      );
    }
    try {
      await cache.put(
        key,
        new Response(buffer, {
          headers: {
            "content-type": contentTypeFor(file.path),
            "content-length": String(file.bytes),
          },
        }),
      );
    } catch (error) {
      await cache.delete(key).catch(() => undefined);
      const quota = error instanceof DOMException && error.name === "QuotaExceededError";
      throw new SpeakerModelDownloadError(
        quota ? "quota" : "network",
        quota
          ? "There is not enough browser storage for the speaker model."
          : `The model could not be stored: ${error instanceof Error ? error.message : "storage error"}`,
      );
    }
  }
  report("ready", "");
}
