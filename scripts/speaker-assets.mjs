import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

/**
 * The browser probe proved this exact, quantized model/runtime combination in
 * Chromium and WebKit with all remote requests blocked. Keep the allowlist
 * deliberately small: adding a model variant must be a separately verified
 * change, not an accidental download at build time.
 */
export const SPEAKER_MODEL = Object.freeze({
  id: "Xenova/wavlm-base-plus-sv",
  revision: "e61029603001bd11295c36d878698708bf59190f",
  dtype: "q8",
  dimensions: 512,
});

export const SPEAKER_RUNTIME = Object.freeze({
  package: "onnxruntime-web",
  version: "1.31.0-dev.20260914-8d85527a0",
  backend: "wasm",
  numThreads: 1,
});

export const SPEAKER_ASSET_DIRECTORY = "speaker-assets";
export const SPEAKER_ASSET_MANIFEST_PATH =
  `${SPEAKER_ASSET_DIRECTORY}/manifest.json`;
export const SPEAKER_ASSET_PREFIX = `${SPEAKER_ASSET_DIRECTORY}/`;

const modelPath = (relative) =>
  `${SPEAKER_ASSET_DIRECTORY}/model/wavlm-base-plus-sv/${relative}`;
const runtimePath = (file) => `${SPEAKER_ASSET_DIRECTORY}/runtime/${file}`;

// These are the only files accepted from the probe cache. The sourceRelative
// paths intentionally describe the cache layout, while path is the stable PWA
// artifact layout consumed by the browser implementation.
export const SPEAKER_ASSET_SPECS = Object.freeze([
  {
    path: modelPath("config.json"),
    sourceRelative: "models/Xenova/wavlm-base-plus-sv/config.json",
    kind: "model-config",
    bytes: 58609,
    sha256:
      "75efe37fb015f22d82af367dcef974c39119fa4c6505d16a82d86f604a431f4e",
  },
  {
    path: modelPath("preprocessor_config.json"),
    sourceRelative:
      "models/Xenova/wavlm-base-plus-sv/preprocessor_config.json",
    kind: "model-config",
    bytes: 215,
    sha256:
      "99272fe8ccfab114b68b478681ea47ee3a1ce62bb788cb92dd6e4f69fb1f1da2",
  },
  {
    path: modelPath("quantize_config.json"),
    sourceRelative: "models/Xenova/wavlm-base-plus-sv/quantize_config.json",
    kind: "model-config",
    bytes: 1154,
    sha256:
      "b073ca6f0ade094cfa676150989f20dc15e1a5b40826f6f0aac85fa99626dbea",
  },
  {
    path: modelPath("onnx/model_quantized.onnx"),
    sourceRelative:
      "models/Xenova/wavlm-base-plus-sv/onnx/model_quantized.onnx",
    kind: "model-onnx",
    bytes: 101683453,
    sha256:
      "576bf6017796bdd179824d801b3a355a1dda2451559c6a398562175e33589f68",
  },
  {
    path: runtimePath("ort-wasm-simd-threaded.asyncify.mjs"),
    sourceRelative: "ort/ort-wasm-simd-threaded.asyncify.mjs",
    kind: "runtime-module",
    bytes: 53057,
    sha256:
      "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611",
  },
  {
    path: runtimePath("ort-wasm-simd-threaded.asyncify.wasm"),
    sourceRelative: "ort/ort-wasm-simd-threaded.asyncify.wasm",
    kind: "runtime-wasm",
    bytes: 26861777,
    sha256:
      "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082",
  },
].map((spec) => Object.freeze(spec)));

const SPEC_BY_PATH = new Map(
  SPEAKER_ASSET_SPECS.map((spec) => [spec.path, spec]),
);

export const SPEAKER_ASSET_PROVENANCE = Object.freeze({
  modelCard:
    "https://huggingface.co/Xenova/wavlm-base-plus-sv",
  baseModelCard: "https://huggingface.co/microsoft/wavlm-base-plus-sv",
  baseLicenseReference:
    "https://github.com/microsoft/UniSpeech/blob/main/LICENSE",
  runtimePackage:
    "https://www.npmjs.com/package/onnxruntime-web/v/1.31.0-dev.20260914-8d85527a0",
  modelRevision: SPEAKER_MODEL.revision,
  notice:
    "Review the published model and runtime licenses before redistribution; preserve their attribution and notices.",
});

const SHA256_RE = /^[a-f0-9]{64}$/;

export function normalizeBasePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || !value.endsWith("/")) {
    throw new Error("Base path must be an absolute path with trailing slash");
  }
  if (/[?#\\]/.test(value) || value.includes("//")) {
    throw new Error("Base path must be a canonical slash path without query/hash");
  }
  return value;
}

export function speakerAssetBasePath(basePath) {
  return `${normalizeBasePath(basePath)}${SPEAKER_ASSET_DIRECTORY}/`;
}

export function isAllowedSpeakerAssetPath(relative) {
  return typeof relative === "string" && SPEC_BY_PATH.has(relative);
}

export function getSpeakerAssetSpec(relative) {
  return SPEC_BY_PATH.get(relative);
}

export function isDeferredSpeakerAsset(relative) {
  return (
    typeof relative === "string" &&
    relative.startsWith(SPEAKER_ASSET_PREFIX) &&
    relative !== SPEAKER_ASSET_MANIFEST_PATH
  );
}

export function isSpeakerAssetManifest(relative) {
  return relative === SPEAKER_ASSET_MANIFEST_PATH;
}

function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function assertString(value, message) {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
}

function sortedSet(values) {
  return [...new Set(values)].sort();
}

function expectedAssetPaths() {
  return SPEAKER_ASSET_SPECS.map((spec) => spec.path).sort();
}

/**
 * Validate the small manifest before any worker or artifact list is produced.
 * `actualPaths` is optional for pure manifest tests; build/check callers pass
 * every path actually present under dist/speaker-assets except this manifest.
 */
export function validateSpeakerAssetManifest(
  value,
  { basePath, actualPaths } = {},
) {
  assertObject(value, "Speaker asset manifest must be an object");
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported speaker asset manifest schema");
  }
  if (value.deferred !== true || value.precache !== false) {
    throw new Error("Speaker assets must be deferred and excluded from precache");
  }
  const appBase = normalizeBasePath(basePath);
  if (value.appBasePath !== appBase) {
    throw new Error("Speaker asset manifest app base path does not match build");
  }
  if (value.basePath !== speakerAssetBasePath(appBase)) {
    throw new Error("Speaker asset manifest base path is not canonical");
  }
  assertObject(value.model, "Speaker asset manifest is missing model metadata");
  for (const field of ["id", "revision", "dtype"]) {
    assertString(value.model[field], `Speaker model metadata missing ${field}`);
  }
  if (
    value.model.id !== SPEAKER_MODEL.id ||
    value.model.revision !== SPEAKER_MODEL.revision ||
    value.model.dtype !== SPEAKER_MODEL.dtype ||
    value.model.dimensions !== SPEAKER_MODEL.dimensions
  ) {
    throw new Error("Speaker asset manifest model is not the pinned verified model");
  }
  assertObject(value.runtime, "Speaker asset manifest is missing runtime metadata");
  for (const field of ["package", "version", "backend"]) {
    assertString(value.runtime[field], `Speaker runtime metadata missing ${field}`);
  }
  if (
    value.runtime.package !== SPEAKER_RUNTIME.package ||
    value.runtime.version !== SPEAKER_RUNTIME.version ||
    value.runtime.backend !== SPEAKER_RUNTIME.backend ||
    value.runtime.numThreads !== SPEAKER_RUNTIME.numThreads
  ) {
    throw new Error("Speaker asset manifest runtime is not the pinned verified runtime");
  }
  assertObject(value.provenance, "Speaker asset manifest is missing provenance");
  assertString(value.provenance.modelCard, "Speaker model provenance is missing");
  assertString(
    value.provenance.baseLicenseReference,
    "Speaker license provenance is missing",
  );

  if (!Array.isArray(value.assets)) {
    throw new Error("Speaker asset manifest assets must be an array");
  }
  if (value.status !== "ready" && value.status !== "unavailable") {
    throw new Error("Speaker asset manifest status must be ready or unavailable");
  }
  const actual =
    actualPaths === undefined
      ? undefined
      : sortedSet(
          [...actualPaths].map((relative) => {
            if (typeof relative !== "string") {
              throw new Error("Speaker asset paths must be strings");
            }
            return relative;
          }),
        );

  if (value.status === "unavailable") {
    if (value.assets.length !== 0) {
      throw new Error("Unavailable speaker asset manifest cannot list files");
    }
    assertString(value.message, "Unavailable speaker asset manifest needs a reason");
    if (actual && actual.length > 0) {
      throw new Error("Unmanifested deferred speaker assets are present");
    }
    return value;
  }

  if (value.assets.length !== SPEAKER_ASSET_SPECS.length) {
    throw new Error("Ready speaker asset manifest has an incomplete allowlist");
  }
  const seen = new Set();
  for (const asset of value.assets) {
    assertObject(asset, "Speaker asset entry must be an object");
    if (seen.has(asset.path)) throw new Error(`Duplicate speaker asset: ${asset.path}`);
    seen.add(asset.path);
    const spec = SPEC_BY_PATH.get(asset.path);
    if (!spec) throw new Error(`Unknown speaker asset path: ${asset.path}`);
    if (asset.kind !== spec.kind) throw new Error(`Speaker asset kind mismatch: ${asset.path}`);
    if (asset.bytes !== spec.bytes) throw new Error(`Speaker asset size mismatch: ${asset.path}`);
    if (asset.sha256 !== spec.sha256 || !SHA256_RE.test(asset.sha256)) {
      throw new Error(`Speaker asset hash mismatch: ${asset.path}`);
    }
  }
  if (sortedSet(seen) .join("\n") !== expectedAssetPaths().join("\n")) {
    throw new Error("Ready speaker asset manifest does not match the pinned allowlist");
  }
  if (actual && actual.join("\n") !== expectedAssetPaths().join("\n")) {
    throw new Error("Ready speaker asset files do not match the manifest allowlist");
  }
  return value;
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifySpeakerAssetFile(file, spec) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`Speaker asset is not a regular file: ${file}`);
  if (info.size !== spec.bytes) {
    throw new Error(`Speaker asset byte count mismatch: ${spec.path}`);
  }
  const digest = await sha256File(file);
  if (digest !== spec.sha256) throw new Error(`Speaker asset hash mismatch: ${spec.path}`);
}

export async function verifyPreparedSpeakerAssets(rootDir, manifest) {
  const actualPaths =
    manifest.status === "ready"
      ? SPEAKER_ASSET_SPECS.map((spec) => spec.path)
      : [];
  validateSpeakerAssetManifest(manifest, {
    basePath: manifest.appBasePath,
    actualPaths,
  });
  if (manifest.status !== "ready") return;
  for (const spec of SPEAKER_ASSET_SPECS) {
    await verifySpeakerAssetFile(path.join(rootDir, spec.path), spec);
  }
}

function manifestForUnavailable(basePath, message) {
  const appBase = normalizeBasePath(basePath);
  return {
    schemaVersion: 1,
    status: "unavailable",
    deferred: true,
    precache: false,
    appBasePath: appBase,
    basePath: speakerAssetBasePath(appBase),
    model: { ...SPEAKER_MODEL },
    runtime: { ...SPEAKER_RUNTIME },
    assets: [],
    provenance: { ...SPEAKER_ASSET_PROVENANCE },
    message,
  };
}

export async function writeUnavailableSpeakerManifest(
  outputDir,
  basePath,
  message = "Speaker model assets were not prepared for this build.",
) {
  await mkdir(outputDir, { recursive: true });
  const manifest = manifestForUnavailable(basePath, message);
  await writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function sourceFileFor(sourceDir, spec) {
  const source = path.join(sourceDir, ...spec.sourceRelative.split("/"));
  const info = await lstat(source).catch(() => undefined);
  if (!info || !info.isFile()) {
    throw new Error(
      `Missing pinned speaker asset source: ${spec.sourceRelative}. ` +
        "Use the verified probe cache or an explicitly prepared source directory.",
    );
  }
  return source;
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function listRelativeFiles(rootDir) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Speaker asset output must not contain symlinks: ${file}`);
      }
      if (entry.isDirectory()) await walk(file);
      else files.push(path.relative(rootDir, file).split(path.sep).join("/"));
    }
  }
  await walk(rootDir);
  return files.sort();
}

async function inspectExistingOutput(outputDir, basePath) {
  const info = await lstat(outputDir).catch(() => undefined);
  if (!info) return { exists: false };
  if (info.isSymbolicLink()) {
    throw new Error("Speaker asset output must not be a symbolic link");
  }
  if (!info.isDirectory()) {
    throw new Error("Speaker asset output must be a dedicated directory");
  }
  const files = await listRelativeFiles(outputDir);
  if (files.length === 0) return { exists: true, empty: true };
  if (!files.includes("manifest.json")) {
    throw new Error(
      "Refusing to replace a non-empty speaker asset directory without its generated manifest",
    );
  }
  const manifest = JSON.parse(
    await readFile(path.join(outputDir, "manifest.json"), "utf8"),
  );
  const actualPaths = files
    .filter((relative) => relative !== "manifest.json")
    .map((relative) => `${SPEAKER_ASSET_PREFIX}${relative}`);
  validateSpeakerAssetManifest(manifest, { basePath, actualPaths });
  await verifyPreparedSpeakerAssets(path.dirname(outputDir), manifest);
  return { exists: true, empty: false, manifest };
}

async function assertNoSymlinkAncestors(target) {
  let current = path.resolve(target);
  while (true) {
    const info = await lstat(current).catch(() => undefined);
    if (info) {
      if (info.isSymbolicLink()) {
        throw new Error(`Speaker asset path must not cross a symlink: ${current}`);
      }
      return;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function assertSafePreparationPaths(sourceDir, outputDir) {
  const source = path.resolve(sourceDir);
  const output = path.resolve(outputDir);
  if (path.basename(output) !== SPEAKER_ASSET_DIRECTORY) {
    throw new Error(
      `Refusing unsafe speaker asset output ${output}; output must end in ${SPEAKER_ASSET_DIRECTORY}`,
    );
  }
  if (isWithin(source, output) || isWithin(output, source)) {
    throw new Error("Speaker asset source and output directories must not overlap");
  }
  await assertNoSymlinkAncestors(source);
  await assertNoSymlinkAncestors(output);
  return { source, output };
}

export async function replaceSpeakerAssetOutput({
  staging,
  outputDir,
  renameImpl = rename,
  copyImpl = cp,
  removeImpl = rm,
}) {
  const existing = await lstat(outputDir).catch(() => undefined);
  if (existing?.isSymbolicLink()) {
    throw new Error("Speaker asset output must not be a symbolic link");
  }
  const backup = existing
    ? `${outputDir}.backup-${process.pid}-${randomUUID()}`
    : undefined;
  let oldMoved = false;
  let installed = false;
  try {
    if (backup) {
      await renameImpl(outputDir, backup);
      oldMoved = true;
    }
    await renameImpl(staging, outputDir);
    installed = true;
  } catch (error) {
    // Copy fallback is only safe when the destination did not exist. If the
    // old generated set could not be moved to its backup, leave it untouched.
    if (!existing && !oldMoved && (error?.code === "EPERM" || error?.code === "EXDEV")) {
      try {
        await copyImpl(staging, outputDir, { recursive: true, force: false });
      } catch (copyError) {
        await removeImpl(outputDir, { recursive: true, force: true });
        throw copyError;
      }
      installed = true;
      await removeImpl(staging, { recursive: true, force: true });
    } else {
      if (oldMoved) {
        await renameImpl(backup, outputDir);
        oldMoved = false;
      }
      throw error;
    }
  }
  if (!installed && oldMoved) {
    await renameImpl(backup, outputDir);
    oldMoved = false;
  }
  if (backup && oldMoved) {
    await removeImpl(backup, { recursive: true, force: true });
  }
}

export async function prepareSpeakerAssets({
  sourceDir,
  outputDir,
  basePath,
}) {
  if (typeof sourceDir !== "string" || sourceDir.length === 0) {
    throw new Error(
      "Speaker asset preparation requires an explicit --source probe-cache directory; no network fallback is implicit.",
    );
  }
  if (typeof outputDir !== "string" || outputDir.length === 0) {
    throw new Error("Speaker asset preparation requires an output directory");
  }
  normalizeBasePath(basePath);
  const { source: resolvedSource, output: resolvedOutput } =
    await assertSafePreparationPaths(sourceDir, outputDir);
  const sourceInfo = await lstat(resolvedSource).catch(() => undefined);
  if (!sourceInfo || !sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error("Speaker asset source must be an existing non-symlink directory");
  }
  await inspectExistingOutput(resolvedOutput, basePath);
  const parent = path.dirname(resolvedOutput);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, "speaker-assets-stage-"));
  const stagingInfo = await lstat(staging);
  if (!stagingInfo.isDirectory() || stagingInfo.isSymbolicLink()) {
    throw new Error("Unable to create a safe speaker asset staging directory");
  }
  try {
    for (const spec of SPEAKER_ASSET_SPECS) {
      const source = await sourceFileFor(resolvedSource, spec);
      await verifySpeakerAssetFile(source, spec);
      const target = path.join(staging, spec.path.slice(SPEAKER_ASSET_PREFIX.length));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      await verifySpeakerAssetFile(target, spec);
    }
    const manifest = {
      schemaVersion: 1,
      status: "ready",
      deferred: true,
      precache: false,
      appBasePath: normalizeBasePath(basePath),
      basePath: speakerAssetBasePath(basePath),
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
    validateSpeakerAssetManifest(manifest, {
      basePath,
      actualPaths: SPEAKER_ASSET_SPECS.map((spec) => spec.path),
    });
    await writeFile(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await replaceSpeakerAssetOutput({
      staging,
      outputDir: resolvedOutput,
    });
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function readSpeakerAssetManifest(distDir) {
  const file = path.join(distDir, SPEAKER_ASSET_MANIFEST_PATH);
  const text = await readFile(file, "utf8");
  return JSON.parse(text);
}

export async function listSpeakerAssetPaths(distDir) {
  const root = path.join(distDir, SPEAKER_ASSET_DIRECTORY);
  const paths = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Speaker asset output must not contain symlinks: ${file}`);
      }
      if (entry.isDirectory()) await walk(file);
      else if (entry.name !== "manifest.json") {
        paths.push(path.relative(distDir, file).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  return paths.sort();
}

