import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
const base = "/PWA-AI-Meeting-Memo-BYOK/";
const files = new Map();
async function load(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) await load(p);
    else files.set(base + p.replace(/^dist\//, ""), await readFile(p));
  }
}
await load("dist");
const sw = files.get(base + "sw.js").toString();
assert.match(sw, /const VERSION\s*=/);
const next = sw.replace(
  /(const VERSION\s*=\s*["'])([^"']+)/,
  (_, prefix, version) => prefix + version + "-update-check",
);
assert.notEqual(sw, next);
let updated = false;
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost").pathname;
  const target = url === base ? base + "index.html" : url;
  const file =
    target === base + "sw.js" && updated
      ? Buffer.from(next)
      : files.get(target);
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[path.extname(target)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(file);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}${base}`;
try {
  for (const [name, engine] of [
    ["Chromium", chromium],
    ["WebKit", webkit],
  ]) {
    updated = false;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        await caches.open("unrelated-app-sentinel");
      });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page
        .getByRole("button", { name: "New meeting", exact: true })
        .last()
        .click();
      await page.getByLabel("Meeting title").fill("Preserved across update");
      await page
        .getByRole("button", { name: "Create meeting", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Preserved across update", exact: true })
        .waitFor();
      updated = true;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .waitFor();
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .click();
      await page.waitForLoadState("load");
      await page
        .getByRole("heading", { name: "Preserved across update", exact: true })
        .waitFor();
      await page.waitForFunction(
        () => !document.body.textContent.includes("Updating…"),
      );
      const keys = await page.evaluate(() => caches.keys());
      assert(keys.includes("unrelated-app-sentinel"));
      assert(keys.some((key) => key.includes("update-check")));
      console.log(
        `PASS ${name}: N→N+1 prompt, explicit activation, reload, saved meeting and unrelated cache preserved`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
