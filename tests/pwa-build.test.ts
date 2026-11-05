/// <reference types="node" />

import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const base = "/fixture/";
let fixtureRoot: string | undefined;

const runNodeScript = (script: string) => {
  const result = spawnSync(process.execPath, [script], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: { ...process.env, VITE_BASE_PATH: base },
  });
  return {
    ...result,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

const relativeFromDist = (file: string) =>
  path
    .relative(path.join(fixtureRoot!, "dist"), file)
    .split(path.sep)
    .join("/");

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...(await listFiles(file)));
    else files.push(file);
  }
  return files;
}

function assetsFromWorker(worker: string): string[] {
  const match = worker.match(/const ASSETS\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error("Generated worker has no ASSETS declaration");
  return JSON.parse(match[1]) as string[];
}

async function createFixture() {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "meeting-memo-pwa-"));
  await mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "src", "pwa"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "dist", "assets"), { recursive: true });
  await copyFile(
    path.join(projectRoot, "scripts", "build-pwa.mjs"),
    path.join(fixtureRoot, "scripts", "build-pwa.mjs"),
  );
  await copyFile(
    path.join(projectRoot, "scripts", "check-artifact.mjs"),
    path.join(fixtureRoot, "scripts", "check-artifact.mjs"),
  );
  await writeFile(
    path.join(fixtureRoot, "src", "pwa", "worker.template.js"),
    await readFile(path.join(projectRoot, "src", "pwa", "worker.template.js")),
  );
  await writeFile(
    path.join(fixtureRoot, "dist", "index.html"),
    "<!doctype html><html><head></head><body>fixture</body></html>",
  );
  await writeFile(
    path.join(fixtureRoot, "dist", "assets", "app.js"),
    "console.log('fixture');",
  );
  for (const icon of ["icon-192.png", "icon-512.png", "icon-maskable.png"])
    await writeFile(path.join(fixtureRoot, "dist", icon), "fixture image");
}

afterEach(async () => {
  if (fixtureRoot) {
    const resolvedFixture = path.resolve(fixtureRoot);
    expect(path.dirname(resolvedFixture)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(resolvedFixture)).toMatch(/^meeting-memo-pwa-/);
    await rm(resolvedFixture, { recursive: true, force: true });
  }
  fixtureRoot = undefined;
});

it("builds canonical scoped assets and rejects Windows/dist worker paths", async () => {
  await createFixture();
  const buildScript = path.join(fixtureRoot!, "scripts", "build-pwa.mjs");
  const checkScript = path.join(fixtureRoot!, "scripts", "check-artifact.mjs");
  const firstBuild = runNodeScript(buildScript);
  expect(firstBuild.status, firstBuild.output).toBe(0);

  const workerPath = path.join(fixtureRoot!, "dist", "sw.js");
  const firstWorker = await readFile(workerPath, "utf8");
  const firstAssets = assetsFromWorker(firstWorker);
  const expectedAssets = (await listFiles(path.join(fixtureRoot!, "dist")))
    .filter((file) => relativeFromDist(file) !== "sw.js")
    .map((file) => base + relativeFromDist(file))
    .sort();
  expect([...firstAssets].sort()).toEqual(expectedAssets);
  expect(firstAssets).toContain(`${base}index.html`);
  expect(firstAssets.every((asset) => asset.startsWith(base))).toBe(true);
  expect(firstAssets.every((asset) => !asset.includes("\\"))).toBe(true);
  expect(firstAssets.every((asset) => !asset.includes("/dist/"))).toBe(true);

  const firstVersion = firstWorker.match(/const VERSION\s*=\s*"([^"]+)"/)?.[1];
  expect(firstVersion).toBeTruthy();
  const firstCheck = runNodeScript(checkScript);
  expect(firstCheck.status, firstCheck.output).toBe(0);

  await rename(
    path.join(fixtureRoot!, "dist", "assets", "app.js"),
    path.join(fixtureRoot!, "dist", "assets", "renamed.js"),
  );
  const secondBuild = runNodeScript(buildScript);
  expect(secondBuild.status, secondBuild.output).toBe(0);
  const secondWorker = await readFile(workerPath, "utf8");
  const secondAssets = assetsFromWorker(secondWorker);
  const secondVersion = secondWorker.match(
    /const VERSION\s*=\s*"([^"]+)"/,
  )?.[1];
  expect(secondVersion).not.toBe(firstVersion);
  expect(secondAssets).toContain(`${base}assets/renamed.js`);
  expect(secondAssets).not.toContain(`${base}assets/app.js`);

  for (const badAssets of [
    [`${base}dist\\index.html`],
    [`${base}dist/index.html`],
    [`${base}missing.js`],
    [secondAssets[0], secondAssets[0]],
  ]) {
    const badWorker = secondWorker.replace(
      /const ASSETS\s*=\s*(\[[\s\S]*?\]);/,
      `const ASSETS = ${JSON.stringify(badAssets)};`,
    );
    await writeFile(workerPath, badWorker);
    const badCheck = runNodeScript(checkScript);
    expect(badCheck.status).not.toBe(0);
    expect(badCheck.output).toMatch(
      /slash|dist|canonical|duplicate|match|index|include/i,
    );
  }
});
