import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, webkit, expect } from "@playwright/test";
import { checkForWorkerUpdate } from "./test-pwa-worker-state.mjs";
const base = "/PWA-AI-Meeting-Memo-BYOK/";
const files = new Map();
async function load(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) await load(p);
    else {
      const relative = path.relative("dist", p).split(path.sep).join("/");
      files.set(base + relative, await readFile(p));
    }
  }
}
await load("dist");
const sw = files.get(base + "sw.js").toString();
const index = files.get(base + "index.html").toString();
const digest = (html) => "sha256-" + createHash("sha256").update(html).digest("base64");

// Each fixture serves the exact HTML declared by its worker, except during the mixed-release case.
function fixtureRelease(versionSuffix, marker) {
  const html = index.replace("<head>", `<head><meta name="pwa-test-release" content="${marker}">`);
  assert.notEqual(html, index);
  assert(sw.includes(digest(index)), "Build the app before running the update checks");
  const worker = sw
    .replace(/(const VERSION = "[^"]+)/, `$1-${versionSuffix}`)
    .replace(digest(index), digest(html));
  return { worker, html };
}
const initial = fixtureRelease("initial", "initial");
const next = fixtureRelease("update-check", "next");
let release = initial;
let indexReads = 0;
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
    target === base + "sw.js" ? release.worker : files.get(target);
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[path.extname(target)] || "application/octet-stream",
    "Cache-Control": "public, max-age=600",
  });
  if (target === base + "index.html") {
    indexReads++;
    res.end(release.html);
  } else {
    res.end(file);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}${base}`;
try {
  for (const [name, engine] of [
    ["Chromium", chromium],
    ["WebKit", webkit],
  ]) {
    release = initial;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await expect(
        page.locator('meta[name="pwa-test-release"]'),
      ).toHaveAttribute("content", "initial");
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
      await page.getByText("Start from a transcript instead").click();
      await page
        .getByLabel("Transcript", { exact: true })
        .fill("Jamie: Preserve this local draft.");
      await page
        .getByRole("button", { name: "Create meeting", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Preserved across update", exact: true })
        .waitFor();
      // Mock in-page fetch so a worker-controlled WebKit page cannot bypass a route.
      // No real provider request is made during lifecycle verification.
      const hash = new URL(page.url()).hash;
      await page.getByRole("link", { name: "Settings & API keys" }).click();
      await page
        .getByLabel("OpenAI API key", { exact: true })
        .fill("synthetic-update-only");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(
        page.getByRole("button", { name: "Saved on this device" }),
      ).toBeVisible();
      await page.evaluate((value) => {
        const original = window.fetch.bind(window);
        window.fetch = (input, init) => {
          if (String(input).startsWith("https://api.openai.com/")) {
            return new Promise((_, reject) => {
              init.signal.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            });
          }
          return original(input, init);
        };
        location.hash = value;
      }, hash);
      await page.getByRole("tab", { name: /Meeting notes/ }).click();
      await page
        .getByRole("button", { name: "Generate meeting notes", exact: true })
        .click();
      await page
        .getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true })
        .check();
      await page
        .getByRole("button", { name: "Generate new notes", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Stop waiting", exact: true }),
      ).toBeVisible();
      await page.evaluate(async (base) => {
        const keys = await caches.keys(),
          own = keys.find((key) => key.startsWith("meeting-memo-byok:"));
        await (
          await caches.open(own)
        ).put(
          base + "assets/old-client-only.js",
          new Response("old client asset preserved"),
        );
      }, base);
      const cacheNames = () => page.evaluate(async () => (await caches.keys()).sort());
      const originalCaches = await cacheNames();
      const readsBeforeUpdate = indexReads;
      release = { worker: next.worker, html: initial.html };
      assert.equal(await checkForWorkerUpdate(page), "redundant");
      assert(indexReads > readsBeforeUpdate, "Worker must fetch the mismatched HTML");
      assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting), false);
      assert.deepEqual(await cacheNames(), originalCaches);

      release = next;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .click();
      await expect(
        page.getByText("Finish the active provider request before updating.", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Stop waiting", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "may have been charged",
      );
      await page.getByRole("link", { name: "Settings & API keys" }).click();
      await page.getByLabel("Memo model ID").fill("gpt-6.1-sol");
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .click();
      await expect(
        page.getByText("Save your settings before updating."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(
        page.getByRole("button", { name: "Saved on this device" }),
      ).toBeVisible();
      await page.evaluate((value) => {
        location.hash = value;
      }, hash);
      await page.getByRole("tab", { name: /Speakers/ }).click();
      const speakerDraft = page.getByLabel("Name for speaker 1", { exact: true });
      await speakerDraft.fill("Jamie pending save");
      await page.locator(".update button").evaluate((button) => button.click());
      await expect(
        page.getByText("Save or close the open editor before updating.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Save name", exact: true }).click();
      await expect(speakerDraft).toHaveValue("Jamie pending save");
      await page.getByRole("tab", { name: /Transcript/ }).click();
      await page
        .getByRole("button", { name: "Edit passage", exact: true })
        .click();
      await page
        .getByLabel("Transcript text")
        .fill("Saved draft survives activation.");
      // Modal editors make the page inert; the handler also guards accidental activation.
      await page.locator(".update button").evaluate((button) => button.click());
      await expect(page.getByLabel("Transcript text")).toHaveValue(
        "Saved draft survives activation.",
      );
      await page
        .getByRole("button", { name: "Save correction", exact: true })
        .click();
      const sidebarUpdate = page.locator(".pwa-sidebar").getByRole("button", { name: "Open update confirmation", exact: true });
      await sidebarUpdate.click();
      await page.locator(".pwa-sidebar").getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(sidebarUpdate).toBeFocused();
      assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state), "installed");
      await expect(page.locator('meta[name="pwa-test-release"]')).toHaveAttribute("content", "initial");
      await sidebarUpdate.click();
      await Promise.all([
        page.waitForEvent(
          "framenavigated",
          (frame) => frame === page.mainFrame(),
        ),
        page.locator(".pwa-sidebar").getByRole("button", { name: "Confirm update", exact: true }).click(),
      ]);
      await page
        .getByRole("heading", { name: "Preserved across update", exact: true })
        .waitFor();
      await page.waitForFunction(
        () => !document.body.textContent.includes("Updating…"),
      );
      const keys = await page.evaluate(() => caches.keys());
      assert(keys.includes("unrelated-app-sentinel"));
      assert(keys.some((key) => key.includes("update-check")));
      await expect(
        page.getByText("Saved draft survives activation.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Settings & API keys" }).click();
      await expect(
        page.getByLabel("OpenAI API key", { exact: true }),
      ).toHaveValue("synthetic-update-only");
      await expect(page.getByLabel("Memo model ID")).toHaveValue("gpt-6.1-sol");
      await page.evaluate((value) => {
        location.hash = value;
      }, hash);
      await page
        .getByText("Saved draft survives activation.", { exact: true })
        .waitFor();
      await browser.contexts()[0].setOffline(true);
      await page.reload();
      await expect(
        page.locator('meta[name="pwa-test-release"]'),
      ).toHaveAttribute("content", "next");
      await browser.contexts()[0].setOffline(false);
      assert.equal(
        await page.evaluate(
          async (base) =>
            (await fetch(base + "assets/old-client-only.js")).text(),
          base,
        ),
        "old client asset preserved",
      );

      // A worker that never activates must expose failure and permit a forward fix.
      const stalled = fixtureRelease("activation-failure", "next");
      release = {
        ...stalled,
        worker: stalled.worker.replace("void self.skipWaiting()", 'event.source?.postMessage({ type: "PWA_TEST_ACTIVATION_ATTEMPT" })'),
      };
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .waitFor();
      await page.clock.install();
      await page.evaluate(() => {
        window.__pwaActivationAttempted = false;
        navigator.serviceWorker.addEventListener("message", function acknowledge(event) {
          if (event.data?.type !== "PWA_TEST_ACTIVATION_ATTEMPT") return;
          window.__pwaActivationAttempted = true;
          navigator.serviceWorker.removeEventListener("message", acknowledge);
        });
      });
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .click();
      await page.getByRole("button", { name: "Confirm update", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Updating…", exact: true }),
      ).toBeVisible();
      // The runtime arms its deadline before posting SKIP_WAITING; Updating… alone precedes async save/registration work.
      await page.waitForFunction(() => window.__pwaActivationAttempted);
      console.log(`ACK ${name}: nonactivating worker received SKIP_WAITING before the clock advance`);
      await page.clock.fastForward(15001);
      await expect(
        page.getByText("Update did not activate. Try again when connected.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Saved draft survives activation.", { exact: true }),
      ).toBeVisible();
      release = fixtureRelease("forward-recovery", "forward");
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await page.waitForFunction(async () => {
        const reg = await navigator.serviceWorker.ready;
        return (
          !reg.installing &&
          reg.waiting?.state === "installed" &&
          (await caches.keys()).some((key) => key.includes("forward-recovery"))
        );
      });
      // The second waiting worker is a replacement for the deliberately faulty one.
      await page.waitForFunction(
        () => !document.body.textContent.includes("Updating…"),
      );
      await page.getByRole("button", { name: "Update now", exact: true }).click();
      await Promise.all([
        page.waitForEvent(
          "framenavigated",
          (frame) => frame === page.mainFrame(),
        ),
        page.getByRole("button", { name: "Confirm update", exact: true }).click(),
      ]);
      await expect(
        page.getByRole("heading", {
          name: "Preserved across update",
          exact: true,
        }),
      ).toBeVisible();
      await page.waitForFunction(async () =>
        (await caches.keys()).some((key) => key.includes("forward-recovery")),
      );
      await expect(
        page.getByText("Saved draft survives activation.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Settings & API keys" }).click();
      await expect(
        page.getByLabel("OpenAI API key", { exact: true }),
      ).toHaveValue("synthetic-update-only");
      await expect(page.getByLabel("Memo model ID")).toHaveValue("gpt-6.1-sol");
      await page.evaluate((value) => {
        location.hash = value;
      }, hash);
      await page
        .getByText("Saved draft survives activation.", { exact: true })
        .waitFor();
      await browser.contexts()[0].setOffline(true);
      await page.reload();
      await expect(
        page.locator('meta[name="pwa-test-release"]'),
      ).toHaveAttribute("content", "forward");
      await browser.contexts()[0].setOffline(false);
      console.log(
        `PASS ${name}: N→N+1, active-request/editor protection, saved draft, old asset, unrelated cache, visible activation failure and forward recovery`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
