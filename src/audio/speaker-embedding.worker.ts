import {
  AutoModel,
  AutoProcessor,
  env,
} from "@huggingface/transformers";
import { ACOUSTIC_POLICY, normalizeEmbedding } from "../domain/acoustic-speaker";
import { SPEAKER_MODEL_CACHE_NAME, speakerModelCacheKey } from "./speaker-model-store";

const MODEL_ID = ACOUSTIC_POLICY.modelId;
const LOCAL_MODEL_ID = "wavlm-base-plus-sv";
const MODEL_REVISION = ACOUSTIC_POLICY.modelRevision;
const TRANSFORMERS_VERSION = "4.3.2";

type WorkerRequest =
  | { type: "load"; requestId: number; modelPath: string; wasmPath: string; modelSource?: "assets" | "remote-cache" }
  | { type: "embed"; requestId: number; samples: Float32Array; sampleRate: number }
  | { type: "dispose"; requestId: number };

type WorkerResponse =
  | { type: "progress"; requestId: number; status: string; loaded?: number; total?: number; file?: string }
  | { type: "ready"; requestId: number; modelId: string; modelRevision: string; transformersVersion: string }
  | { type: "embedding"; requestId: number; values: Float32Array }
  | { type: "error"; requestId: number; message: string; code: "model" | "input" | "inference" };
const workerScope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
};

let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | undefined;
let model: Awaited<ReturnType<typeof AutoModel.from_pretrained>> | undefined;
let loading: Promise<void> | undefined;

function reply(message: WorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

/**
 * Serve model files that the page already downloaded and verified (SHA-256) from
 * the app-scoped cache, so loading needs no network and no same-origin model URL.
 * Transformers.js asks for "<localModelPath>/wavlm-base-plus-sv/<file>".
 */
async function matchRemoteCache(key: string): Promise<Response | undefined> {
  const marker = `/${LOCAL_MODEL_ID}/`;
  const text = String(key);
  const index = text.lastIndexOf(marker);
  if (index < 0) return undefined;
  const relative = text.slice(index + marker.length).split("?")[0];
  if (!relative) return undefined;
  const cache = await caches.open(SPEAKER_MODEL_CACHE_NAME);
  return cache.match(speakerModelCacheKey(MODEL_REVISION, relative));
}

async function ensureLoaded(
  requestId: number,
  modelPath: string,
  wasmPath: string,
  modelSource: "assets" | "remote-cache" = "assets",
): Promise<void> {
  if (processor && model) return;
  loading ??= (async () => {
    // Keep all runtime assets local and pinned. The app must explicitly stage
    // the approved model/runtime assets before this worker is started.
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.cacheKey = "meeting-memo-byok-speaker-model-v1";
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.experimental_useCrossOriginStorage = false;
    env.localModelPath = modelPath.endsWith("/") ? modelPath : `${modelPath}/`;
    if (modelSource === "remote-cache") {
      env.useCustomCache = true;
      env.customCache = {
        match: matchRemoteCache,
        // Nothing is fetched by Transformers.js in this mode, so nothing is written either.
        put: async () => undefined,
      };
    }
    const wasm = env.backends.onnx.wasm;
    if (!wasm) throw new Error("The bundled ONNX WASM backend is unavailable.");
    const wasmBase = wasmPath.endsWith("/") ? wasmPath : `${wasmPath}/`;
    // Transformers.js only uses its browser WASM cache when both concrete
    // module URLs are supplied. A directory string falls through to the
    // package's default CDN resolver on a later offline reload.
    wasm.wasmPaths = {
      mjs: `${wasmBase}ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${wasmBase}ort-wasm-simd-threaded.asyncify.wasm`,
    };
    wasm.numThreads = 1;
    const progress_callback = (value: { status?: string; loaded?: number; total?: number; file?: string }) => {
      reply({
        type: "progress",
        requestId,
        status: value.status ?? "loading",
        loaded: value.loaded,
        total: value.total,
        file: value.file,
      });
    };
    try {
      processor = await AutoProcessor.from_pretrained(LOCAL_MODEL_ID, {
        revision: MODEL_REVISION,
        progress_callback,
      });
      model = await AutoModel.from_pretrained(LOCAL_MODEL_ID, {
        revision: MODEL_REVISION,
        dtype: "q8",
        device: "wasm",
        progress_callback,
      });
    } catch (error) {
      processor = undefined;
      model = undefined;
      throw new Error(
        error instanceof Error
          ? `Local speaker model is unavailable: ${error.message}`
          : "Local speaker model is unavailable.",
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  })();
  try {
    await loading;
  } finally {
    loading = undefined;
  }
}

workerScope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === "dispose") {
        processor = undefined;
        model = undefined;
        reply({ type: "ready", requestId: request.requestId, modelId: MODEL_ID, modelRevision: MODEL_REVISION, transformersVersion: TRANSFORMERS_VERSION });
        return;
      }
      if (request.type === "load") {
        await ensureLoaded(request.requestId, request.modelPath, request.wasmPath, request.modelSource);
        reply({ type: "ready", requestId: request.requestId, modelId: MODEL_ID, modelRevision: MODEL_REVISION, transformersVersion: TRANSFORMERS_VERSION });
        return;
      }
      if (!processor || !model) throw new Error("The local speaker model has not been loaded.");
      if (request.sampleRate !== 16000 || request.samples.length < 1600 || request.samples.some((value) => !Number.isFinite(value))) {
        reply({ type: "error", requestId: request.requestId, code: "input", message: "Speaker inference requires finite 16 kHz PCM with at least 0.1 seconds." });
        return;
      }
      const inputs = await processor(request.samples);
      const output = await model(inputs);
      const raw = output.embeddings?.data;
      if (!raw || raw.length !== ACOUSTIC_POLICY.dimensions) throw new Error("The local speaker model returned an unexpected embedding.");
      const values = Float32Array.from(normalizeEmbedding(Array.from(raw), ACOUSTIC_POLICY.dimensions));
      reply({ type: "embedding", requestId: request.requestId, values }, [values.buffer]);
    } catch (error) {
      reply({
        type: "error",
        requestId: request.requestId,
        code: request.type === "load" ? "model" : "inference",
        message: error instanceof Error ? error.message : "Local speaker inference failed.",
      });
    }
  })();
});

