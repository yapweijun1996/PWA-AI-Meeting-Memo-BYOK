import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const fail = () => {
  throw new Error(
    "Invalid or oversized speech annotation. Use the documented private evaluation format.",
  );
};
const ratio = (n, d) => (d ? n / d : null);
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(
        Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)),
      );
    row = next;
  }
  return row[b.length];
}
const normalized = (value) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .trim();
function tokens(text, language) {
  if (typeof text !== "string" || text.length > 20000) fail();
  const result =
    language === "zh"
      ? Array.from(normalized(text).replace(/\s/gu, ""))
      : normalized(text).split(/\s+/u).filter(Boolean);
  if (result.length > 5000) fail();
  return result;
}
function ranges(values, speakers = false) {
  if (!Array.isArray(values) || values.length > 1000) fail();
  for (const v of values)
    if (
      !v ||
      !Number.isFinite(v.start) ||
      !Number.isFinite(v.end) ||
      v.start < 0 ||
      v.end <= v.start ||
      (speakers &&
        (typeof v.speaker !== "string" || !v.speaker || v.speaker.length > 80))
    )
      fail();
  return values;
}
// Hungarian assignment on negated overlap durations. Silent padding lets an
// unmatched label use a zero-weight column when the two label counts differ.
function matchSpeakers(slices, referenceLabels, labels) {
  const size = Math.max(referenceLabels.length, labels.length);
  const columns = new Map(
    referenceLabels.map((label, index) => [label, index + 1]),
  );
  const rows = new Map(labels.map((label, index) => [label, index + 1]));
  const costs = Array.from(
    { length: size + 1 },
    () => new Float64Array(size + 1),
  );
  for (const slice of slices)
    for (const hypothesis of slice.h)
      for (const reference of slice.r)
        costs[rows.get(hypothesis)][columns.get(reference)] -= slice.duration;

  const rowPotential = new Float64Array(size + 1);
  const columnPotential = new Float64Array(size + 1);
  const matchedRow = new Int32Array(size + 1);
  for (let row = 1; row <= size; row++) {
    matchedRow[0] = row;
    let column = 0;
    const visited = new Set();
    const slack = new Float64Array(size + 1).fill(Infinity);
    const predecessor = new Int32Array(size + 1);
    do {
      visited.add(column);
      const activeRow = matchedRow[column];
      let nextColumn = 0,
        step = Infinity;
      for (let next = 1; next <= size; next++) {
        if (visited.has(next)) continue;
        const reducedCost =
          costs[activeRow][next] -
          rowPotential[activeRow] -
          columnPotential[next];
        if (reducedCost < slack[next]) {
          slack[next] = reducedCost;
          predecessor[next] = column;
        }
        if (slack[next] < step) {
          step = slack[next];
          nextColumn = next;
        }
      }
      if (!Number.isFinite(step)) fail();
      for (let next = 0; next <= size; next++) {
        if (visited.has(next)) {
          rowPotential[matchedRow[next]] += step;
          columnPotential[next] -= step;
        } else slack[next] -= step;
      }
      column = nextColumn;
    } while (matchedRow[column]);
    while (column) {
      const previous = predecessor[column];
      matchedRow[column] = matchedRow[previous];
      column = previous;
    }
  }
  const mapping = new Map();
  for (let column = 1; column <= referenceLabels.length; column++)
    if (matchedRow[column] <= labels.length)
      mapping.set(labels[matchedRow[column] - 1], referenceLabels[column - 1]);
  return mapping;
}

/** Offline arithmetic over reviewed annotations, never audio analysis or identity recognition. */
export function evaluateSpeech(data) {
  if (
    data?.schemaVersion !== 1 ||
    !Array.isArray(data.runs) ||
    !data.runs.length ||
    data.runs.length > 30
  )
    fail();
  const seen = new Set();
  return {
    schemaVersion: 1,
    kind: "annotated-subset-only",
    runs: data.runs.map((run) => {
      if (
        typeof run.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(run.id) ||
        seen.has(run.id) ||
        !["en", "zh"].includes(run.language)
      )
        fail();
      seen.add(run.id);
      const reference = tokens(run.referenceText, run.language),
        hypothesis = tokens(run.hypothesisText, run.language);
      const r = ranges(run.referenceTurns, true),
        h = ranges(run.hypothesisTurns, true),
        scope = ranges(run.evaluatedRanges);
      if (!scope.length) fail();
      const referenceLabels = [...new Set(r.map((v) => v.speaker))],
        labels = [...new Set(h.map((v) => v.speaker))];
      if (referenceLabels.length > 50 || labels.length > 50) fail();
      const boundaries = [
        ...new Set([...r, ...h, ...scope].flatMap((v) => [v.start, v.end])),
      ].sort((a, b) => a - b);
      const slices = [];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i],
          end = boundaries[i + 1],
          at = (start + end) / 2;
        if (!scope.some((v) => v.start <= at && at < v.end)) continue;
        slices.push({
          duration: end - start,
          r: new Set(
            r.filter((v) => v.start <= at && at < v.end).map((v) => v.speaker),
          ),
          h: new Set(
            h.filter((v) => v.start <= at && at < v.end).map((v) => v.speaker),
          ),
        });
      }
      const bestMap = matchSpeakers(slices, referenceLabels, labels);
      let denominator = 0,
        miss = 0,
        falseAlarm = 0,
        confusion = 0,
        evaluatedSeconds = 0;
      for (const s of slices) {
        const correct = [...s.h].filter((v) => s.r.has(bestMap.get(v))).length;
        denominator += s.r.size * s.duration;
        evaluatedSeconds += s.duration;
        miss += Math.max(0, s.r.size - s.h.size) * s.duration;
        falseAlarm += Math.max(0, s.h.size - s.r.size) * s.duration;
        confusion += (Math.min(s.r.size, s.h.size) - correct) * s.duration;
      }
      const textErrors = distance(reference, hypothesis);
      return {
        id: run.id,
        language: run.language,
        textMetric: run.language === "zh" ? "CER" : "WER",
        textErrors,
        referenceUnits: reference.length,
        textErrorRate: ratio(textErrors, reference.length),
        evaluatedSeconds,
        referenceSpeakerSeconds: denominator,
        missSpeakerSeconds: miss,
        falseAlarmSpeakerSeconds: falseAlarm,
        confusionSpeakerSeconds: confusion,
        diarizationErrorRate: ratio(miss + falseAlarm + confusion, denominator),
        labelMapping:
          "one optimal mapping per run; no collar; overlaps included",
      };
    }),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (!process.argv[2]) fail();
    if ((await stat(process.argv[2])).size > 2 * 1024 * 1024) fail();
    const bytes = await readFile(process.argv[2]);
    if (bytes.byteLength > 2 * 1024 * 1024) fail();
    console.log(
      JSON.stringify(
        evaluateSpeech(JSON.parse(bytes.toString("utf8"))),
        null,
        2,
      ),
    );
  } catch {
    console.error(
      "Speech evaluation failed. Check the private annotation format and resource limits.",
    );
    process.exitCode = 1;
  }
}
