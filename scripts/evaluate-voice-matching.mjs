import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 64 * 1024 * 1024;
const fail = () => {
  throw new Error("Invalid or oversized voice evaluation export. Use the file the app exports.");
};

function cosine(a, b) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : Number.NaN;
}
function mean(vectors) {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i] / vectors.length;
  return out;
}
const minus = (v, c) => v.map((x, i) => x - c[i]);
const quantile = (sorted, f) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * (sorted.length - 1))))] : null;
const ratio = (n, d) => (d ? n / d : null);
/** Number of values in an ascending array that are below the threshold. */
function below(sorted, threshold) {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < threshold) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Same-person and different-person similarity of every pair, and the threshold
 * where wrongly accepting and wrongly rejecting are closest to equal.
 */
function pairStatistics(items) {
  const same = [],
    different = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const score = cosine(items[i].vector, items[j].vector);
      if (!Number.isFinite(score)) continue;
      (items[i].reference === items[j].reference ? same : different).push(score);
    }
  same.sort((a, b) => a - b);
  different.sort((a, b) => a - b);
  let best = null;
  if (same.length && different.length) {
    for (const threshold of new Set([...same, ...different])) {
      const falseReject = below(same, threshold) / same.length;
      const falseAccept = (different.length - below(different, threshold)) / different.length;
      const gap = Math.abs(falseAccept - falseReject);
      if (!best || gap < best.gap || (gap === best.gap && falseAccept + falseReject < best.falseAccept + best.falseReject))
        best = { threshold, falseAccept, falseReject, gap };
    }
  }
  return {
    samePerson: { pairs: same.length, median: quantile(same, 0.5), p10: quantile(same, 0.1) },
    differentPeople: { pairs: different.length, median: quantile(different, 0.5), p90: quantile(different, 0.9) },
    balancedThreshold: best && {
      threshold: best.threshold,
      falseAcceptRate: best.falseAccept,
      falseRejectRate: best.falseReject,
    },
  };
}

/**
 * Offline arithmetic over one exported meeting: saved voice vectors scored against
 * the speakers a person confirmed. No audio is decoded, no model runs and nothing
 * is sent anywhere. The result describes this recording only; it is not a general
 * accuracy figure.
 */
export function evaluateVoiceMatching(data) {
  if (
    data?.schemaVersion !== 1 ||
    data.kind !== "voice-evaluation-export" ||
    !Array.isArray(data.samples) ||
    !Array.isArray(data.decisions) ||
    data.samples.length > 5000 ||
    data.decisions.length > 5000
  )
    fail();
  const dimensions = data.samples[0]?.values?.length ?? 0;
  const seen = new Set();
  for (const s of data.samples) {
    if (
      !s ||
      typeof s.id !== "string" ||
      seen.has(s.id) ||
      !Number.isInteger(s.part) ||
      s.part < 0 ||
      typeof s.label !== "string" ||
      !s.label ||
      !Number.isFinite(s.start) ||
      !Number.isFinite(s.end) ||
      s.end <= s.start ||
      !(s.reference === null || (typeof s.reference === "string" && s.reference.length > 0 && s.reference.length <= 80)) ||
      !Array.isArray(s.values) ||
      s.values.length !== dimensions ||
      dimensions < 2 ||
      dimensions > 4096 ||
      s.values.some((v) => !Number.isFinite(v))
    )
      fail();
    seen.add(s.id);
  }
  for (const d of data.decisions)
    if (
      !d ||
      !Number.isInteger(d.part) ||
      typeof d.label !== "string" ||
      typeof d.state !== "string" ||
      !(d.voice === null || typeof d.voice === "string")
    )
      fail();

  const key = (part, label) => `${part}:${label}`;
  const samples = data.samples;
  const referenced = samples.filter((s) => s.reference !== null);
  const byLabel = new Map();
  for (const s of samples) byLabel.set(key(s.part, s.label), [...(byLabel.get(key(s.part, s.label)) ?? []), s]);

  // A label's reference is the one confirmed speaker of its referenced samples.
  const labelReference = new Map();
  const mixedLabels = [];
  for (const [id, list] of byLabel) {
    const counts = {};
    for (const s of list) if (s.reference !== null) counts[s.reference] = (counts[s.reference] ?? 0) + 1;
    const references = Object.keys(counts);
    if (references.length === 1) labelReference.set(id, references[0]);
    if (references.length > 1) mixedLabels.push({ part: list[0].part, label: list[0].label, samplesPerReference: counts });
  }

  // Three views of the same vectors: as saved, minus the average of all samples
  // (what the app does today), and minus the average of label averages (each label
  // counts once, so a talkative or over-split voice cannot dominate the average).
  const all = samples.map((s) => s.values);
  const views = { raw: (v) => v };
  if (all.length) {
    const sampleCentre = mean(all);
    const labelCentre = mean([...byLabel.values()].map((list) => mean(list.map((s) => s.values))));
    views.centredOnSampleAverage = (v) => minus(v, sampleCentre);
    views.centredOnLabelAverage = (v) => minus(v, labelCentre);
  }
  const samplePairs = {},
    labelPairs = {};
  for (const [name, view] of Object.entries(views)) {
    samplePairs[name] = pairStatistics(referenced.map((s) => ({ reference: s.reference, vector: view(s.values) })));
    labelPairs[name] = pairStatistics(
      [...labelReference].map(([id, reference]) => ({
        reference,
        vector: mean(byLabel.get(id).map((s) => view(s.values))),
      })),
    );
  }

  // The app's saved grouping against the reference, over pairs of labels.
  const undecidedByState = {};
  const scored = [];
  for (const d of data.decisions) {
    const reference = labelReference.get(key(d.part, d.label));
    if (reference === undefined) continue;
    if (d.voice === null) undecidedByState[d.state] = (undecidedByState[d.state] ?? 0) + 1;
    else scored.push({ part: d.part, label: d.label, voice: d.voice, reference });
  }
  let correctMerges = 0,
    wrongMerges = 0,
    missedMerges = 0;
  for (let i = 0; i < scored.length; i++)
    for (let j = i + 1; j < scored.length; j++) {
      const sameVoice = scored[i].voice === scored[j].voice;
      const samePerson = scored[i].reference === scored[j].reference;
      if (sameVoice && samePerson) correctMerges++;
      else if (sameVoice) wrongMerges++;
      else if (samePerson) missedMerges++;
    }
  const peoplePerVoice = new Map();
  for (const s of scored) peoplePerVoice.set(s.voice, (peoplePerVoice.get(s.voice) ?? new Set()).add(s.reference));
  const mixedVoices = [...peoplePerVoice]
    .filter(([, people]) => people.size > 1)
    .map(([voice, people]) => ({ voice, references: [...people].sort() }));

  return {
    schemaVersion: 1,
    kind: "one-recording-human-confirmed-reference",
    scope:
      "Describes this exported meeting only. The reference is the speakers a person confirmed, at provider-label granularity; it is not a general accuracy figure.",
    model: data.model ?? null,
    counts: {
      samples: samples.length,
      samplesWithReference: referenced.length,
      referenceSpeakers: new Set(referenced.map((s) => s.reference)).size,
      labels: byLabel.size,
      labelsWithOneReference: labelReference.size,
      labelsMixingReferences: mixedLabels.length,
    },
    samplePairs,
    labelPairs,
    mixedLabels,
    savedGrouping: {
      labelsScored: scored.length,
      labelsUndecidedByState: undecidedByState,
      voices: peoplePerVoice.size,
      referenceSpeakers: new Set(scored.map((s) => s.reference)).size,
      correctMerges,
      wrongMerges,
      missedMerges,
      mergePrecision: ratio(correctMerges, correctMerges + wrongMerges),
      mergeRecall: ratio(correctMerges, correctMerges + missedMerges),
      voicesMixingPeople: mixedVoices,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) fail();
    if ((await stat(process.argv[2])).size > MAX_BYTES) fail();
    const bytes = await readFile(process.argv[2]);
    if (bytes.byteLength > MAX_BYTES) fail();
    console.log(JSON.stringify(evaluateVoiceMatching(JSON.parse(bytes.toString("utf8"))), null, 2));
  } catch {
    console.error("Voice evaluation failed. Check that the file is an unmodified export from the app and within the size limit.");
    process.exitCode = 1;
  }
}
