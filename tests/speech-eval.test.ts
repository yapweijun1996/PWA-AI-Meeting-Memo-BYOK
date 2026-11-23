import { expect, test } from "vitest";
// @ts-expect-error The offline read-only CLI is JavaScript.
import { evaluateSpeech } from "../scripts/evaluate-speech-annotations.mjs";

const run = {
  id: "synthetic",
  language: "en",
  referenceText: "one two",
  hypothesisText: "one three",
  referenceTurns: [
    { start: 0, end: 1, speaker: "A" },
    { start: 1, end: 2, speaker: "B" },
  ],
  hypothesisTurns: [{ start: 0, end: 2, speaker: "X" }],
  evaluatedRanges: [{ start: 0, end: 3 }],
};
test("speech metrics use one mapping per run rather than remapping every turn", () => {
  const [result] = evaluateSpeech({ schemaVersion: 1, runs: [run] }).runs;
  expect(result.textErrors).toBe(1);
  expect(result.textErrorRate).toBe(0.5);
  expect(result.confusionSpeakerSeconds).toBe(1);
  expect(result.diarizationErrorRate).toBe(0.5);
});
test("silence, overlap and excluded unannotated ranges keep separate denominators", () => {
  const [result] = evaluateSpeech({
    schemaVersion: 1,
    runs: [
      {
        ...run,
        referenceTurns: [
          { start: 0, end: 2, speaker: "A" },
          { start: 0, end: 2, speaker: "B" },
        ],
        hypothesisTurns: [{ start: 0, end: 3, speaker: "X" }],
        evaluatedRanges: [{ start: 0, end: 3 }],
      },
    ],
  }).runs;
  expect(result.referenceSpeakerSeconds).toBe(4);
  expect(result.missSpeakerSeconds).toBe(2);
  expect(result.falseAlarmSpeakerSeconds).toBe(1);
  expect(result.diarizationErrorRate).toBe(0.75);
  const empty = evaluateSpeech({
    schemaVersion: 1,
    runs: [
      {
        ...run,
        referenceText: "",
        hypothesisText: "",
        referenceTurns: [],
        hypothesisTurns: [],
      },
    ],
  }).runs[0];
  expect(empty.textErrorRate).toBeNull();
  expect(empty.diarizationErrorRate).toBeNull();
});
test("Chinese CER normalization and malformed intervals are explicit", () => {
  const value = evaluateSpeech({
    schemaVersion: 1,
    runs: [
      {
        ...run,
        language: "zh",
        referenceText: "你好。",
        hypothesisText: "你们",
      },
    ],
  }).runs[0];
  expect(value.textErrors).toBe(1);
  expect(() =>
    evaluateSpeech({
      schemaVersion: 1,
      runs: [{ ...run, referenceTurns: [{ start: 2, end: 1, speaker: "A" }] }],
    }),
  ).toThrow("Invalid");
});

test.each([6, 50])(
  "scores a global permutation of %i anonymous speakers",
  (count) => {
    const turns = Array.from({ length: count }, (_, i) => ({
      start: i,
      end: i + 1,
      speaker: String(i),
    }));
    const referenceTurns = [
      ...turns,
      { start: count, end: count + 1, speaker: "0" },
    ];
    const hypothesisTurns = turns.map(({ start, end }, i) => ({
      start,
      end,
      speaker: String((i + 1) % count),
    }));
    hypothesisTurns.push({ start: count, end: count + 1, speaker: "0" });
    const result = evaluateSpeech({
      schemaVersion: 1,
      runs: [
        {
          ...run,
          referenceTurns,
          hypothesisTurns,
          evaluatedRanges: [{ start: 0, end: count + 1 }],
        },
      ],
    }).runs[0];
    expect(result.referenceSpeakerSeconds).toBe(count + 1);
    expect(result.confusionSpeakerSeconds).toBe(1);
    expect(result.diarizationErrorRate).toBe(1 / (count + 1));
  },
);

test("global speaker assignment can outweigh the strongest individual pair", () => {
  const times = [
    { start: 0, end: 9, ref: "A", hyp: "X" },
    { start: 9, end: 17, ref: "B", hyp: "X" },
    { start: 17, end: 25, ref: "A", hyp: "Y" },
  ];
  const result = evaluateSpeech({
    schemaVersion: 1,
    runs: [
      {
        ...run,
        referenceTurns: times.map(({ start, end, ref }) => ({
          start,
          end,
          speaker: ref,
        })),
        hypothesisTurns: times.map(({ start, end, hyp }) => ({
          start,
          end,
          speaker: hyp,
        })),
        evaluatedRanges: [{ start: 0, end: 25 }],
      },
    ],
  }).runs[0];
  expect(result.confusionSpeakerSeconds).toBe(9);
});
