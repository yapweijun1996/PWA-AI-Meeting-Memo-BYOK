/// <reference types="node" />

import { expect, it } from "vitest";
// @ts-expect-error The build scripts are plain Node ESM without declarations.
import * as speakerAssetsModule from "../scripts/speaker-assets.mjs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type Asset = { path: string; kind: string; bytes: number; sha256: string };
type Module = {
  findInstalledOnnxRuntimeDist: (startDir?: string) => Promise<string | undefined>;
  prepareRuntimeSpeakerAssets: (options: { runtimeDir: string; outputDir: string; basePath: string }) => Promise<Record<string, unknown> & { assets: Asset[] }>;
  validateSpeakerAssetManifest: (value: unknown, options: { basePath: string; actualPaths?: readonly string[] }) => unknown;
  verifyPreparedSpeakerAssets: (rootDir: string, manifest: unknown) => Promise<void>;
  SPEAKER_REMOTE_MODEL: { host: string; repository: string; revision: string };
  SPEAKER_ASSET_SPECS: readonly Asset[];
};
const {
  findInstalledOnnxRuntimeDist,
  prepareRuntimeSpeakerAssets,
  validateSpeakerAssetManifest,
  verifyPreparedSpeakerAssets,
  SPEAKER_REMOTE_MODEL,
  SPEAKER_ASSET_SPECS,
} = speakerAssetsModule as unknown as Module;

const base = "/fixture/";
const runtimePaths = SPEAKER_ASSET_SPECS.filter((spec) => spec.kind.startsWith("runtime-")).map((spec) => spec.path);

async function preparedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "speaker-runtime-"));
  const runtimeDir = await findInstalledOnnxRuntimeDist(process.cwd());
  if (!runtimeDir) throw new Error("onnxruntime-web must be installed for this test");
  const outputDir = path.join(root, "dist", "speaker-assets");
  const manifest = await prepareRuntimeSpeakerAssets({ runtimeDir, outputDir, basePath: base });
  return { root, runtimeDir, outputDir, manifest };
}

it("prepares only the pinned runtime from the installed package and names the remote weights", async () => {
  const { root, outputDir, manifest } = await preparedFixture();
  try {
    expect(manifest.status).toBe("remote_model");
    expect(manifest.remoteModel).toEqual(SPEAKER_REMOTE_MODEL);
    expect(manifest.assets.map((asset) => asset.path).sort()).toEqual([...runtimePaths].sort());
    // No model weights are shipped.
    const files = (await readdir(path.join(outputDir, "runtime"))).sort();
    expect(files).toEqual(["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]);
    await expect(readdir(path.join(outputDir, "model"))).rejects.toThrow();
    const written = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    expect(written.precache).toBe(false);
    await verifyPreparedSpeakerAssets(path.join(root, "dist"), written);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("refuses to install runtime files that differ from the pinned hashes and leaves no output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "speaker-runtime-bad-"));
  try {
    const runtimeDir = path.join(root, "ort");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(path.join(runtimeDir, "ort-wasm-simd-threaded.asyncify.mjs"), "tampered");
    await writeFile(path.join(runtimeDir, "ort-wasm-simd-threaded.asyncify.wasm"), "tampered");
    const outputDir = path.join(root, "dist", "speaker-assets");
    await expect(prepareRuntimeSpeakerAssets({ runtimeDir, outputDir, basePath: base })).rejects.toThrow(/byte count|hash/i);
    await expect(readdir(outputDir)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("validates the remote_model manifest strictly", async () => {
  const { root, manifest } = await preparedFixture();
  try {
    expect(() => validateSpeakerAssetManifest(manifest, { basePath: base, actualPaths: runtimePaths })).not.toThrow();
    const without = { ...manifest } as Record<string, unknown>;
    delete without.remoteModel;
    expect(() => validateSpeakerAssetManifest(without, { basePath: base, actualPaths: runtimePaths })).toThrow(/remoteModel/);
    expect(() => validateSpeakerAssetManifest({ ...manifest, remoteModel: { ...SPEAKER_REMOTE_MODEL, revision: "other" } }, { basePath: base, actualPaths: runtimePaths })).toThrow(/pinned/);
    expect(() => validateSpeakerAssetManifest({ ...manifest, remoteModel: { ...SPEAKER_REMOTE_MODEL, host: "https://example.com" } }, { basePath: base, actualPaths: runtimePaths })).toThrow(/pinned/);
    // A model file listed or present in a remote_model build is rejected.
    const model = SPEAKER_ASSET_SPECS.find((spec) => spec.kind === "model-onnx")!;
    expect(() => validateSpeakerAssetManifest({ ...manifest, assets: [...manifest.assets, model] }, { basePath: base })).toThrow(/allowlist/);
    expect(() => validateSpeakerAssetManifest(manifest, { basePath: base, actualPaths: [...runtimePaths, model.path] })).toThrow(/manifest allowlist/);
    expect(() => validateSpeakerAssetManifest(manifest, { basePath: base, actualPaths: [runtimePaths[0]!] })).toThrow(/manifest allowlist/);
    expect(() => validateSpeakerAssetManifest({ ...manifest, status: "nonsense" }, { basePath: base })).toThrow(/status/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
