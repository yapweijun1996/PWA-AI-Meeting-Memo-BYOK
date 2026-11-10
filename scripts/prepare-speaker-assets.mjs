import path from "node:path";
import {
  prepareSpeakerAssets,
  SPEAKER_ASSET_SPECS,
  SPEAKER_RUNTIME,
} from "./speaker-assets.mjs";

function usage() {
  return [
    "Prepare the pinned browser speaker model/runtime assets from a verified local cache.",
    "",
    "Usage:",
    "  node scripts/prepare-speaker-assets.mjs --source <probe-public> [options]",
    "",
    "Options:",
    "  --source <dir>  Explicit source cache containing models/ and ort/.",
    "  --output <dir>  Output directory (default: dist/speaker-assets).",
    "  --base <path>   App base path (default: VITE_BASE_PATH or /PWA-AI-Meeting-Memo-BYOK/).",
    "  --help          Show this message.",
    "",
    `The preparation is local and hash-verifies ${SPEAKER_ASSET_SPECS.length} allowlisted files. Runtime: ${SPEAKER_RUNTIME.package}@${SPEAKER_RUNTIME.version}.`,
    "No network download, CDN fallback, user audio, vectors, or provider key is implicit.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!["--source", "--output", "--base"].includes(arg)) {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}\n\n${usage()}`);
    }
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

const base = options.base || process.env.VITE_BASE_PATH || "/PWA-AI-Meeting-Memo-BYOK/";
const output = options.output || path.join("dist", "speaker-assets");
if (!options.source) {
  throw new Error(
    "--source is required. Point it at the verified probe public directory; this command never downloads unpinned assets.",
  );
}

const manifest = await prepareSpeakerAssets({
  sourceDir: options.source,
  outputDir: output,
  basePath: base,
});
console.log(
  `Prepared ${manifest.assets.length} verified deferred speaker assets at ${path.resolve(output)} for ${manifest.basePath}`,
);
