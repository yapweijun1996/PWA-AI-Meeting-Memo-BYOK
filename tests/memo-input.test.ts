import { afterEach, expect, it, vi } from "vitest";
import { createMeeting, sampleMeeting, segment } from "../src/domain/model";
import {
  buildMemoInput,
  MEMO_INPUT_MAX_CHARS,
} from "../src/providers/memo-input";
import { generateMemo, normalizeMemo } from "../src/providers/api";

afterEach(() => vi.unstubAllGlobals());

function longMeeting() {
  const base = createMeeting({ title: "Long speaker review" });
  const speakers = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const patterns = [
    [speakers[0]],
    [speakers[0], speakers[1]],
    [speakers[1]],
    [speakers[1], speakers[0]],
    [speakers[2]],
    [speakers[2], speakers[1]],
    [speakers[3]],
    [],
  ];
  const segments = Array.from({ length: 7217 }, (_, index) => {
    const source = segment(
      `w${index}`,
      patterns[Math.floor(index / 20) % patterns.length],
      index % 17 === 0 ? null : index,
      index % 17 === 0 ? null : index + 1,
    );
    return { ...source, revision: (index % 3) + 1 };
  });
  return {
    ...base,
    speakers: speakers.map((id, index) => ({
      id,
      name: `Speaker ${index + 1}`,
      confirmed: index === 0,
      sourceLabels: [`scribe:${index}`],
    })),
    segments,
  };
}

function generatedItem(sourceIds: string[], owner = null) {
  return {
    type: "action" as const,
    text: "Review the cited passage.",
    owner_speaker_id: owner,
    due_date: null,
    due_original: null,
    source_segment_ids: sourceIds,
  };
}

it("compacts 7,217 word segments without losing ordered speakers, text, or revisions", () => {
  const meeting = longMeeting();
  const before = structuredClone(meeting);
  const result = buildMemoInput(meeting);
  const transport = JSON.parse(result.input) as {
    segments: Array<{ id: string; text: string[]; speakers: (string | number)[] }>;
  };

  expect(result.compact).toBe(true);
  expect(result.maxCitations).toBe(5);
  expect(result.characters).toBeLessThanOrEqual(MEMO_INPUT_MAX_CHARS);
  expect(transport.segments).toHaveLength(Object.keys(result.aliases).length);
  expect(transport.segments.every((group) => !("start" in group))).toBe(true);

  const sourceIds = Object.values(result.aliases)
    .flat()
    .map((source) => source.id);
  expect(sourceIds).toEqual(meeting.segments.map((source) => source.id));
  expect(new Set(sourceIds).size).toBe(meeting.segments.length);
  expect(sourceIds).toHaveLength(7217);
  expect(transport.segments.flatMap((group) => group.text)).toEqual(
    meeting.segments.map((source) => source.text),
  );

  for (const group of transport.segments) {
    const refs = result.aliases[group.id];
    expect(refs).toBeDefined();
    expect(refs.length).toBeLessThanOrEqual(20);
    const firstIndex = sourceIds.indexOf(refs[0].id);
    expect(refs.map((source) => source.revision)).toEqual(
      meeting.segments
        .slice(firstIndex, firstIndex + refs.length)
        .map((source) => source.revision),
    );
    expect(refs.map((source) => source.id)).toEqual(
      meeting.segments
        .slice(firstIndex, firstIndex + refs.length)
        .map((source) => source.id),
    );
    const first = meeting.segments.find((source) => source.id === refs[0].id)!;
    const speakerIds = group.speakers.map((speaker) =>
      typeof speaker === "number" ? meeting.speakers[speaker].id : speaker,
    );
    expect(speakerIds).toEqual(first.speakerIds);
    expect(
      refs.every((source) => {
        const original = meeting.segments.find(
          (candidate) => candidate.id === source.id,
        );
        return (
          original?.revision === source.revision &&
          JSON.stringify(original.speakerIds) === JSON.stringify(speakerIds)
        );
      }),
    ).toBe(true);
  }
  expect(meeting).toEqual(before);
});

it("preserves fragment boundaries, punctuation, whitespace, and multilingual text", () => {
  const meeting = longMeeting();
  const fragments = ["3", ".", "5", " 中文", "字", "!", "\nnext", "", '"quoted"'];
  meeting.segments = meeting.segments.map((source, index) => ({
    ...source,
    text: fragments[index % fragments.length],
  }));
  const result = buildMemoInput(meeting);
  expect(result.compact).toBe(true);
  const transport = JSON.parse(result.input) as {
    segments: Array<{ text: string[] }>;
  };
  expect(transport.segments.flatMap((group) => group.text)).toEqual(
    meeting.segments.map((source) => source.text),
  );
});

it("keeps the short input contract unchanged and uses original IDs by default", () => {
  const meeting = sampleMeeting();
  const result = buildMemoInput(meeting);
  const transport = JSON.parse(result.input) as {
    segments: Array<{ id: string; text: string; speakers: string[] }>;
  };
  expect(result.compact).toBe(false);
  expect(result.maxCitations).toBe(100);
  expect(result.aliases).toEqual({});
  expect(transport.segments.map((source) => source.id)).toEqual(
    meeting.segments.map((source) => source.id),
  );
  const [item] = normalizeMemo(
    {
      items: [generatedItem([meeting.segments[0].id])],
    },
    meeting,
  );
  expect(item.sources).toEqual([
    { id: meeting.segments[0].id, revision: meeting.segments[0].revision },
  ]);
});

it("sends compact groups with a five-group citation schema and expands the response", async () => {
  const meeting = longMeeting();
  const input = buildMemoInput(meeting);
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "completed",
        id: "memo-request",
        usage: { input_tokens: 10, output_tokens: 5 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    generatedItem(Object.keys(input.aliases).slice(0, 2)),
                  ],
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const result = await generateMemo(
    meeting,
    "synthetic-test",
    new AbortController().signal,
  );
  const request = JSON.parse(fetch.mock.calls[0][1].body as string) as {
    input: string;
    instructions: string;
    text: {
      format: {
        schema: {
          properties: {
            items: {
              items: {
                properties: { source_segment_ids: { maxItems: number } };
              };
            };
          };
        };
      };
    };
  };
  const sent = JSON.parse(request.input) as { segments: Array<{ id: string }> };
  expect(sent.segments[0].id).toBe("g0");
  expect(request.instructions).toContain("at most five compact source groups");
  expect(
    request.text.format.schema.properties.items.items.properties
      .source_segment_ids.maxItems,
  ).toBe(5);
  expect(result[0].sources).toHaveLength(
    input.aliases.g0.length + input.aliases.g1.length,
  );
});

it("expands compact aliases, deduplicates refs, and rejects invalid captured refs", () => {
  const meeting = longMeeting();
  const input = buildMemoInput(meeting);
  const groupIds = Object.keys(input.aliases);
  const repeated = normalizeMemo(
    {
      items: [generatedItem([groupIds[0], groupIds[0], groupIds[1]])],
    },
    meeting,
    input.aliases,
  )[0];
  expect(repeated.sources).toHaveLength(
    new Set([
      ...input.aliases[groupIds[0]].map(
        (source) => `${source.id}:${source.revision}`,
      ),
      ...input.aliases[groupIds[1]].map(
        (source) => `${source.id}:${source.revision}`,
      ),
    ]).size,
  );
  expect(repeated.sources[0]).toEqual(input.aliases[groupIds[0]][0]);
  expect(repeated.ownerId).toBeNull();

  expect(() =>
    normalizeMemo(
      { items: [generatedItem(["missing-group"])] },
      meeting,
      input.aliases,
    ),
  ).toThrow("unknown passage");
  expect(() =>
    normalizeMemo(
      { items: [generatedItem([meeting.segments[0].id])] },
      meeting,
      input.aliases,
    ),
  ).toThrow("unknown passage");
  expect(() =>
    normalizeMemo(
      { items: [generatedItem(["__proto__"])] },
      meeting,
      input.aliases,
    ),
  ).toThrow("unknown passage");

  const badRevision = {
    ...input.aliases,
    [groupIds[0]]: [
      {
        ...input.aliases[groupIds[0]][0],
        revision: input.aliases[groupIds[0]][0].revision + 1,
      },
    ],
  };
  expect(() =>
    normalizeMemo(
      { items: [generatedItem([groupIds[0]])] },
      meeting,
      badRevision,
    ),
  ).toThrow("unknown passage");

  const badId = {
    ...input.aliases,
    [groupIds[0]]: [{ id: crypto.randomUUID(), revision: 1 }],
  };
  expect(() =>
    normalizeMemo({ items: [generatedItem([groupIds[0]])] }, meeting, badId),
  ).toThrow("unknown passage");
});

it("allows at most 100 expanded refs and rejects overflow instead of clipping", () => {
  const meeting = longMeeting();
  const input = buildMemoInput(meeting);
  const groupIds = Object.keys(input.aliases).slice(0, 5);
  const item = normalizeMemo(
    { items: [generatedItem(groupIds)] },
    meeting,
    input.aliases,
  )[0];
  expect(item.sources).toHaveLength(100);

  const overflow = {
    overflow: meeting.segments.slice(0, 101).map((source) => ({
      id: source.id,
      revision: source.revision,
    })),
  };
  expect(() =>
    normalizeMemo({ items: [generatedItem(["overflow"])] }, meeting, overflow),
  ).toThrow("more than 100");
});

it("rejects over-limit memo input before any network request", async () => {
  const meeting = sampleMeeting();
  meeting.segments = Array.from({ length: 5 }, (_, index) => ({
    ...meeting.segments[0],
    id: crypto.randomUUID(),
    revision: index + 1,
    text: "x".repeat(19_000),
    originalText: "x".repeat(19_000),
  }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateMemo(meeting, "synthetic-test", new AbortController().signal),
  ).rejects.toThrow("80,000");
  expect(fetch).not.toHaveBeenCalled();
});
