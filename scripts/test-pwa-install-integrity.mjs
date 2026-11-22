import assert from "node:assert/strict";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { chromium, expect, webkit } from "@playwright/test";

import { checkForWorkerUpdate } from "./test-pwa-worker-state.mjs";

const [baselineDir, candidateDir] = process.argv.slice(2);
assert(baselineDir && candidateDir, "Usage: node scripts/test-pwa-install-integrity.mjs BASELINE_DIST CANDIDATE_DIST");

async function readRelease(directory) {
  const [html, worker, manifest] = await Promise.all([
    readFile(path.join(directory, "index.html"), "utf8"),
    readFile(path.join(directory, "sw.js"), "utf8"),
    readFile(path.join(directory, "manifest.webmanifest"), "utf8"),
  ]);
  const version = worker.match(/^const VERSION = "([^"]+)";/m)?.[1];
  const entry = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/)?.[1];
  const base = JSON.parse(manifest).scope;
  assert(version && entry && base?.startsWith("/") && base.endsWith("/"), "Run the PWA build for both artifacts before testing");
  return { directory: path.resolve(directory), html, version, entry, base };
}

const [baseline, candidate] = await Promise.all([readRelease(baselineDir), readRelease(candidateDir)]);
assert.equal(baseline.base, candidate.base, "Both builds must use the same Vite base path");
assert.notEqual(baseline.version, candidate.version, "The worker versions must differ");
assert.notEqual(baseline.entry, candidate.entry, "Build with two distinct VITE_BUILD_ID values or use two different application releases");
const base = baseline.base;
const types = new Map([
  [".html", "text/html"], [".js", "application/javascript"], [".css", "text/css"],
  [".webmanifest", "application/manifest+json"], [".json", "application/json"],
  [".png", "image/png"], [".svg", "image/svg+xml"],
]);

let release = baseline;
let originOffline = false;
let staleAsset;
let staleResponses = 0;
const server = createServer(async (request, response) => {
  if (originOffline) {
    response.writeHead(503).end();
    return;
  }
  const pathname = new URL(request.url, "http://localhost").pathname;
  const relative = pathname === base ? "index.html" : pathname.slice(base.length);
  const filename = path.join(release.directory, relative);
  if (!pathname.startsWith(base) || !filename.startsWith(`${release.directory}${path.sep}`)) {
    response.writeHead(404).end();
    return;
  }
  try {
    let content;
    if (pathname === staleAsset) {
      staleResponses++;
      content = relative === "index.html"
        ? baseline.html
        : await readFile(path.join(baseline.directory, baseline.entry.slice(base.length)));
    } else {
      content = await readFile(filename);
    }
    response.writeHead(200, {
      "Content-Type": types.get(path.extname(filename)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    }).end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}${base}`;

try {
  for (const engine of [chromium, webkit]) {
    let browser;
    try {
      originOffline = false;
      release = baseline;
      staleAsset = undefined;
      browser = await engine.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => !!globalThis.navigator.serviceWorker.controller);
      const entry = page.locator('script[type="module"][src]');
      await expect(entry).toHaveAttribute("src", baseline.entry);
      const before = await page.evaluate(async () => {
        await globalThis.caches.open("pwa-integrity-unrelated-cache");
        return (await globalThis.caches.keys()).sort();
      });
      assert(before.some((name) => name.endsWith(`:${baseline.version}`)), "Initial app cache is missing");

      release = candidate;
      for (const asset of [base + "index.html", candidate.entry]) {
        staleAsset = asset;
        staleResponses = 0;
        const state = await checkForWorkerUpdate(page);
        assert(staleResponses > 0, `Candidate did not fetch the stale asset: ${asset}`);
        assert.equal(state, "redundant", `Candidate accepted stale asset: ${asset}`);
        assert.deepEqual(await page.evaluate(async () => (await globalThis.caches.keys()).sort()), before, "Rejected candidate must leave only the original caches");
      }
      // A failed reinstall must also preserve an already retained cache of that version.
      const retainedCache = `meeting-memo-byok:${base}:${candidate.version}`;
      const retainedURL = new URL("retained-client.js", url).href;
      await page.evaluate(async ([name, key]) => {
        await (await caches.open(name)).put(key, new Response("previously retained"));
      }, [retainedCache, retainedURL]);
      assert.equal(await checkForWorkerUpdate(page), "redundant");
      const retained = await page.evaluate(async ([name, key]) =>
        (await caches.match(key, { cacheName: name }))?.text(), [retainedCache, retainedURL]);
      assert.equal(retained, "previously retained");

      async function expectOfflineLaunch(expectedEntry) {
        originOffline = true;
        await context.setOffline(true);
        await page.reload();
        await expect(entry).toHaveAttribute("src", expectedEntry);
        await expect(page.getByRole("button", { name: "New meeting", exact: true }).last()).toBeVisible();
        await context.setOffline(false);
        originOffline = false;
      }
      await expectOfflineLaunch(baseline.entry);

      staleAsset = undefined;
      assert.equal(await checkForWorkerUpdate(page), "installed", "The coherent candidate did not install");
      await expect(entry).toHaveAttribute("src", baseline.entry);
      await page.getByRole("button", { name: "Update now", exact: true }).click();
      await page.getByRole("button", { name: "Confirm update", exact: true }).click();
      await expect(entry).toHaveAttribute("src", candidate.entry);
      await expectOfflineLaunch(candidate.entry);
      assert(await page.evaluate(async () => (await globalThis.caches.keys()).includes("pwa-integrity-unrelated-cache")));
      console.log(`PASS ${engine.name()} ${browser.version()}: rejected stale HTML and entry JS, launched old and new apps offline, and upgraded with confirmation`);
    } catch (error) {
      process.exitCode = 1;
      console.error(`FAIL ${engine.name()}: ${error.message}`);
    } finally {
      await browser?.close();
    }
  }
} finally {
  server.close();
}
