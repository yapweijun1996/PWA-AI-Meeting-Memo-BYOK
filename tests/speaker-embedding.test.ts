import { describe, expect, it, vi } from "vitest";
import { ACOUSTIC_POLICY } from "../src/domain/acoustic-speaker";
import {
  SpeakerModelConsentRequiredError,
  SpeakerModelUnavailableError,
  WavLmSpeakerEmbeddingProvider,
} from "../src/audio/speaker-embedding";

class FakeWorker extends EventTarget {
  postMessage(message: { type: string; requestId: number }, _transfer?: Transferable[]) {
    queueMicrotask(() => {
      if (message.type === "load") {
        this.dispatchEvent(new MessageEvent("message", { data: { type: "progress", requestId: message.requestId, status: "progress", loaded: 1, total: 1 } }));
        this.dispatchEvent(new MessageEvent("message", { data: { type: "ready", requestId: message.requestId, modelId: ACOUSTIC_POLICY.modelId, modelRevision: ACOUSTIC_POLICY.modelRevision, transformersVersion: "4.3.2" } }));
      } else if (message.type === "embed") {
        const values = new Float32Array(ACOUSTIC_POLICY.dimensions);
        values[0] = 1;
        this.dispatchEvent(new MessageEvent("message", { data: { type: "embedding", requestId: message.requestId, values } }));
      }
    });
  }
  terminate() { return undefined; }
}

describe("browser speaker model worker boundary", () => {
  it("requires explicit model consent and keeps progress separate from inference", async () => {
    const worker = new FakeWorker();
    const provider = new WavLmSpeakerEmbeddingProvider({ worker: worker as unknown as Worker, verifyManifest: false });
    await expect(provider.load({ consent: false })).rejects.toBeInstanceOf(SpeakerModelConsentRequiredError);
    const progress: string[] = [];
    await provider.load({ consent: true, onProgress: (value) => progress.push(value.status) });
    expect(progress).toEqual(["progress"]);
    const values = await provider.embed(new Float32Array(16000 * 2), 16000);
    expect(values).toHaveLength(ACOUSTIC_POLICY.dimensions);
    expect(values[0]).toBe(1);
    provider.dispose();
  });

  it("requires a ready pinned asset manifest before starting the worker", async () => {
    const worker = new FakeWorker();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "ready",
        deferred: true,
        precache: false,
        model: {
          id: ACOUSTIC_POLICY.modelId,
          revision: ACOUSTIC_POLICY.modelRevision,
          dtype: "q8",
        },
        runtime: {
          package: "onnxruntime-web",
          version: "1.31.0-dev.20260914-8d85527a0",
          backend: "wasm",
          numThreads: 1,
        },
        assets: [
          { path: "speaker-assets/model/wavlm-base-plus-sv/config.json", bytes: 58609, sha256: "75efe37fb015f22d82af367dcef974c39119fa4c6505d16a82d86f604a431f4e" },
          { path: "speaker-assets/model/wavlm-base-plus-sv/preprocessor_config.json", bytes: 215, sha256: "99272fe8ccfab114b68b478681ea47ee3a1ce62bb788cb92dd6e4f69fb1f1da2" },
          { path: "speaker-assets/model/wavlm-base-plus-sv/quantize_config.json", bytes: 1154, sha256: "b073ca6f0ade094cfa676150989f20dc15e1a5b40826f6f0aac85fa99626dbea" },
          { path: "speaker-assets/model/wavlm-base-plus-sv/onnx/model_quantized.onnx", bytes: 101683453, sha256: "576bf6017796bdd179824d801b3a355a1dda2451559c6a398562175e33589f68" },
          { path: "speaker-assets/runtime/ort-wasm-simd-threaded.asyncify.mjs", bytes: 53057, sha256: "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611" },
          { path: "speaker-assets/runtime/ort-wasm-simd-threaded.asyncify.wasm", bytes: 26861777, sha256: "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const provider = new WavLmSpeakerEmbeddingProvider({ worker: worker as unknown as Worker, assetBase: "/" });
      await provider.load({ consent: true });
      expect(fetchMock).toHaveBeenCalledWith("/speaker-assets/manifest.json", expect.objectContaining({ cache: "force-cache", credentials: "omit" }));
      provider.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not start inference when the deferred asset manifest is unavailable", async () => {
    const worker = new FakeWorker();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "unavailable", deferred: true, precache: false }) })));
    try {
      const provider = new WavLmSpeakerEmbeddingProvider({ worker: worker as unknown as Worker, assetBase: "/" });
      await expect(provider.load({ consent: true })).rejects.toBeInstanceOf(SpeakerModelUnavailableError);
      provider.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
