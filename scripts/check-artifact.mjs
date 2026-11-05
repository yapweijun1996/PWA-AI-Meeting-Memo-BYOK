import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
const base = process.env.VITE_BASE_PATH || "/PWA-AI-Meeting-Memo-BYOK/";
assert(
  base.startsWith("/") && base.endsWith("/"),
  "VITE_BASE_PATH must be an absolute path with trailing slash",
);
const artifactFiles = [];
const canonicalRelative = (file) =>
  path.relative("dist", file).split(path.sep).join("/");
async function inspect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    assert(!item.isSymbolicLink(), "Artifact must not contain symlinks");
    if (item.isDirectory()) {
      await inspect(p);
      continue;
    }
    assert(
      /\.(html|js|css|svg|png|webmanifest)$/.test(p),
      `Unexpected artifact file: ${p}`,
    );
    artifactFiles.push(p);
    if (!p.endsWith(".png")) {
      const text = await readFile(p, "utf8");
      assert(
        !/sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/.test(text),
        "Possible credential in artifact",
      );
      assert(
        !text.includes("synthetic-test-only") &&
          !text.includes("fixture-secret-do-not-persist"),
        "Test fixtures must not be deployed",
      );
    }
  }
}
await inspect("dist");
const manifest = JSON.parse(
  await readFile("dist/manifest.webmanifest", "utf8"),
);
assert.equal(manifest.start_url, base);
assert.equal(manifest.scope, base);
assert.equal(manifest.id, base);
assert(manifest.icons.some((i) => i.purpose === "maskable"));
const worker = await readFile("dist/sw.js", "utf8");
assert(worker.includes(base));
assert(
  !worker.includes("api.openai.com") &&
    !worker.includes("api.deepgram.com") &&
    !worker.includes("openrouter.ai"),
);
const assetsMatch = worker.match(/const ASSETS\s*=\s*(\[[\s\S]*?\]);/);
assert(assetsMatch, "Worker must contain a JSON ASSETS declaration");
let assets;
try {
  assets = JSON.parse(assetsMatch[1]);
} catch (error) {
  throw new Error(`Worker ASSETS must be valid JSON: ${error.message}`);
}
assert(Array.isArray(assets) && assets.length > 0, "ASSETS must be nonempty");
const seen = new Set();
for (const asset of assets) {
  assert.equal(typeof asset, "string", "ASSETS entries must be strings");
  assert(!seen.has(asset), `Duplicate worker asset: ${asset}`);
  seen.add(asset);
  assert(!asset.includes("\\"), `Worker asset must use slash paths: ${asset}`);
  assert(!/[?#]/.test(asset), `Worker asset must not contain query/hash: ${asset}`);
  assert(asset.startsWith(base), `Worker asset is outside base path: ${asset}`);
  const relative = asset.slice(base.length);
  assert(relative, `Worker asset must name a file: ${asset}`);
  assert(!relative.startsWith("/"), `Worker asset has a non-canonical path: ${asset}`);
  assert(!relative.startsWith("dist/"), `Worker asset must not include dist/: ${asset}`);
  assert(!relative.includes("//"), `Worker asset has a non-canonical path: ${asset}`);
  assert(!relative.split("/").includes(".."), `Worker asset escapes base path: ${asset}`);
  const resolved = new URL(asset, "https://artifact.invalid");
  assert.equal(resolved.origin, "https://artifact.invalid");
  assert.equal(resolved.pathname, asset, `Worker asset is not canonical: ${asset}`);
}
assert(seen.has(`${base}index.html`), "ASSETS must include the app index");
const expectedAssets = artifactFiles
  .filter((file) => canonicalRelative(file) !== "sw.js")
  .map((file) => base + canonicalRelative(file))
  .sort();
assert.deepEqual(
  [...seen].sort(),
  expectedAssets,
  "ASSETS must exactly match dist files other than sw.js",
);
console.log(
  "PASS: static-only artifact, no known credential/test fixtures, correct manifest identity and scoped worker",
);
