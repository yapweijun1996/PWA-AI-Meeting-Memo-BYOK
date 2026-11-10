import { describe, expect, it, vi } from "vitest";
import {
  deleteRemoteSpeakerModel,
  downloadRemoteSpeakerModel,
  isRemoteSpeakerModelInstalled,
  remoteSpeakerModelUrl,
  SPEAKER_MODEL_CACHE_NAME,
  speakerModelCacheKey,
  SpeakerModelDownloadError,
  type PinnedModelFile,
  type RemoteModelSource,
  type SpeakerModelDownloadProgress,
} from "../src/audio/speaker-model-store";

const source: RemoteModelSource = { host: "https://huggingface.co", repository: "Xenova/wavlm-base-plus-sv", revision: "rev123" };

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

const contents: Record<string, Uint8Array> = {
  "config.json": new TextEncoder().encode('{"model_type":"wavlm"}'),
  "onnx/model.onnx": Uint8Array.from({ length: 5000 }, (_, index) => index % 251),
};

async function pinned(overrides: Partial<Record<string, Partial<PinnedModelFile>>> = {}): Promise<PinnedModelFile[]> {
  return Promise.all(
    Object.entries(contents).map(async ([path, bytes]) => ({
      path,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
      ...overrides[path],
    })),
  );
}

/** In-memory stand-in for CacheStorage with the same put/match/delete behaviour the module uses. */
function fakeCacheStorage(options: { failPutFor?: string } = {}) {
  const stores = new Map<string, Map<string, { body: Uint8Array; headers: Headers }>>();
  const storage = {
    async open(name: string) {
      const entries = stores.get(name) ?? new Map();
      stores.set(name, entries);
      return {
        async match(key: string) {
          const hit = entries.get(key);
          return hit ? new Response(hit.body.slice(), { headers: hit.headers }) : undefined;
        },
        async put(key: string, response: Response) {
          if (options.failPutFor && key.endsWith(options.failPutFor)) throw new DOMException("full", "QuotaExceededError");
          entries.set(key, { body: new Uint8Array(await response.arrayBuffer()), headers: new Headers(response.headers) });
        },
        async delete(key: string) {
          return entries.delete(key);
        },
      };
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  return { storage: storage as unknown as CacheStorage, stores };
}

function streamOf(bytes: Uint8Array, chunk = 700): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

function serving(map: Record<string, Uint8Array | number>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const entry = Object.entries(map).find(([path]) => url.endsWith(`/${path}`));
    if (!entry) return new Response("missing", { status: 404 });
    const [, value] = entry;
    if (typeof value === "number") return new Response("nope", { status: value });
    return new Response(streamOf(value));
  });
}

describe("downloading the pinned speaker model from its host", () => {
  it("builds the request URL only from the pinned source", () => {
    expect(remoteSpeakerModelUrl(source, "onnx/model.onnx")).toBe("https://huggingface.co/Xenova/wavlm-base-plus-sv/resolve/rev123/onnx/model.onnx");
    expect(speakerModelCacheKey("rev123", "config.json")).toBe("https://speaker-model.invalid/rev123/config.json");
  });

  it("sends nothing without consent", async () => {
    const fetchImpl = serving({});
    const { storage } = fakeCacheStorage();
    await expect(
      downloadRemoteSpeakerModel({ files: await pinned(), source, consent: false, fetchImpl, cacheStorage: storage }),
    ).rejects.toMatchObject({ code: "consent" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads, verifies, stores and reports progress; requests carry no credentials or referrer", async () => {
    const files = await pinned();
    const fetchImpl = serving(contents);
    const { storage } = fakeCacheStorage();
    const progress: SpeakerModelDownloadProgress[] = [];
    await downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl, cacheStorage: storage, onProgress: (p) => progress.push(p) });
    expect(await isRemoteSpeakerModelInstalled(files, source, storage)).toBe(true);
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    expect(progress.at(-1)).toMatchObject({ status: "ready", loaded: total, total });
    expect(progress.some((p) => p.status === "verify")).toBe(true);
    for (const call of fetchImpl.mock.calls) {
      expect(String(call[0]).startsWith("https://huggingface.co/Xenova/wavlm-base-plus-sv/resolve/rev123/")).toBe(true);
      expect(call[1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", method: "GET" });
    }
    // The stored copy is byte-identical and carries its pinned size.
    const cache = await storage.open(SPEAKER_MODEL_CACHE_NAME);
    const stored = await cache.match(speakerModelCacheKey("rev123", "onnx/model.onnx"));
    expect(stored?.headers.get("content-length")).toBe(String(contents["onnx/model.onnx"]!.byteLength));
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(contents["onnx/model.onnx"]);
  });

  it("discards a file whose SHA-256 does not match and never reports the model installed", async () => {
    const files = await pinned({ "onnx/model.onnx": { sha256: "0".repeat(64) } });
    const { storage } = fakeCacheStorage();
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving(contents), cacheStorage: storage }),
    ).rejects.toMatchObject({ code: "integrity" });
    expect(await isRemoteSpeakerModelInstalled(files, source, storage)).toBe(false);
    const cache = await storage.open(SPEAKER_MODEL_CACHE_NAME);
    expect(await cache.match(speakerModelCacheKey("rev123", "onnx/model.onnx"))).toBeUndefined();
  });

  it("rejects data that is larger or smaller than the pinned size", async () => {
    const files = await pinned();
    const bigger = { ...contents, "onnx/model.onnx": new Uint8Array(contents["onnx/model.onnx"]!.byteLength + 10) };
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving(bigger), cacheStorage: fakeCacheStorage().storage }),
    ).rejects.toMatchObject({ code: "integrity" });
    const smaller = { ...contents, "onnx/model.onnx": contents["onnx/model.onnx"]!.slice(0, 100) };
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving(smaller), cacheStorage: fakeCacheStorage().storage }),
    ).rejects.toMatchObject({ code: "integrity" });
  });

  it("separates a removed revision (remote) from a transient host failure (network)", async () => {
    const files = await pinned();
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving({ "config.json": 404 }), cacheStorage: fakeCacheStorage().storage }),
    ).rejects.toMatchObject({ code: "remote" });
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving({ "config.json": 503 }), cacheStorage: fakeCacheStorage().storage }),
    ).rejects.toMatchObject({ code: "network" });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: offline as unknown as typeof fetch, cacheStorage: fakeCacheStorage().storage }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("keeps verified files and skips them on the next attempt", async () => {
    const files = await pinned();
    const { storage } = fakeCacheStorage();
    // The large file fails; the small config file was already verified and stored.
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving({ ...contents, "onnx/model.onnx": 503 }), cacheStorage: storage }),
    ).rejects.toMatchObject({ code: "network" });
    expect(await isRemoteSpeakerModelInstalled(files, source, storage)).toBe(false);
    const second = serving(contents);
    await downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: second, cacheStorage: storage });
    expect(second.mock.calls.map((call) => String(call[0]).split("/resolve/rev123/")[1])).toEqual(["onnx/model.onnx"]);
    expect(await isRemoteSpeakerModelInstalled(files, source, storage)).toBe(true);
  });

  it("reports a full browser store as quota and stores nothing for that file", async () => {
    const files = await pinned();
    const { storage } = fakeCacheStorage({ failPutFor: "onnx/model.onnx" });
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving(contents), cacheStorage: storage }),
    ).rejects.toMatchObject({ code: "quota" });
    expect(await isRemoteSpeakerModelInstalled(files, source, storage)).toBe(false);
  });

  it("stops promptly when the caller aborts", async () => {
    const files = await pinned();
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = serving(contents);
    await expect(
      downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl, cacheStorage: fakeCacheStorage().storage, signal: controller.signal }),
    ).rejects.toBeInstanceOf(SpeakerModelDownloadError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deletes only its own cache", async () => {
    const files = await pinned();
    const { storage, stores } = fakeCacheStorage();
    await downloadRemoteSpeakerModel({ files, source, consent: true, fetchImpl: serving(contents), cacheStorage: storage });
    await (await storage.open("someone-elses-cache")).put("k", new Response("v"));
    expect(await deleteRemoteSpeakerModel(storage)).toBe(true);
    expect(stores.has(SPEAKER_MODEL_CACHE_NAME)).toBe(false);
    expect(stores.has("someone-elses-cache")).toBe(true);
    expect(await isRemoteSpeakerModelInstalled(files, source, storage)).toBe(false);
  });
});
