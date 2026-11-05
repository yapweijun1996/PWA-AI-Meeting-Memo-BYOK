import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, webkit, expect } from "@playwright/test";
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
let activeWorker = sw;
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
    target === base + "sw.js" ? Buffer.from(activeWorker) : files.get(target);
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[path.extname(target)] || "application/octet-stream",
    "Cache-Control": "public, max-age=600",
  });
  const release = activeWorker.includes("forward-recovery")
    ? "forward"
    : activeWorker === sw
      ? "initial"
      : "next";
  res.end(
    target === base + "index.html"
      ? file
          .toString()
          .replace(
            "<head>",
            `<head><meta name="pwa-test-release" content="${release}">`,
          )
      : file,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}${base}`;
try {
  for (const [name, engine] of [
    ["Chromium", chromium],
    ["WebKit", webkit],
  ]) {
    activeWorker = sw;
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
        .getByRole("button", { name: "Confirm and send", exact: true })
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
      activeWorker = next;
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
      page.once("dialog", (d) => d.accept());
      await Promise.all([
        page.waitForEvent(
          "framenavigated",
          (frame) => frame === page.mainFrame(),
        ),
        page.getByRole("button", { name: "Update now", exact: true }).click(),
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
      activeWorker = next
        .replace("-update-check", "-activation-failure")
        .replace("void self.skipWaiting()", "void 0");
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .waitFor();
      await page.clock.install();
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Updating…", exact: true }),
      ).toBeVisible();
      await page.clock.fastForward(15001);
      await expect(
        page.getByText("Update did not activate. Try again when connected.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Saved draft survives activation.", { exact: true }),
      ).toBeVisible();
      activeWorker = next.replace("-update-check", "-forward-recovery");
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
      page.once("dialog", (d) => d.accept());
      await Promise.all([
        page.waitForEvent(
          "framenavigated",
          (frame) => frame === page.mainFrame(),
        ),
        page.getByRole("button", { name: "Update now", exact: true }).click(),
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
