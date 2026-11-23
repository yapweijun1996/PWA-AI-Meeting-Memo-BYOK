import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const decisionKeys = new Set();
  for (const d of data.decisions) {
    if (
      !d ||
      !Number.isInteger(d.part) ||
      d.part < 0 ||
      typeof d.label !== "string" ||
      !d.label ||
      typeof d.state !== "string" ||
      !d.state ||
      !(d.voice === null || typeof d.voice === "string")
    )
      fail();
    const decisionKey = `${d.part}:${d.label}`;
    if (decisionKeys.has(decisionKey)) fail();
    decisionKeys.add(decisionKey);
  }

  const differentPairs = data.differentLabelPairs ?? [];
  if (
    !Array.isArray(differentPairs) ||
    differentPairs.length > 100000 ||
    differentPairs.some((pair) => !Array.isArray(pair) || pair.length !== 2 || pair.some((value) => typeof value !== "string"))
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
    const counts = new Map();
    for (const s of list) if (s.reference !== null) counts.set(s.reference, (counts.get(s.reference) ?? 0) + 1);
    const references = [...counts.keys()];
    if (references.length === 1) labelReference.set(id, references[0]);
    if (references.length > 1) mixedLabels.push({ part: list[0].part, label: list[0].label, samplesPerReference: Object.fromEntries(counts) });
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
  const saved = scoreGrouping(
    data.decisions.map((d) => ({ key: key(d.part, d.label), state: d.state, voice: d.voice })),
    labelReference,
    differentPairs,
  );

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
      labelsWithoutReference: byLabel.size - labelReference.size - mixedLabels.length,
    },
    samplePairs,
    labelPairs,
    mixedLabels,
    savedGrouping: saved,
  };
}

/**
 * Score one grouping of labels into voices against the reference, over pairs of
 * labels: a correct merge joins two labels of one person, a wrong merge joins two
 * people, a missed merge leaves one person's labels apart.
 */
function scoreGrouping(decisions, labelReference, differentPairs) {
  const undecidedByState = new Map();
  const labelsWithDecision = new Set();
  const scored = [];
  for (const d of decisions) {
    const reference = labelReference.get(d.key);
    if (reference === undefined) continue;
    labelsWithDecision.add(d.key);
    if (d.voice === null) undecidedByState.set(d.state, (undecidedByState.get(d.state) ?? 0) + 1);
    else scored.push({ voice: d.voice, reference });
  }
  const labelsPerPerson = new Map();
  let referenceSamePersonPairs = 0;
  for (const reference of labelReference.values()) {
    const previous = labelsPerPerson.get(reference) ?? 0;
    referenceSamePersonPairs += previous;
    labelsPerPerson.set(reference, previous + 1);
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
  // Label pairs a person judged different that this grouping put in one voice anyway.
  const voiceOfLabel = new Map(decisions.filter((d) => d.voice !== null).map((d) => [d.key, d.voice]));
  const joined = differentPairs.filter(
    ([left, right]) => voiceOfLabel.has(left) && voiceOfLabel.get(left) === voiceOfLabel.get(right),
  ).length;
  const peoplePerVoice = new Map();
  for (const s of scored) peoplePerVoice.set(s.voice, (peoplePerVoice.get(s.voice) ?? new Set()).add(s.reference));
  return {
    labelsScored: scored.length,
    labelsUndecidedByState: Object.fromEntries(undecidedByState),
    labelsMissingDecision: labelReference.size - labelsWithDecision.size,
    referenceLabels: labelReference.size,
    labelDecisionCoverage: ratio(scored.length, labelReference.size),
    voices: peoplePerVoice.size,
    referenceSpeakers: new Set(scored.map((s) => s.reference)).size,
    correctMerges,
    wrongMerges,
    missedMerges,
    referenceSamePersonPairs,
    unresolvedSamePersonPairs: referenceSamePersonPairs - correctMerges - missedMerges,
    mergePrecision: ratio(correctMerges, correctMerges + wrongMerges),
    mergeRecall: ratio(correctMerges, correctMerges + missedMerges),
    mergeRecallAllReferencedPairs: ratio(correctMerges, referenceSamePersonPairs),
    voicesMixingPeople: [...peoplePerVoice]
      .filter(([, people]) => people.size > 1)
      .map(([voice, people]) => ({ voice, references: [...people].sort() })),
    humanDifferentPairs: differentPairs.length,
    humanDifferentPairsJoined: joined,
  };
}

const REPLAY_FLOORS = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
const REPLAY_MARGINS = [0.05, 0.1, 0.15];

/**
 * Run the app's own multi-part matcher again on the exported vectors under other
 * settings and score every result. `matcher` is the app module
 * (`src/domain/acoustic-speaker.ts`), passed in so this file holds no second copy
 * of the matching rules. Settings chosen here fit this one recording: confirm
 * them on another recording before changing the app.
 */
export function replayVoiceMatching(data, matcher) {
  const base = evaluateVoiceMatching(data);
  const key = (part, label) => `${part}:${label}`;
  const labelReference = new Map();
  const byLabel = new Map();
  for (const s of data.samples) byLabel.set(key(s.part, s.label), [...(byLabel.get(key(s.part, s.label)) ?? []), s]);
  for (const [id, list] of byLabel) {
    const references = [...new Set(list.filter((s) => s.reference !== null).map((s) => s.reference))];
    if (references.length === 1) labelReference.set(id, references[0]);
  }
  const differentPairs = data.differentLabelPairs ?? [];
  const recordingHash = "0".repeat(64);
  const embeddings = data.samples.map((s) => ({
    id: s.id,
    meetingId: "evaluation",
    recordingHash,
    sourceRevision: 1,
    chunkIndex: s.part,
    sourceSpeakerId: s.label,
    sample: { id: s.id, chunkIndex: s.part, sourceSpeakerId: s.label, startSeconds: s.start, endSeconds: s.end, segmentIds: [] },
    modelId: data.model?.id ?? "unknown",
    modelRevision: data.model?.revision ?? "unknown",
    extractionVersion: data.model?.extractionVersion ?? "unknown",
    values: s.values,
    createdAt: data.exportedAt ?? new Date(0).toISOString(),
  }));
  const run = (name, options) => {
    const rules = {
      ...matcher.PART_MATCH_POLICY,
      floorCosine: options.floorCosine ?? matcher.PART_MATCH_POLICY.floorCosine,
      margin: options.margin ?? matcher.PART_MATCH_POLICY.margin,
      centre: options.centre ?? "samples",
      ...(options.purityCheck === false ? { purityMargin: null } : {}),
      ...(options.forceHeadCount ? { headCountFloorCosine: Number.NEGATIVE_INFINITY } : {}),
    };
    const result = matcher.matchLabelsAcrossParts(
      {
        meetingId: "evaluation",
        recordingHash,
        sourceRevision: 1,
        embeddings,
        expectedVoices: options.expectedVoices,
        constraints: options.useHumanDifferentPairs ? { mustLink: [], cannotLink: differentPairs } : undefined,
      },
      matcher.ACOUSTIC_POLICY,
      rules,
    );
    const identities = [...new Set(result.assignments.map((a) => a.identityId).filter(Boolean))];
    const score = scoreGrouping(
      result.assignments.map((a) => ({
        key: a.sourceKey,
        state: a.state,
        voice: a.identityId && (a.state === "matched" || a.state === "new_identity") ? `V${identities.indexOf(a.identityId) + 1}` : null,
      })),
      labelReference,
      differentPairs,
    );
    return {
      name,
      floorCosine: rules.floorCosine,
      margin: rules.margin,
      centre: rules.centre,
      expectedVoices: options.expectedVoices ?? null,
      humanDifferentPairsUsed: Boolean(options.useHumanDifferentPairs),
      voices: score.voices,
      labelsScored: score.labelsScored,
      labelsUndecided: Object.values(score.labelsUndecidedByState).reduce((sum, count) => sum + count, 0),
      labelsMissingDecision: score.labelsMissingDecision,
      referenceLabels: score.referenceLabels,
      labelDecisionCoverage: score.labelDecisionCoverage,
      correctMerges: score.correctMerges,
      wrongMerges: score.wrongMerges,
      missedMerges: score.missedMerges,
      referenceSamePersonPairs: score.referenceSamePersonPairs,
      unresolvedSamePersonPairs: score.unresolvedSamePersonPairs,
      mergePrecision: score.mergePrecision,
      mergeRecall: score.mergeRecall,
      mergeRecallAllReferencedPairs: score.mergeRecallAllReferencedPairs,
      humanDifferentPairsJoined: score.humanDifferentPairsJoined,
    };
  };
  const people = base.counts.referenceSpeakers;
  const runs = [run("current settings", {})];
  if (people > 0) runs.push(run("current settings with the reference head count", { expectedVoices: people }));
  if (differentPairs.length) {
    runs.push(run("current settings with human different pairs", { useHumanDifferentPairs: true }));
    if (people > 0) runs.push(run("reference head count with human different pairs", { expectedVoices: people, useHumanDifferentPairs: true }));
  }
  // The two safeguards, each switched off, to see what it costs or saves on this recording.
  runs.push(run("without the mixed-label check", { purityCheck: false }));
  if (people > 0) runs.push(run("reference head count, forcing dissimilar voices together", { expectedVoices: people, forceHeadCount: true }));
  // The average removed before comparing: all samples (the app's default), one vote per label, one vote per voice.
  for (const centre of ["labels", "voices"]) {
    runs.push(run(`centre on ${centre}`, { centre }));
    if (people > 0) runs.push(run(`centre on ${centre} with the reference head count`, { centre, expectedVoices: people }));
  }
  for (const floorCosine of REPLAY_FLOORS)
    for (const margin of REPLAY_MARGINS) {
      if (floorCosine === matcher.PART_MATCH_POLICY.floorCosine && margin === matcher.PART_MATCH_POLICY.margin) continue;
      runs.push(run(`floor ${floorCosine}, margin ${margin}`, { floorCosine, margin }));
    }
  return {
    ...base,
    replay: {
      scope:
        "The app's multi-part matcher re-run on these vectors. Settings that look best here fit this one recording; confirm on another before changing the app.",
      runs,
    },
  };
}

/** Load the app's matcher from its TypeScript source, so the replay cannot drift from the app. */
async function loadMatcher() {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, ws: false, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await server.ssrLoadModule("/src/domain/acoustic-speaker.ts");
  } finally {
    await server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) fail();
    if ((await stat(process.argv[2])).size > MAX_BYTES) fail();
    const bytes = await readFile(process.argv[2]);
    if (bytes.byteLength > MAX_BYTES) fail();
    const data = JSON.parse(bytes.toString("utf8"));
    const result = process.argv.includes("--replay") ? replayVoiceMatching(data, await loadMatcher()) : evaluateVoiceMatching(data);
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error("Voice evaluation failed. Check that the file is an unmodified export from the app and within the size limit.");
    process.exitCode = 1;
  }
}
