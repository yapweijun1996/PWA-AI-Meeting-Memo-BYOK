import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
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
const manifest = {
  id: base,
  name: "Meeting Memo",
  short_name: "MeetingMemo",
  description:
    "Your conversations, thoughtfully captured. A browser-first BYOK workspace.",
  start_url: base,
  scope: base,
  display: "standalone",
  background_color: "#f7f8f5",
  theme_color: "#f6f7f3",
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
const files = (await walk("dist"))
  .filter((p) => !p.endsWith("sw.js"))
  .map((file) => ({
    file,
    relative: path.relative("dist", file).split(path.sep).join("/"),
  }))
  .sort((a, b) => a.relative.localeCompare(b.relative));
const assets = files.map(({ relative }) => base + relative);
const source = await readFile("src/pwa/worker.template.js", "utf8");
const hash = createHash("sha256");
hash.update(source);
// The canonical asset list is part of the release identity. A path-only fix
// must not reuse a cache created with a different URL set.
hash.update(JSON.stringify(assets));
for (const { file, relative } of files) {
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
console.log(`PWA ${build}: ${assets.length} app-shell assets; scope ${base}`);
