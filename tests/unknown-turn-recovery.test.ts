import { describe, expect, it, vi } from "vitest";
import { segment, type Segment } from "../src/domain/model";
import { recoverUnknownTurns } from "../src/jobs/unknown-turn-recovery";
import type {
  AcousticSampleWindow,
  AcousticSourcePart,
} from "../src/domain/acoustic-speaker";
import type { TurnContextVerdict } from "../src/domain/turn-context";

const { audio, semantics } = vi.hoisted(() => ({
  audio: vi.fn(),
  semantics: vi.fn(),
}));
vi.mock("../src/audio/acoustic-audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/audio/acoustic-audio")>()),
  decodeAcousticWindow: audio,
}));
vi.mock("../src/domain/turn-context", () => ({
  reviewTurnContinuity: semantics,
}));

async function masked(
  options: {
    middleVoice?: number;
    middleText?: string;
    verdict?: TurnContextVerdict;
    silent?: boolean;
    overlap?: boolean;
    rawOverlap?: boolean;
    rawMultiAnchor?: boolean;
    detected?: { start: number; end: number };
    staleHash?: boolean;
    overlapOnlyRival?: boolean;
    rivalVoice?: number;
    edit?: Partial<Segment>;
    rawSpeaker?: boolean;
    changedAnchor?: boolean;
    maxEnd?: number;
  } = {},
) {
  // The truth and acoustic input are fixed before masking. IDs and display labels
  // are irrelevant: two different voices may occupy the identical A–?–A turn shape.
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const current = [
    segment("The contract also covers", [a], 1, 4),
    segment(
      options.middleText ?? "several independently approved exceptions",
      [],
      4,
      6,
    ),
    segment("when a new version ships.", [options.changedAnchor ? b : a], 6, 9),
    segment("A separate person's passage.", [b], 10, 13),
  ];
  if (options.overlap) current.push(segment("Concurrent voice", [b], 5, 5.5));
  if (options.overlapOnlyRival)
    current.push(
      segment("Two other voices", [a, crypto.randomUUID()], 14, 14.5),
    );
  const original = current.map((s) => ({ ...s, speakerIds: [] as string[] }));
  if (options.rawOverlap)
    original.push(segment("Archived simultaneous passage", [b], 5, 5.5));
  if (options.rawMultiAnchor) original[0]!.speakerIds = [a, b];
  if (options.rawSpeaker) original[1]!.speakerIds = [b];
  Object.assign(current[1]!, options.edit);
  const angles = [0, options.middleVoice ?? 0, 2, options.rivalVoice ?? 90];
  audio
    .mockReset()
    .mockImplementation(
      async (
        _bytes: ArrayBuffer,
        _part: AcousticSourcePart,
        sample: AcousticSampleWindow,
      ) => {
        const index = current.findIndex(
          (s) => s.start! < sample.startSeconds && s.end! > sample.endSeconds,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        expect(sample.endSeconds - sample.startSeconds).toBeLessThanOrEqual(4);
        const theta = (angles[index]! * Math.PI) / 180;
        return options.silent && index === 1
          ? new Float32Array(2)
          : Float32Array.from([0.1 * Math.cos(theta), 0.1 * Math.sin(theta)]);
      },
    );
  semantics.mockReset().mockResolvedValue(options.verdict ?? "unavailable");
  let active = 0,
    maxActive = 0;
  const provider = {
    async load() {},
    dispose() {},
    async embed(values: Float32Array) {
      active++;
      maxActive = Math.max(active, maxActive);
      await Promise.resolve();
      active--;
      return Array.from(values);
    },
  };
  const readPart = vi.fn(async () => new ArrayBuffer(0));
  const recovered = await recoverUnknownTurns({
    source: options.detected ? { verifiedHash: (options.staleHash ? "2" : "1").repeat(64), audio: {
      name: "synthetic.mp3", type: "audio/mpeg", size: 1000, present: true, duration: 20, hash: "1".repeat(64),
      overlapEvidence: { audioSha256: "1".repeat(64), source: "Synthetic detector", intervals: [options.detected] },
    } } : undefined,
    segments: current,
    originals: original,
    format: "mp3",
    parts: [
      {
        index: 0,
        ownStartSeconds: 0,
        ownDurationSeconds: options.maxEnd ?? 15,
        leadInSeconds: 0,
      },
    ],
    readPart,
    provider,
  });
  expect(maxActive).toBeLessThanOrEqual(1);
  expect(readPart.mock.calls.length).toBeLessThanOrEqual(1);
  return {
    linked: recovered.get(current[1]!.id) === current[0]!.id,
    calls: semantics.mock.calls.length,
    decodes: audio.mock.calls.length,
  };
}

describe("masked-turn acoustic and context abstention", () => {
  it("withholds both intersecting unknown words and their acoustic anchors, and permits a boundary-only contact", async () => {
    expect((await masked({ detected: {start:4.2,end:4.4} })).linked).toBe(false);
    expect((await masked({ detected: {start:2,end:2.5} })).linked).toBe(false);
    expect((await masked({ detected: {start:9,end:9.5} })).linked).toBe(true);
    expect((await masked({ detected: {start:4.2,end:4.4}, staleHash:true })).linked).toBe(true);
  });
  it("recovers a masked matching voice on both sides with no language model", async () => {
    expect(await masked()).toMatchObject({ linked: true, calls: 1 });
  });
  it.each([
    { middleVoice: 90 },
    { rivalVoice: 4 },
    { silent: true },
    { changedAnchor: true },
    { overlap: true },
    { rawOverlap: true },
    { rawMultiAnchor: true },
    { overlapOnlyRival: true },
    { maxEnd: 8 },
    { edit: { reviewed: true } },
    { edit: { revision: 2 } },
    { edit: { text: "A protected human edit." } },
    { rawSpeaker: true },
  ])(
    "withholds counterexamples before offering text to semantic review: %j",
    async (options) => {
      expect(await masked(options)).toMatchObject({ linked: false, calls: 0 });
    },
  );
  it.each(["uncertain", "turn_change"] as const)(
    "withholds even an acoustic match on %s",
    async (verdict) => {
      expect(await masked({ verdict })).toMatchObject({
        linked: false,
        calls: 1,
      });
    },
  );
  it("preserves brief acknowledgments and borderline similarity without semantic support", async () => {
    expect((await masked({ middleText: "Yes." })).linked).toBe(false);
    expect((await masked({ middleVoice: 28 })).linked).toBe(false);
    expect(
      (await masked({ middleVoice: 28, verdict: "supports" })).linked,
    ).toBe(true);
  });
});

describe("masked consecutive turns with a same-part reference bank", () => {
  async function consecutive(
    options: {
      splitVoice?: boolean;
      middleAngle?: number;
      oppositeAnchor?: boolean;
      oneReference?: boolean;
      onlyLeft?: boolean;
      noRival?: boolean;
      missingAnchor?: boolean;
      verdict?: TurnContextVerdict;
      shortText?: boolean;
    } = {},
  ) {
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    const turns = [
      segment("A clean rival sample.", [b], 0, 2.2),
      segment("Another isolated rival turn.", [b], 5, 7.2),
      segment("An independent reference.", [a], 10, 12.2),
      segment("The existing item includes", [a], 16, 18.5),
      segment(
        options.shortText
          ? "Yes."
          : "multiple important changes to the approval criteria",
        [],
        18.5,
        21,
      ),
      segment("and another set of conditions", [], 21, 23.5),
      segment("with a date still under discussion", [], 23.5, 26),
      segment(
        "before the final decision.",
        [options.oppositeAnchor ? b : a],
        26,
        28.5,
      ),
    ];
    const [, , , near, target] = turns;
    if (options.onlyLeft) turns[7]!.speakerIds = [];
    if (options.oneReference) turns[2]!.speakerIds = turns[7]!.speakerIds = [];
    if (options.noRival) turns[0]!.speakerIds = turns[1]!.speakerIds = [];
    if (options.missingAnchor) near!.speakerIds = turns[7]!.speakerIds = [];
    const originals = turns.map((turn) => ({ ...turn, speakerIds: [] }));
    const halfWindows: Array<[number, number]> = [];
    audio
      .mockReset()
      .mockImplementation(
        async (
          _bytes: ArrayBuffer,
          _part: AcousticSourcePart,
          sample: AcousticSampleWindow,
        ) => {
          const turn = turns.find(
            (s) => s.start! < sample.startSeconds && s.end! > sample.endSeconds,
          )!;
          const targetSample = turn.id === target!.id;
          const mid = (target!.start! + target!.end!) / 2;
          if (targetSample)
            halfWindows.push([sample.startSeconds, sample.endSeconds]);
          const angle = turn.speakerIds.includes(b)
            ? 90
            : targetSample
              ? options.splitVoice && sample.startSeconds >= mid
                ? 90
                : (options.middleAngle ?? 0)
              : 0;
          return Float32Array.from([
            0.1 * Math.cos((angle * Math.PI) / 180),
            0.1 * Math.sin((angle * Math.PI) / 180),
          ]);
        },
      );
    semantics.mockReset().mockResolvedValue(options.verdict ?? "unavailable");
    const recovered = await recoverUnknownTurns({
      segments: turns,
      originals,
      parts: [
        {
          index: 0,
          ownStartSeconds: 0,
          ownDurationSeconds: 30,
          leadInSeconds: 0,
        },
      ],
      format: "mp3",
      readPart: async () => new ArrayBuffer(0),
      provider: {
        async load() {},
        dispose() {},
        async embed(pcm) {
          return Array.from(pcm);
        },
      },
    });
    return {
      linked: recovered.get(target!.id) === near!.id,
      middleLinked: recovered.has(turns[5]!.id),
      halfWindows,
    };
  }
  it("recovers independently tested consecutive targets without promoting predictions into anchors", async () => {
    const result = await consecutive();
    expect(result.linked).toBe(true);
    expect(result.middleLinked).toBe(true);
    expect(result.halfWindows).toHaveLength(2);
    expect(result.halfWindows[0]![1]).toBeLessThanOrEqual(
      result.halfWindows[1]![0],
    );
  });
  it("accepts a stable bank winner with a nearby speaker only on the left", async () => {
    expect((await consecutive({onlyLeft:true})).linked).toBe(true);
  });

  it.each([
    { splitVoice: true },
    { middleAngle: 90 },
    { oppositeAnchor: true },
    { oneReference: true },
    { noRival: true },
    { missingAnchor: true },
    { verdict: "uncertain" as const },
    { verdict: "turn_change" as const },
    { shortText: true },
  ])(
    "withholds the masked bank target when evidence is insufficient: %j",
    async (options) => {
      expect((await consecutive(options)).linked).toBe(false);
    },
  );
  it("applies stricter acoustic criteria when text review is unavailable", async () => {
    expect((await consecutive({ middleAngle: 22 })).linked).toBe(false);
    expect(
      (await consecutive({ middleAngle: 22, verdict: "supports" })).linked,
    ).toBe(true);
  });
});
