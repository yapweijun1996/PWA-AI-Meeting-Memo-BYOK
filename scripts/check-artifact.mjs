import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
const base = process.env.VITE_BASE_PATH || "/PWA-AI-Meeting-Memo-BYOK/";
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
  !worker.includes("api.openai.com") && !worker.includes("api.deepgram.com"),
);
console.log(
  "PASS: static-only artifact, no known credential/test fixtures, correct manifest identity and scoped worker",
);
