import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const script = fileURLToPath(
  new URL("../scripts/benchmark-playback.mjs", import.meta.url),
);
test("synthetic playback benchmark reports bounded windows and preserves reachable overlap evidence", () => {
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, "--quick"],
    { encoding: "utf8" },
  );
  expect(run.status, run.stderr).toBe(0);
  const result = JSON.parse(run.stdout);
  expect(result.format).toBe("meeting-memo-synthetic-playback-benchmark");
  expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.cases).toHaveLength(3);
  for (const item of result.cases) {
    expect(item.segments).toBe(1000);
    expect(item.reachableCaptions).toBe(item.captions);
    expect(item.maxRenderedTranscriptRows).toBeLessThanOrEqual(40);
    expect(Number.isFinite(item.preparationMs)).toBe(true);
    expect(item.preparationMs).toBeGreaterThanOrEqual(0);
    expect(item.projectionMs.p95).toBeGreaterThanOrEqual(
      item.projectionMs.median,
    );
  }
  const overlap = result.cases.find(
    (item: { kind: string }) => item.kind === "overlap-100",
  );
  expect(overlap.maxActiveCaptions).toBe(100);
  expect(overlap.maxRelevantLabels).toBe(100);
  expect(overlap.maxActiveOutsideTranscriptWindow).toBeGreaterThan(0);
});

test("benchmark rejects paths instead of opening user recordings", () => {
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, "private-recording.wav"],
    { encoding: "utf8" },
  );
  expect(run.status).not.toBe(0);
  expect(run.stdout).toBe("");
  expect(run.stderr).toContain("accepts no private recordings or paths");
});
