import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACOUSTIC_POLICY } from "../src/domain/acoustic-speaker";

const store = vi.hoisted(() => ({
  installed: false,
  download: vi.fn(),
}));

vi.mock("../src/audio/speaker-model-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/audio/speaker-model-store")>();
  return {
    ...actual,
    isRemoteSpeakerModelInstalled: vi.fn(async () => store.installed),
    downloadRemoteSpeakerModel: store.download,
  };
});

const {
  SPEAKER_REMOTE_MODEL_FILES,
  SPEAKER_REMOTE_MODEL_SOURCE,
  SpeakerModelUnavailableError,
  WavLmSpeakerEmbeddingProvider,
} = await import("../src/audio/speaker-embedding");
const { SpeakerModelDownloadError } = await import("../src/audio/speaker-model-store");

class RecordingWorker extends EventTarget {
  readonly messages: { type: string; modelSource?: string }[] = [];
  postMessage(message: { type: string; requestId: number; modelSource?: string }) {
    this.messages.push(message);
    queueMicrotask(() => {
      if (message.type === "load") {
        this.dispatchEvent(new MessageEvent("message", { data: { type: "ready", requestId: message.requestId, modelId: ACOUSTIC_POLICY.modelId, modelRevision: ACOUSTIC_POLICY.modelRevision, transformersVersion: "4.3.2" } }));
      }
    });
  }
  terminate() { return undefined; }
}

const runtimeAssets = [
  { path: "speaker-assets/runtime/ort-wasm-simd-threaded.asyncify.mjs", bytes: 53057, sha256: "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611" },
  { path: "speaker-assets/runtime/ort-wasm-simd-threaded.asyncify.wasm", bytes: 26861777, sha256: "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082" },
];

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    status: "remote_model",
    deferred: true,
    precache: false,
    model: { id: ACOUSTIC_POLICY.modelId, revision: ACOUSTIC_POLICY.modelRevision, dtype: "q8" },
    runtime: { package: "onnxruntime-web", version: "1.31.0-dev.20260914-8d85527a0", backend: "wasm", numThreads: 1 },
    remoteModel: { ...SPEAKER_REMOTE_MODEL_SOURCE },
    assets: runtimeAssets,
    ...overrides,
  };
}

function useManifest(value: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => value })));
}

describe("speaker model that ships only the runtime (remote_model build)", () => {
  beforeEach(() => {
    store.installed = false;
    store.download.mockReset();
    vi.unstubAllGlobals();
  });

  it("does not download unless the caller explicitly allowed it", async () => {
    useManifest(manifest());
    const worker = new RecordingWorker();
    const provider = new WavLmSpeakerEmbeddingProvider({ worker: worker as unknown as Worker, assetBase: "/" });
    await expect(provider.load({ consent: true })).rejects.toThrow(/has not been downloaded/);
    expect(store.download).not.toHaveBeenCalled();
    expect(worker.messages.some((message) => message.type === "load")).toBe(false);
    provider.dispose();
  });

  it("downloads the pinned files after confirmation, forwards progress, then loads from the cache", async () => {
    useManifest(manifest());
    store.download.mockImplementation(async (options: { onProgress?: (p: { status: string; loaded: number; total: number; file: string }) => void }) => {
      options.onProgress?.({ status: "download", loaded: 10, total: 100, file: "onnx/model_quantized.onnx" });
    });
    const worker = new RecordingWorker();
    const provider = new WavLmSpeakerEmbeddingProvider({ worker: worker as unknown as Worker, assetBase: "/", allowRemoteDownload: true });
    const seen: number[] = [];
    await provider.load({ consent: true, onProgress: (progress) => seen.push(progress.loaded ?? -1) });
    expect(store.download).toHaveBeenCalledWith(expect.objectContaining({ consent: true, files: SPEAKER_REMOTE_MODEL_FILES, source: SPEAKER_REMOTE_MODEL_SOURCE }));
    expect(seen).toContain(10);
    expect(worker.messages.find((message) => message.type === "load")?.modelSource).toBe("remote-cache");
    provider.dispose();
  });

  it("uses a stored verified model without any download", async () => {
    useManifest(manifest());
    store.installed = true;
    const worker = new RecordingWorker();
    const provider = new WavLmSpeakerEmbeddingProvider({ worker: worker as unknown as Worker, assetBase: "/", allowRemoteDownload: true });
    await provider.load({ consent: true });
    expect(store.download).not.toHaveBeenCalled();
    expect(worker.messages.find((message) => message.type === "load")?.modelSource).toBe("remote-cache");
    provider.dispose();
  });

  it("pins only the model files (not the runtime) to the host and names the pinned revision", () => {
    expect(SPEAKER_REMOTE_MODEL_SOURCE).toEqual({ host: "https://huggingface.co", repository: "Xenova/wavlm-base-plus-sv", revision: ACOUSTIC_POLICY.modelRevision });
    expect(SPEAKER_REMOTE_MODEL_FILES.map((file) => file.path).sort()).toEqual(["config.json", "onnx/model_quantized.onnx", "preprocessor_config.json", "quantize_config.json"]);
  });

  it("refuses a manifest that names another model source or other runtime files", async () => {
    for (const bad of [
      manifest({ remoteModel: { ...SPEAKER_REMOTE_MODEL_SOURCE, revision: "deadbeef" } }),
      manifest({ remoteModel: { ...SPEAKER_REMOTE_MODEL_SOURCE, host: "https://example.com" } }),
      manifest({ assets: [runtimeAssets[0]] }),
      manifest({ assets: [{ ...runtimeAssets[0], sha256: "f".repeat(64) }, runtimeAssets[1]] }),
    ]) {
      useManifest(bad);
      const provider = new WavLmSpeakerEmbeddingProvider({ worker: new RecordingWorker() as unknown as Worker, assetBase: "/", allowRemoteDownload: true });
      await expect(provider.load({ consent: true })).rejects.toBeInstanceOf(SpeakerModelUnavailableError);
      provider.dispose();
    }
    expect(store.download).not.toHaveBeenCalled();
  });

  it("turns a failed download into a clear unavailable error and keeps abort as an abort", async () => {
    useManifest(manifest());
    store.download.mockRejectedValueOnce(new SpeakerModelDownloadError("integrity", "does not match its pinned SHA-256"));
    const provider = new WavLmSpeakerEmbeddingProvider({ worker: new RecordingWorker() as unknown as Worker, assetBase: "/", allowRemoteDownload: true });
    await expect(provider.load({ consent: true })).rejects.toThrow(/pinned SHA-256/);
    provider.dispose();

    store.download.mockRejectedValueOnce(new SpeakerModelDownloadError("aborted", "cancelled"));
    const second = new WavLmSpeakerEmbeddingProvider({ worker: new RecordingWorker() as unknown as Worker, assetBase: "/", allowRemoteDownload: true });
    await expect(second.load({ consent: true })).rejects.toMatchObject({ name: "AbortError" });
    second.dispose();
  });
});
