import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { performance } from "node:perf_hooks";
import {
  buildPlaybackCaptions,
  captionsAtTime,
  captionContextAtTime,
  playbackBoundaries,
  playbackCaptionWindowStart,
  snapToPlaybackInterval,
} from "../src/domain/playback.ts";

const flags = process.argv.slice(2);
if (flags.some((flag) => !["--quick", "--help"].includes(flag)))
  throw new Error(
    "Use --quick or --help; this benchmark accepts no private recordings or paths.",
  );
if (flags.includes("--help")) {
  console.log(
    "node --experimental-strip-types scripts/benchmark-playback.mjs [--quick]\nSynthetic projection timings only; no audio, DOM, provider requests or private inputs.",
  );
  process.exit(0);
}
const quick = flags.includes("--quick");
const sampleCount = quick ? 20 : 200;
const sizes = quick ? [1000] : [1000, 5000, 20000];
const limit = 40;
const uuid = (prefix, index) =>
  `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const percentile = (values, fraction) =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const rounded = (value) => Number(value.toFixed(4));
const cases = [];
for (const count of sizes)
  for (const kind of ["sequential", "overlap-100", "long-caption"]) {
    const sources = Array.from({ length: count }, (_, index) => {
      const batch = Math.floor(index / 100);
      const start = kind === "overlap-100" ? batch * 25 : index * 0.25;
      const text =
        kind === "long-caption" && index < 100
          ? "库存 ERP conditions. ".repeat(1000)
          : `Source ${index + 1}: retain quantities, uncertainty and original attribution.`;
      return {
        id: uuid("10000000", index),
        revision: 1,
        start,
        end: start + (kind === "overlap-100" ? 10 : 0.2),
        speakerIds: [uuid("20000000", index % 100)],
        text,
        originalText: text,
        reviewed: false,
        parents: [],
      };
    });
    const before = performance.now();
    const captions = buildPlaybackCaptions(sources);
    const boundaries = playbackBoundaries(sources, captions);
    const preparationMs = performance.now() - before;
    const positions = Array.from({ length: sampleCount }, (_, index) => {
      if (kind === "overlap-100")
        return (
          ((index * 7919) % Math.ceil(count / 100)) * 25 + (index % 2 ? 5 : 15)
        );
      return ((index * 7919) % count) * 0.25 + (index % 2 ? 0.1 : 0.22);
    });
    let maxActive = 0,
      maxLabels = 0,
      maxOutside = 0,
      maxWindow = 0;
    const project = (position) => {
      const exact = snapToPlaybackInterval(boundaries, position);
      const current = captionsAtTime(captions, exact);
      const context = captionContextAtTime(captions, exact);
      const start = playbackCaptionWindowStart(captions, exact, limit);
      const window = captions.slice(start, start + limit);
      let lastEnd = -Infinity;
      let last = [];
      if (!current.length && !context.length)
        for (const caption of captions) {
          if (caption.end > exact || caption.end < lastEnd) continue;
          if (caption.end > lastEnd) {
            lastEnd = caption.end;
            last = [];
          }
          last.push(caption);
        }
      const labels = new Set(
        (current.length ? current : context.length ? context : last).flatMap(
          (caption) => caption.speakerIds,
        ),
      );
      return { current, window, labels };
    };
    for (const position of positions.slice(0, 10)) project(position);
    const timings = [];
    for (const position of positions) {
      const began = performance.now();
      const result = project(position);
      timings.push(performance.now() - began);
      const displayed = new Set(result.window.map((caption) => caption.id));
      maxActive = Math.max(maxActive, result.current.length);
      maxLabels = Math.max(maxLabels, result.labels.size);
      maxOutside = Math.max(
        maxOutside,
        result.current.filter((caption) => !displayed.has(caption.id)).length,
      );
      maxWindow = Math.max(maxWindow, result.window.length);
    }
    timings.sort((a, b) => a - b);
    const reachable = new Set();
    for (let offset = 0; offset < captions.length; offset += limit)
      for (const caption of captions.slice(offset, offset + limit))
        reachable.add(caption.id);
    if (reachable.size !== captions.length || maxWindow > limit)
      throw new Error("Synthetic bounded-window source reachability failed.");
    cases.push({
      kind,
      segments: count,
      labels: 100,
      characters: sources.reduce((sum, source) => sum + source.text.length, 0),
      durationSeconds: Math.max(...sources.map((source) => source.end)),
      captions: captions.length,
      boundaries: boundaries.length,
      preparationMs: rounded(preparationMs),
      projectionMs: {
        median: rounded(percentile(timings, 0.5)),
        p95: rounded(percentile(timings, 0.95)),
        max: rounded(timings.at(-1)),
      },
      samples: timings.length,
      maxActiveCaptions: maxActive,
      maxRelevantLabels: maxLabels,
      maxRenderedTranscriptRows: maxWindow,
      maxActiveOutsideTranscriptWindow: maxOutside,
      reachableCaptions: reachable.size,
    });
  }
console.log(
  JSON.stringify(
    {
      format: "meeting-memo-synthetic-playback-benchmark",
      version: 1,
      date: new Date().toISOString(),
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? "unknown",
      visibleMemoryBytes: os.totalmem(),
      sourceSha256: createHash("sha256")
        .update(
          await readFile(new URL("../src/domain/playback.ts", import.meta.url)),
        )
        .digest("hex"),
      scope:
        "In-process synthetic caption preparation and projection. Timings exclude DOM, paint, IndexedDB, decoding, audio output, device suspension and physical safe areas. No provider requests or private data.",
      cases,
    },
    null,
    2,
  ),
);
