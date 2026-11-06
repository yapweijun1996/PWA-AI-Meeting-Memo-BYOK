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
