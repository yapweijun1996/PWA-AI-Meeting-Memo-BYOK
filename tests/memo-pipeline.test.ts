import "fake-indexeddb/auto";
import { expect, test, vi, afterEach } from "vitest";
import { createMeeting, segment, validateMeeting } from "../src/domain/model";
import { reviewSegments } from "../src/domain/operations";
import {
  planMemo,
  extractionInput,
  synthesisInput,
  captureExtraction,
  extractionInstructions,
} from "../src/providers/memo-plan";
import {
  runMemoPipeline,
  resumablePipeline,
  pipelineActive,
  cancelPipeline,
} from "../src/jobs/memo-pipeline";
import { saveMeeting, getMeeting } from "../src/storage/repository";
import { summarizeMeetingAccounting } from "../src/domain/accounting";
import { readBackup } from "../src/storage/backup";

vi.mock("../src/providers/credentials", async (original) => ({
  ...(await original<typeof import("../src/providers/credentials")>()),
  getKey: () => "synthetic-test",
}));
afterEach(() => vi.unstubAllGlobals());
const selection = { provider: "openai" as const, model: "gpt-6-luna" };
function longMeeting() {
  const m = createMeeting();
  m.segments = Array.from({ length: 1200 }, (_, i) =>
    segment(`${i}: ${"word ".repeat(20)}`),
  );
  return m;
}
function response(body: string) {
  const input = JSON.parse(JSON.parse(body).input);
  const source = input.facts
    ? input.facts[0].items[0].id
    : input.segments[0].id;
  return new Response(
    JSON.stringify({
      id: "synthetic-response",
      status: "completed",
      usage: { input_tokens: 10, output_tokens: 10 },
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                items: [
                  {
                    type: "summary",
                    text: "A candidate for review.",
                    owner_speaker_id: null,
                    due_date: null,
                    due_original: null,
                    source_segment_ids: [source],
                  },
                ],
              }),
            },
          ],
        },
      ],
    }),
  );
}

test("planning covers each source once, retains boundary context and makes no network call", () => {
  const m = longMeeting(),
    before = JSON.stringify(m);
  const p = planMemo(m, selection.provider, selection.model)!;
  expect(p.chunks.length).toBeGreaterThan(1);
  expect(p.chunks.flat()).toEqual(m.segments.map((s) => s.id));
  const input = extractionInput(m, p, 1);
  expect(input.segments[0].id).toBe(p.chunks[0].at(-1));
  expect(JSON.stringify(m)).toBe(before);
  expect(() => synthesisInput(p)).toThrow("Complete every");
  expect(
    planMemo(
      { ...m, segments: m.segments.slice(0, 1) },
      selection.provider,
      selection.model,
    ),
  ).toBeNull();
  expect(() =>
    planMemo(
      {
        ...m,
        segments: Array.from({ length: 30 }, () => segment("x".repeat(20000))),
      },
      selection.provider,
      selection.model,
    ),
  ).toThrow("eight");
});

test("multi-step generation persists attempts, original evidence and final source expansion", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const fetch = vi.fn(async (_url: unknown, options: { body: string }) =>
    response(options.body),
  );
  vi.stubGlobal("fetch", fetch);
  const m = await saveMeeting(longMeeting()),
    original = JSON.stringify(m.segments);
  const p = planMemo(m, selection.provider, selection.model)!;
  const result = await runMemoPipeline(m, selection, p);
  expect(fetch).toHaveBeenCalledTimes(p.chunks.length + 1);
  expect(result.memoPipelines![0].state).toBe("completed");
  expect(JSON.stringify(result.segments)).toBe(original);
  expect(result.memos[0].originalItems).toEqual(result.memos[0].items);
  expect(
    result.memos[0].items[0].sources.every((ref) =>
      m.segments.some((s) => s.id === ref.id && s.revision === ref.revision),
    ),
  ).toBe(true);
  expect(summarizeMeetingAccounting(result.jobs).submittedAttempts).toBe(
    p.chunks.length + 1,
  );
  expect(pipelineActive()).toBe(false);
  expect(
    validateMeeting(JSON.parse(JSON.stringify(result))).schemaVersion,
  ).toBe(2);
  const restored = await readBackup(
    new File([JSON.stringify(result)], "synthetic-pipeline.json"),
  );
  expect(restored.meeting.id).not.toBe(result.id);
  expect(restored.meeting.memoPipelines).toEqual(result.memoPipelines);
  expect(restored.meeting.memos).toEqual(result.memos);
  const bad = structuredClone(result);
  const snapshot = bad.memoPipelines![0].snapshot;
  if ("segments" in snapshot) snapshot.segments[0].text = "Changed evidence";
  else snapshot.sourceRefs[0].revision = 999;
  expect(() => validateMeeting(bad)).toThrow("match meeting evidence");
});

test("unknown outcomes never resume themselves and explicit retry reuses saved successes", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const fetch = vi.fn(async (_url: unknown, options: { body: string }) => {
    if (fetch.mock.calls.length === 2) throw new TypeError("Disconnected");
    return response(options.body);
  });
  vi.stubGlobal("fetch", fetch);
  const m = await saveMeeting(longMeeting()),
    p = planMemo(m, selection.provider, selection.model)!;
  await expect(runMemoPipeline(m, selection, p)).rejects.toThrow();
  const stopped = (await getMeeting(m.id))!;
  expect(stopped.memoPipelines![0].results.filter(Boolean)).toHaveLength(1);
  expect(stopped.jobs[1].state).toBe("outcome_unknown");
  expect(resumablePipeline(stopped, selection)).toBeUndefined();
  await expect(
    runMemoPipeline(stopped, selection, stopped.memoPipelines![0]),
  ).rejects.toThrow("Review the previous");
  expect(fetch).toHaveBeenCalledTimes(2);
  const completed = await runMemoPipeline(
    stopped,
    selection,
    stopped.memoPipelines![0],
    true,
  );
  expect(completed.memoPipelines![0].state).toBe("completed");
  expect(fetch).toHaveBeenCalledTimes(p.chunks.length + 2);
  expect(completed.jobs[1].state).toBe("outcome_unknown");
});

test("pausing between requests keeps a resumable checkpoint without another submission", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const fetch = vi.fn(async (_url: unknown, options: { body: string }) =>
    response(options.body),
  );
  vi.stubGlobal("fetch", fetch);
  const m = await saveMeeting(longMeeting()),
    p = planMemo(m, selection.provider, selection.model)!;
  await expect(
    runMemoPipeline(m, selection, p, false, (value) => {
      if (value.jobs.filter((j) => j.state === "completed").length === 1)
        cancelPipeline();
    }),
  ).rejects.toThrow("paused");
  expect(fetch).toHaveBeenCalledTimes(1);
  const saved = (await getMeeting(m.id))!;
  const resume = resumablePipeline(saved, selection)!;
  expect(resume.results.filter(Boolean)).toHaveLength(1);
  const completed = await runMemoPipeline(saved, selection, resume);
  expect(completed.memoPipelines![0].state).toBe("completed");
  expect(fetch).toHaveBeenCalledTimes(p.chunks.length + 1);
});

test("editing source during generation preserves captured revisions and marks final notes stale", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const m = await saveMeeting(longMeeting()),
    p = planMemo(m, selection.provider, selection.model)!;
  let changed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, options: { body: string }) => {
      if (!changed) {
        changed = true;
        const latest = (await getMeeting(m.id))!;
        const original = latest.segments[0];
        await saveMeeting({
          ...latest,
          revision: latest.revision + 1,
          history: [...latest.history, original],
          segments: latest.segments.map((s) =>
            s.id === original.id
              ? { ...s, text: "Human correction", revision: s.revision + 1 }
              : s,
          ),
        });
      }
      return response(options.body);
    }),
  );
  const result = await runMemoPipeline(m, selection, p);
  expect(result.revision).toBe(2);
  expect(result.segments[0].text).toBe("Human correction");
  expect(result.memos[0].sourceRevision).toBe(1);
  expect(result.memos[0].items.every((i) => i.review === "pending")).toBe(true);
  expect(result.memos[0].items[0].sources[0].revision).toBe(1);
});

function incidentMeeting() {
  const m = createMeeting({ title: "Synthetic 12,584-fragment incident" });
  m.synthetic = true;
  m.segments = Array.from({ length: 12584 }, (_, i) => ({
    ...segment("Budget item."), start: i / 4, end: (i + 1) / 4,
  }));
  return m;
}

// Full-size persistence/restore fixture; hosted two-core runners need more than the 5 s unit default.
test("word-level incident saves oversized extractions and completes exactly three extractions and one synthesis", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const m = await saveMeeting(incidentMeeting());
  const p = planMemo(m, selection.provider, selection.model)!;
  expect(p.chunks).toHaveLength(3);
  const fetch = vi.fn(async (_url: unknown, options: { body: string }) => {
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.input);
    if (input.facts) {
      const first = input.facts[0].items[0];
      expect(Object.keys(first).sort()).toEqual(["id", "type", "text", "ownerId", "dueDate", "dueOriginal", "quote"].sort());
      expect(first.quote).toEqual(Array(100).fill("Budget item."));
      expect(input.facts[0]).not.toHaveProperty("quotes");
      const saved = (await getMeeting(m.id))!;
      expect(saved.memoPipelines![0].results.every(r => JSON.stringify(r).length > 8000)).toBe(true);
    }
    const reply = await response(options.body).json();
    if (input.facts) {
      const item = JSON.parse(reply.output[0].content[0].text).items[0];
      item.source_segment_ids = [input.facts[0].items[0].id, input.facts[1].items[0].id];
      reply.output[0].content[0].text = JSON.stringify({items: [item]});
    } else {
      const item = JSON.parse(reply.output[0].content[0].text).items[0];
      item.source_segment_ids = input.segments.slice(0, 5).map((s: { id: string }) => s.id);
      reply.output[0].content[0].text = JSON.stringify({items: Array.from({length: 6}, () => ({...item}))});
    }
    return new Response(JSON.stringify(reply));
  });
  vi.stubGlobal("fetch", fetch);
  const result = await runMemoPipeline(m, selection, p);
  expect(fetch).toHaveBeenCalledTimes(4);
  for (const [, options] of fetch.mock.calls.slice(0, 3)) {
    const request = JSON.parse(options.body);
    expect(request.instructions).toContain("24666");
    expect(request.instructions).toContain("at most 100");
    expect(request.text.format.schema.properties.items.maxItems).toBe(100);
  }
  expect(result.memoPipelines![0].state).toBe("completed");
  expect(result.jobs.every(j => j.state === "completed")).toBe(true);
  const expectedSources = result.memoPipelines![0].results.slice(0, 2).flatMap(extraction => extraction!.items[0].sources);
  expect(expectedSources).toHaveLength(200);
  expect(result.memos[0].items[0].sources).toEqual(expectedSources);
  expect(result.memos[0].originalItems![0].sources).toEqual(expectedSources);
  expect(result.segments).toEqual(m.segments);
  expect(validateMeeting(JSON.parse(JSON.stringify(result))).memoPipelines).toEqual(result.memoPipelines);
  const restored = await readBackup(new File([JSON.stringify(result)], "incident.json"));
  expect(restored.meeting.memoPipelines).toEqual(result.memoPipelines);
  expect(restored.meeting.memos).toEqual(result.memos);
}, 30_000);

test("oversized possible citation expansion stops before synthesis and preserves extractions", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const original = await saveMeeting(longMeeting());
  const plan = planMemo(original, selection.provider, selection.model)!;
  expect(plan.chunks.length).toBeGreaterThanOrEqual(2);
  plan.results = plan.chunks.map((_, index) => {
    const chosen = original.segments.slice(index === 0 ? 0 : 300, index === 0 ? 300 : 600);
    const sources = chosen.map(({id, revision}) => ({id, revision}));
    const item = {id: crypto.randomUUID(), type: "summary" as const, text: "Saved evidence", ownerId: null, dueDate: null, dueOriginal: null, sources, review: "pending" as const};
    return {items: [item], quotes: chosen.map(({id, revision, text}) => ({id, revision, text}))};
  });
  const saved = await saveMeeting({...original, memoPipelines: [plan]});
  await expect(runMemoPipeline(saved, selection, plan)).rejects.toThrow("No synthesis request was sent");
  const after = (await getMeeting(saved.id))!;
  expect(fetch).not.toHaveBeenCalled();
  expect(after.memoPipelines![0].state).toBe("blocked");
  expect(after.memoPipelines![0].results).toEqual(plan.results);
  expect(after.memos).toEqual(original.memos);
  expect(after.jobs).toEqual(original.jobs);
});

test("oversized synthesis keeps paid successes, blocks locally and never submits or retries synthesis", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const m = await saveMeeting(longMeeting());
  const p = planMemo(m, selection.provider, selection.model)!;
  const fetch = vi.fn(async (_url: unknown, options: {body: string}) => {
    const reply = await response(options.body).json();
    const item = JSON.parse(reply.output[0].content[0].text).items[0];
    item.text = "x".repeat(20000);
    reply.output[0].content[0].text = JSON.stringify({items: Array.from({length: 5}, () => ({...item}))});
    return new Response(JSON.stringify(reply));
  });
  vi.stubGlobal("fetch", fetch);
  await expect(runMemoPipeline(m, selection, p)).rejects.toThrow("No synthesis request was sent");
  const saved = (await getMeeting(m.id))!;
  expect(fetch).toHaveBeenCalledTimes(p.chunks.length);
  expect(saved.memoPipelines![0].state).toBe("blocked");
  expect(saved.memoPipelines![0].results.every(Boolean)).toBe(true);
  expect(saved.jobs).toHaveLength(p.chunks.length);
  expect(saved.jobs.every(j => j.state === "completed")).toBe(true);
  expect(resumablePipeline(saved, selection)).toBeUndefined();
  await expect(runMemoPipeline(saved, selection, saved.memoPipelines![0], true)).rejects.toThrow("No synthesis request was sent");
  expect(fetch).toHaveBeenCalledTimes(p.chunks.length);
  expect((await getMeeting(m.id))!.memoPipelines![0].results).toEqual(saved.memoPipelines![0].results);
});

test("the largest valid extraction fact count retains exact ordered quotes without the former size cap", () => {
  const m = incidentMeeting();
  const refs = m.segments.slice(0, 100).map(({id, revision}) => ({id, revision}));
  const items = Array.from({length: 100}, () => ({id: crypto.randomUUID(), type: "summary" as const, text: "Review", ownerId: null, dueDate: null, dueOriginal: null, sources: refs, review: "pending" as const}));
  const result = captureExtraction(m, items);
  expect(result.items).toHaveLength(100);
  expect(result.quotes).toHaveLength(100);
  expect(JSON.stringify(result).length).toBeGreaterThan(8000);
  const p = planMemo(m, selection.provider, selection.model)!;
  expect(extractionInstructions(p)).toContain("at most 100");
  expect(() => captureExtraction(m, [{...items[0], sources: [{...refs[0], revision: 2}]}])).toThrow("source is invalid");
});


test("saved plan language survives pause and resume while legacy plans keep meeting language", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const fetch = vi.fn(async (_url: unknown, options: {body: string}) => response(options.body));
  vi.stubGlobal("fetch", fetch);
  const m = await saveMeeting(longMeeting());
  const p = {...planMemo(m, selection.provider, selection.model)!, outputLanguage: "ms" as const};
  await expect(runMemoPipeline(m, selection, p, false, value => {
    if (value.jobs.filter(j => j.state === "completed").length === 1) cancelPipeline();
  })).rejects.toThrow("paused");
  const paused = (await getMeeting(m.id))!;
  const resumed = await runMemoPipeline(paused, selection, paused.memoPipelines![0]);
  expect(resumed.memoPipelines![0].outputLanguage).toBe("ms");
  expect(resumed.jobs.every(j => j.outputLanguage === "ms")).toBe(true);
  for (const [, options] of fetch.mock.calls) expect(JSON.parse(options.body).instructions).toContain("Write the notes in Malay");
  expect(fetch).toHaveBeenCalledTimes(p.chunks.length + 1);
  const legacyMeeting = await saveMeeting(longMeeting());
  const oldPlan = {...planMemo(legacyMeeting, selection.provider, selection.model)!};
  delete oldPlan.outputLanguage;
  fetch.mockClear();
  await runMemoPipeline(legacyMeeting, selection, oldPlan);
  for (const [, options] of fetch.mock.calls) expect(JSON.parse(options.body).instructions).toContain("Write the notes in the meeting language");
});


test("new plans store references instead of another transcript copy and preserve legacy plan reading", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const m = await saveMeeting(longMeeting());
  const p = planMemo(m, selection.provider, selection.model)!;
  expect(p.snapshot).not.toHaveProperty("segments");
  expect("sourceRefs" in p.snapshot && p.snapshot.sourceRefs).toEqual(m.segments.map(({id, revision}) => ({id, revision})));
  const {sourceRefs: _refs, ...metadata} = p.snapshot as Exclude<typeof p.snapshot, {segments: unknown}>;
  const legacy = {...p, snapshot: {...metadata, segments: structuredClone(m.segments)}};
  expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(legacy).length / 2);
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: {body: string}) => response(options.body)));
  const result = await runMemoPipeline(m, selection, legacy);
  expect(result.memoPipelines![0].state).toBe("completed");
  expect(validateMeeting(JSON.parse(JSON.stringify(result))).memos[0].items[0].sources).toEqual(result.memos[0].items[0].sources);
  const legacyBackup = await readBackup(new File([JSON.stringify(result)], "legacy-plan.json"));
  expect(legacyBackup.meeting.memoPipelines).toEqual(result.memoPipelines);
});

test("referenced plan refuses missing evidence instead of substituting the current revision", () => {
  const m = longMeeting();
  const p = planMemo(m, selection.provider, selection.model)!;
  expect("sourceRefs" in p.snapshot).toBe(true);
  if (!("sourceRefs" in p.snapshot)) throw new Error("Expected referenced plan");
  const modified = structuredClone(m);
  modified.segments[0].revision++;
  expect(() => extractionInput(modified, p, 0)).toThrow("match meeting evidence");
  modified.history = [m.segments[0]];
  expect(extractionInput(modified, p, 0).segments[0]).toEqual(m.segments[0]);
  const saved = {...modified, memoPipelines:[p]};
  expect(validateMeeting(saved).memoPipelines![0].snapshot).toEqual(p.snapshot);
  const bad = structuredClone(saved);
  if ("sourceRefs" in bad.memoPipelines[0].snapshot) bad.memoPipelines[0].snapshot.sourceRefs.push({...p.snapshot.sourceRefs[0]});
  expect(() => validateMeeting(bad)).toThrow("Duplicate pipeline source ID");
});

test("validates a review-only flag on restored legacy pipeline evidence at the same revision", async () => {
  const m = longMeeting();
  const plan = planMemo(m, selection.provider, selection.model)!;
  if (!("sourceRefs" in plan.snapshot)) throw new Error("Expected referenced plan");
  const { sourceRefs: _refs, ...metadata } = plan.snapshot;
  const snapshot = { ...metadata, segments: structuredClone(m.segments) };
  m.memoPipelines = [{ ...plan, snapshot }];
  const { meeting: restored } = await readBackup(new File([JSON.stringify(m)], "legacy-plan.json"));
  expect(restored.memoPipelines?.[0].snapshot).toEqual(snapshot);

  const reviewed = structuredClone(restored);
  reviewed.segments[0].reviewed = true;
  expect(validateMeeting(reviewed)).toEqual(reviewed);

  restored.updatedAt = "2020-01-01T00:00:00.000Z";
  const saved = await saveMeeting(reviewSegments(restored, [restored.segments[0].id], true));
  expect(saved.version).toBe(restored.version + 1);
  expect(saved.updatedAt).not.toBe(restored.updatedAt);
  expect(saved.revision).toBe(restored.revision);
  expect(saved.undo).toHaveLength(1);
  expect(await getMeeting(saved.id)).toEqual(saved);

  const { meeting: backedUp } = await readBackup(new File([JSON.stringify(saved)], "reviewed-legacy-plan.json"));
  expect(backedUp.segments[0]).toEqual({ ...snapshot.segments[0], reviewed: true });
  expect(backedUp.memoPipelines?.[0].snapshot).toEqual(snapshot);
});

test("rejects text changes in a legacy backup snapshot at the same revision", async () => {
  const m = longMeeting();
  const plan = planMemo(m, selection.provider, selection.model)!;
  if (!("sourceRefs" in plan.snapshot)) throw new Error("Expected referenced plan");
  const { sourceRefs: _refs, ...metadata } = plan.snapshot;
  const segments = structuredClone(m.segments);
  segments[0].text = "Conflicting legacy snapshot text";
  m.segments[0].reviewed = true;
  m.memoPipelines = [{ ...plan, snapshot: { ...metadata, segments } }];
  expect(() => validateMeeting(m)).toThrow("Pipeline sources do not match meeting evidence.");
  await expect(readBackup(new File([JSON.stringify(m)], "invalid-legacy-plan.json")))
    .rejects.toThrow("Pipeline sources do not match meeting evidence.");
});
