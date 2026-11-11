import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  findInstalledOnnxRuntimeDist,
  isDeferredSpeakerAsset,
  listSpeakerAssetPaths,
  prepareRuntimeSpeakerAssets,
  prepareSpeakerAssets,
  readSpeakerAssetManifest,
  SPEAKER_ASSET_DIRECTORY,
  SPEAKER_ASSET_MANIFEST_PATH,
  validateSpeakerAssetManifest,
  verifyPreparedSpeakerAssets,
  writeUnavailableSpeakerManifest,
} from "./speaker-assets.mjs";
const base = process.env.VITE_BASE_PATH || "/PWA-AI-Meeting-Memo-BYOK/";
if (!base.startsWith("/") || !base.endsWith("/"))
  throw new Error(
    "VITE_BASE_PATH must be an absolute path with trailing slash",
  );
async function walk(dir) {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    out.push(...(item.isDirectory() ? await walk(p) : [p]));
  }
  return out;
}

// Vite can emit the ONNX backend's fallback binary from the Transformers.js
// dependency under dist/assets. The worker supplies the explicitly consented,
// pinned speaker-assets/runtime URL instead, so this dependency fallback must
// not become an app-shell download (or a second runtime copy) by accident.
const isBundledOnnxRuntimeAsset = (relative) =>
  /^assets\/ort-wasm-simd-threaded(?:\.[A-Za-z0-9-]+)?-[A-Za-z0-9_-]+\.(?:mjs|wasm)$/.test(
    relative,
  );

const speakerAssetOutput = path.join("dist", SPEAKER_ASSET_DIRECTORY);
if (process.env.SPEAKER_ASSET_SOURCE) {
  await prepareSpeakerAssets({
    sourceDir: process.env.SPEAKER_ASSET_SOURCE,
    outputDir: speakerAssetOutput,
    basePath: base,
  });
} else {
  const manifestFile = path.join("dist", SPEAKER_ASSET_MANIFEST_PATH);
  try {
    await readFile(manifestFile, "utf8");
  } catch {
    // Without prepared weights, ship only the pinned ONNX Runtime (MIT) from the
    // installed package and let the browser fetch the weights from their host
    // after consent. If the runtime is missing or differs from the pinned hashes
    // the speaker feature is declared unavailable instead.
    let prepared = false;
    try {
      const runtimeDir = await findInstalledOnnxRuntimeDist();
      if (!runtimeDir) throw new Error("onnxruntime-web is not installed");
      await prepareRuntimeSpeakerAssets({
        runtimeDir,
        outputDir: speakerAssetOutput,
        basePath: base,
      });
      prepared = true;
    } catch (error) {
      console.warn(
        `Speaker runtime not shipped: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!prepared) {
      await writeUnavailableSpeakerManifest(
        speakerAssetOutput,
        base,
        "Speaker model assets were not prepared. Set SPEAKER_ASSET_SOURCE to the verified probe public directory for an explicit preparation step.",
      );
    }
  }
}

const speakerManifest = await readSpeakerAssetManifest("dist");
const speakerPaths = await listSpeakerAssetPaths("dist");
validateSpeakerAssetManifest(speakerManifest, {
  basePath: base,
  actualPaths: speakerPaths,
});
await verifyPreparedSpeakerAssets("dist", speakerManifest);
if (
  process.env.SPEAKER_ASSETS_REQUIRED === "1" &&
  speakerManifest.status !== "ready"
) {
  throw new Error(
    "SPEAKER_ASSETS_REQUIRED=1 but verified speaker assets are unavailable; run the explicit preparation step first",
  );
}

const manifest = {
  id: base,
  name: "Meeting Memo",
  short_name: "MeetingMemo",
  description:
    "Your conversations, thoughtfully captured. A browser-first BYOK workspace.",
  start_url: base,
  scope: base,
  display: "standalone",
  background_color: "#f7f8fa",
  theme_color: "#f7f8fa",
  lang: "en",
  icons: [
    {
      src: "icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "icon-maskable.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};
await writeFile("dist/manifest.webmanifest", JSON.stringify(manifest, null, 2));
const leakedOnnxRuntimeFiles = (await walk("dist")).filter((file) =>
  isBundledOnnxRuntimeAsset(
    path.relative("dist", file).split(path.sep).join("/"),
  ),
);
await Promise.all(leakedOnnxRuntimeFiles.map((file) => unlink(file)));
const allFiles = (await walk("dist"))
  .filter((p) => !p.endsWith("sw.js"))
  .map((file) => ({
    file,
    relative: path.relative("dist", file).split(path.sep).join("/"),
  }))
  .sort((a, b) => a.relative.localeCompare(b.relative));
const shellFiles = allFiles.filter(
  ({ relative }) => !isDeferredSpeakerAsset(relative),
);
const assets = shellFiles.map(({ relative }) => base + relative);
const source = await readFile("src/pwa/worker.template.js", "utf8");
const hash = createHash("sha256");
hash.update(source);
// The canonical asset list is part of the release identity. A path-only fix
// must not reuse a cache created with a different URL set.
hash.update(JSON.stringify(assets));
for (const { file, relative } of allFiles) {
  hash.update(relative);
  hash.update(await readFile(file));
}
const build = hash.digest("hex").slice(0, 16);
await writeFile(
  "dist/sw.js",
  source
    .replace("__CACHE_VERSION__", JSON.stringify(build))
    .replace("__BASE_PATH__", JSON.stringify(base))
    .replace("__PRECACHE_ASSETS__", JSON.stringify(assets)),
);
console.log(
  `PWA ${build}: ${assets.length} app-shell assets; ` +
    `speaker assets ${speakerManifest.status}; scope ${base}`,
);
