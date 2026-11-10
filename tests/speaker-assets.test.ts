/// <reference types="node" />

import { expect, it } from "vitest";
// The build scripts are intentionally plain Node ESM rather than application
// TypeScript; keep this test's small contract type explicit at the boundary.
// @ts-expect-error No declaration file is needed for the runtime-only script.
import * as speakerAssetsModule from "../scripts/speaker-assets.mjs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "/fixture/";

type AssetSpec = {
  path: string;
  sourceRelative: string;
  kind: string;
  bytes: number;
  sha256: string;
};

type SpeakerAssetsModule = {
  isAllowedSpeakerAssetPath: (value: string) => boolean;
  isDeferredSpeakerAsset: (value: string) => boolean;
  prepareSpeakerAssets: (options: {
    sourceDir: string;
    outputDir: string;
    basePath: string;
  }) => Promise<unknown>;
  replaceSpeakerAssetOutput: (options: {
    staging: string;
    outputDir: string;
    renameImpl: (from: string, to: string) => Promise<void>;
  }) => Promise<void>;
  SPEAKER_ASSET_MANIFEST_PATH: string;
  SPEAKER_ASSET_PROVENANCE: Record<string, string>;
  SPEAKER_ASSET_SPECS: readonly AssetSpec[];
  SPEAKER_MODEL: Record<string, string | number>;
  SPEAKER_RUNTIME: Record<string, string | number>;
  validateSpeakerAssetManifest: (
    value: unknown,
    options: { basePath: string; actualPaths?: readonly string[] },
  ) => unknown;
  writeUnavailableSpeakerManifest: (
    outputDir: string,
    basePath: string,
    message: string,
  ) => Promise<Record<string, unknown>>;
};

const {
  isAllowedSpeakerAssetPath,
  isDeferredSpeakerAsset,
  prepareSpeakerAssets,
  replaceSpeakerAssetOutput,
  SPEAKER_ASSET_MANIFEST_PATH,
  SPEAKER_ASSET_PROVENANCE,
  SPEAKER_ASSET_SPECS,
  SPEAKER_MODEL,
  SPEAKER_RUNTIME,
  validateSpeakerAssetManifest,
  writeUnavailableSpeakerManifest,
} = speakerAssetsModule as unknown as SpeakerAssetsModule;

function readyManifest() {
  return {
    schemaVersion: 1,
    status: "ready",
    deferred: true,
    precache: false,
    appBasePath: base,
    basePath: `${base}speaker-assets/`,
    model: { ...SPEAKER_MODEL },
    runtime: { ...SPEAKER_RUNTIME },
    assets: SPEAKER_ASSET_SPECS.map(({ path: assetPath, kind, bytes, sha256 }) => ({
      path: assetPath,
      kind,
      bytes,
      sha256,
    })),
    provenance: { ...SPEAKER_ASSET_PROVENANCE },
  };
}

it("keeps the speaker artifact allowlist exact and deferred", () => {
  expect(SPEAKER_ASSET_SPECS.length).toBe(6);
  for (const spec of SPEAKER_ASSET_SPECS) {
    expect(isAllowedSpeakerAssetPath(spec.path)).toBe(true);
    expect(isDeferredSpeakerAsset(spec.path)).toBe(true);
    expect(spec.bytes).toBeGreaterThan(0);
    expect(spec.sha256).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(isDeferredSpeakerAsset(SPEAKER_ASSET_MANIFEST_PATH)).toBe(false);
  expect(isAllowedSpeakerAssetPath("speaker-assets/runtime/extra.wasm")).toBe(false);
  expect(isAllowedSpeakerAssetPath("speaker-assets/../secrets.onnx")).toBe(false);
  expect(isAllowedSpeakerAssetPath("/speaker-assets/model/model_quantized.onnx")).toBe(
    false,
  );
});

it("rejects a tampered or incomplete ready manifest", () => {
  const tampered = readyManifest();
  tampered.assets[0] = { ...tampered.assets[0], sha256: "0".repeat(64) };
  expect(() =>
    validateSpeakerAssetManifest(tampered, {
      basePath: base,
      actualPaths: SPEAKER_ASSET_SPECS.map((spec) => spec.path),
    }),
  ).toThrow(/hash mismatch/i);

  const unknown = readyManifest();
  unknown.assets[0] = {
    ...unknown.assets[0],
    path: "speaker-assets/model/unknown.onnx",
  };
  expect(() => validateSpeakerAssetManifest(unknown, { basePath: base })).toThrow(
    /unknown speaker asset path/i,
  );

  const incomplete = readyManifest();
  incomplete.assets.pop();
  expect(() => validateSpeakerAssetManifest(incomplete, { basePath: base })).toThrow(
    /incomplete allowlist/i,
  );
});

it("accepts an explicit unavailable manifest without inventing a precache", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "speaker-assets-test-"));
  try {
    const manifest = await writeUnavailableSpeakerManifest(
      path.join(root, "dist", "speaker-assets"),
      base,
      "test source not prepared",
    );
    expect(manifest.status).toBe("unavailable");
    expect(manifest.assets).toEqual([]);
    validateSpeakerAssetManifest(manifest, { basePath: base, actualPaths: [] });
    expect(
      JSON.parse(
        await readFile(path.join(root, "dist", "speaker-assets", "manifest.json"), "utf8"),
      ).precache,
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects any unlisted deferred file before it can be cached or served", () => {
  expect(() =>
    validateSpeakerAssetManifest(
      {
        ...readyManifest(),
        assets: readyManifest().assets,
      },
      {
        basePath: base,
        actualPaths: [
          ...SPEAKER_ASSET_SPECS.map((spec) => spec.path),
          "speaker-assets/runtime/unlisted.wasm",
        ],
      },
    ),
  ).toThrow(/match the manifest allowlist/i);
});

it("does not mutate unsafe or unowned preparation targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "speaker-assets-safety-"));
  const source = path.join(root, "source");
  const unrelated = path.join(root, "unrelated");
  const owned = path.join(root, "speaker-assets");
  await mkdir(source, { recursive: true });
  await mkdir(unrelated, { recursive: true });
  await writeFile(path.join(unrelated, "sentinel.txt"), "keep me");
  await mkdir(owned, { recursive: true });
  await writeFile(path.join(owned, "sentinel.txt"), "keep me too");
  try {
    await expect(
      prepareSpeakerAssets({ sourceDir: source, outputDir: root, basePath: base }),
    ).rejects.toThrow(/unsafe speaker asset output/i);
    await expect(
      prepareSpeakerAssets({
        sourceDir: source,
        outputDir: path.join(source, "speaker-assets"),
        basePath: base,
      }),
    ).rejects.toThrow(/must not overlap/i);
    await expect(
      prepareSpeakerAssets({ sourceDir: source, outputDir: unrelated, basePath: base }),
    ).rejects.toThrow(/unsafe speaker asset output/i);
    await expect(
      prepareSpeakerAssets({ sourceDir: source, outputDir: owned, basePath: base }),
    ).rejects.toThrow(/without its generated manifest/i);
    expect(await readFile(path.join(unrelated, "sentinel.txt"), "utf8")).toBe(
      "keep me",
    );
    expect(await readFile(path.join(owned, "sentinel.txt"), "utf8")).toBe(
      "keep me too",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps the old generated set when its first rename fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "speaker-assets-rollback-"));
  const outputDir = path.join(root, "speaker-assets");
  const staging = path.join(root, "speaker-assets-stage-test");
  const oldManifest = JSON.stringify({ status: "unavailable", message: "old" });
  try {
    await mkdir(outputDir, { recursive: true });
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(outputDir, "manifest.json"), oldManifest);
    await writeFile(path.join(outputDir, "sentinel.txt"), "old generated set");
    await writeFile(path.join(staging, "manifest.json"), '{"status":"ready"}');

    const injectedRenameFailure = async () => {
      const error = new Error("injected rename failure") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    };
    await expect(
      replaceSpeakerAssetOutput({
        staging,
        outputDir,
        renameImpl: injectedRenameFailure,
      }),
    ).rejects.toThrow(/injected rename failure/i);
    expect(await readFile(path.join(outputDir, "manifest.json"), "utf8")).toBe(
      oldManifest,
    );
    expect(await readFile(path.join(outputDir, "sentinel.txt"), "utf8")).toBe(
      "old generated set",
    );
    expect(await readFile(path.join(staging, "manifest.json"), "utf8")).toBe(
      '{"status":"ready"}',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
