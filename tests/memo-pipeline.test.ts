import "fake-indexeddb/auto";
import { expect, test, vi, afterEach, onTestFinished } from "vitest";
import { createMeeting, segment, validateMeeting, MAX_MEETING_JSON_BYTES, type Job, type Meeting } from "../src/domain/model";
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
import { runJob } from "../src/jobs/runner";
import { deleteMeeting, saveMeeting, getMeeting } from "../src/storage/repository";
import { summarizeMeetingAccounting } from "../src/domain/accounting";
import { acknowledgeAgentExport, pendingAgentReceipt, receiptExport, recoverAgentReceipt } from "../src/jobs/agent-recovery";
import { backupMeeting, readBackup } from "../src/storage/backup";

vi.mock("../src/providers/credentials", async (original) => ({
  ...(await original<typeof import("../src/providers/credentials")>()),
  getKey: () => "synthetic-test",
}));
const recoveryFixtures: string[] = [];
afterEach(() => {
  for (const id of recoveryFixtures.splice(0)) acknowledgeAgentExport(id);
  vi.unstubAllGlobals();
});
const selection = { provider: "openai" as const, model: "gpt-6-luna" };
function longMeeting() {
  const m = createMeeting();
  m.segments = Array.from({ length: 1200 }, (_, i) =>
    segment(`${i}: ${"word ".repeat(20)}`),
  );
  return m;
}
function response(body: string, dueOriginal: string | null = null) {
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
                    due_original: dueOriginal,
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

test("a stale confirmation cannot submit synthesis again after another caller completed its plan", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const request = vi.fn(async (_url: unknown, init: { body: string }) => response(init.body));
  vi.stubGlobal("fetch", request);
  const meeting = await saveMeeting(longMeeting());
  const proposed = planMemo(meeting, selection.provider, selection.model)!;
  const completed = await runMemoPipeline(meeting, selection, proposed);
  const recovered = await runMemoPipeline(completed, selection, proposed);
  expect(request).toHaveBeenCalledTimes(proposed.chunks.length + 1);
  expect(recovered).toEqual(completed);
});

test.each(["single", "pipeline"])("standard %s memo retains the full paid date quote beyond the editable limit", async mode => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const quote = "on the first working day ".repeat(9) + "after final approval";
  const meeting = longMeeting();
  if (mode === "single") meeting.segments = meeting.segments.slice(0, 2);
  const saved = await saveMeeting(meeting);
  const plan = planMemo(saved, selection.provider, selection.model);
  const request = vi.fn(async (_url: unknown, init: { body: string }) => response(init.body, quote));
  vi.stubGlobal("fetch", request);
  const writes = vi.spyOn(IDBObjectStore.prototype, "put");
  onTestFinished(() => writes.mockRestore());
  const generated = await runJob(saved, "memo", { selection, plan });
  expect(request).toHaveBeenCalledTimes(plan ? plan.chunks.length + 1 : 1);
  const restored = await readBackup(new File([JSON.stringify(generated)], "date-quote.json"));
  const [item] = restored.meeting.memos[0].items;
  expect(item.text).toBe("A candidate for review.");
  expect(item.sources.length).toBeGreaterThan(0);
  expect(item.dueOriginal).toBeNull();
  for (const job of restored.meeting.jobs) {
    expect(job.state).toBe("completed");
    expect(job.memoResponse).toContain(quote);
    const received = writes.mock.calls.some(([value]) => value?.jobs?.some(
      (entry: typeof job) => entry.id === job.id && entry.state === "in_flight" && entry.memoResponse === job.memoResponse,
    ));
    expect(received, "the received body must be checkpointed before finalizing the job").toBe(true);
  }
});

test("standard memo keeps a paid response with unusable citations without creating a draft", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const meeting = createMeeting();
  meeting.segments = [segment("Synthetic evidence")];
  const saved = await saveMeeting(meeting);
  const request = vi.fn(async () => response(JSON.stringify({input: JSON.stringify({segments: [{id: "absent"}]})})));
  vi.stubGlobal("fetch", request);
  await expect(runJob(saved, "memo", { selection })).rejects.toThrow("unknown passage");
  const result = (await getMeeting(saved.id))!;
  expect(result.memos).toHaveLength(0);
  expect(result.jobs).toHaveLength(1);
  expect(JSON.stringify(result.jobs[0])).toContain("A candidate for review.");
  expect(request).toHaveBeenCalledTimes(1);
});

test("an unreadable paid standard response retains its redacted text and never resubmits", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const meeting = createMeeting();
  meeting.segments = [segment("Synthetic evidence")];
  const saved = await saveMeeting(meeting);
  const request = vi.fn(async () => new Response("incomplete { synthetic-test"));
  vi.stubGlobal("fetch", request);
  await expect(runJob(saved, "memo", { selection })).rejects.toThrow("unreadable");
  const restored = await readBackup(new File([JSON.stringify(await getMeeting(saved.id))], "unreadable.json"));
  expect(restored.meeting.jobs).toHaveLength(1);
  expect(restored.meeting.jobs[0]).toMatchObject({
    state: "outcome_unknown", billing: "possibly_charged", memoResponse: "incomplete { [redacted provider key]",
  });
  expect(restored.meeting.memos).toHaveLength(0);
  expect(request).toHaveBeenCalledTimes(1);
});

async function receiptFixture(pipeline = false) {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const meeting = longMeeting();
  if (!pipeline) meeting.segments = meeting.segments.slice(0, 1);
  const saved = await saveMeeting(meeting);
  recoveryFixtures.push(saved.id);
  return saved;
}

test("standard JSON receipts redact escaped credentials through persistence, parsed memo and ZIP restore", async () => {
  const saved = await receiptFixture();
  const request = vi.fn(async (_url: unknown, init: { body: string }) => {
    const reply = await response(init.body, "synthetic-test").text();
    return new Response(reply.replace("synthetic-test", "\\u0073ynthetic-test").replace("synthetic-response", "\\u0073ynthetic-test"));
  });
  vi.stubGlobal("fetch", request);
  const generated = await runJob(saved, "memo", { selection });
  const restored = await readBackup(new File([await backupMeeting(generated)], "memo.zip"));
  for (const meeting of [generated, restored.meeting]) {
    const job = meeting.jobs[0];
    const body = JSON.parse(job.memoResponse!);
    expect(body.id).toBe("[redacted provider key]");
    expect(job.requestId).toBe(body.id);
    expect(JSON.parse(body.output[0].content[0].text).items[0].due_original).toBe(body.id);
    expect(meeting.memos[0].items[0].dueOriginal).toBe(body.id);
    expect(job.memoResponse).not.toContain("\\u0073ynthetic-test");
  }
});

test.each(["single", "extraction", "synthesis"])("standard %s receipt survives failed body writes and can be saved locally", async mode => {
  const saved = await receiptFixture(mode !== "single");
  const plan = planMemo(saved, selection.provider, selection.model);
  const failedStep = mode === "synthesis" ? plan!.chunks.length : 0;
  const request = vi.fn(async (_url: unknown, init: { body: string }) => response(init.body, "synthetic-test"));
  vi.stubGlobal("fetch", request);
  const put = IDBObjectStore.prototype.put;
  const quota = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, index) {
    if (value.jobs?.some((job: Job) => (job.stepIndex ?? 0) === failedStep && job.memoResponse !== undefined))
      throw new DOMException("Synthetic quota failure", "QuotaExceededError");
    return put.call(this, value, index);
  });
  onTestFinished(() => quota.mockRestore());
  await expect(runJob(saved, "memo", { selection, plan })).rejects.toThrow();
  const pending = pendingAgentReceipt(saved.id);
  expect(pending?.job.memoResponse).toContain("[redacted provider key]");
  const exported = JSON.parse(JSON.stringify(receiptExport(pending!)));
  expect(exported).toMatchObject({ kind: "standard", meetingId: saved.id, job: { memoResponse: pending!.job.memoResponse } });
  expect(JSON.stringify(exported)).not.toContain("synthetic-test");
  const latest = (await getMeeting(saved.id))!;
  expect(latest.jobs[failedStep]).toMatchObject({ state: "failed", requestId: "synthetic-response", usage: {inputTokens: 10} });
  expect(latest.jobs[failedStep].memoResponse).toBeUndefined();
  expect(latest.memos).toHaveLength(0);
  if (plan) {
    expect(latest.memoPipelines![0].state).toBe("blocked");
    expect(latest.memoPipelines![0].results.filter(Boolean)).toHaveLength(failedStep);
  }
  await expect(runJob(latest, "memo", { selection, plan, reviewedRetry: true })).rejects.toThrow(/unsaved/i);
  quota.mockRestore();
  await saveMeeting({ ...latest, title: "Human edit" });
  const recovered = await recoverAgentReceipt(saved.id);
  expect(recovered.title).toBe("Human edit");
  expect(recovered.jobs[failedStep].memoResponse).toBe(pending!.job.memoResponse);
  expect(pendingAgentReceipt(saved.id)).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(failedStep + 1);
});

test("standalone runner blocks a repeat unknown outcome until the matching billing review", async () => {
  const saved = await receiptFixture();
  const request = vi.fn().mockRejectedValueOnce(new TypeError("Disconnected"))
    .mockImplementation(async (_url: unknown, init: {body: string}) => response(init.body));
  vi.stubGlobal("fetch", request);
  await expect(runJob(saved, "memo", { selection, plan: null })).rejects.toThrow();
  const stopped = (await getMeeting(saved.id))!;
  await expect(runJob(stopped, "memo", { selection, plan: null, reviewedRetry: false })).rejects.toThrow(/review/i);
  expect(request).toHaveBeenCalledTimes(1);
  await runJob(stopped, "memo", { selection, plan: null, reviewedRetry: true });
  expect(request).toHaveBeenCalledTimes(2);
});

function fillReceiptHistory(meeting: Meeting) {
  const historical: Job = {
    id: crypto.randomUUID(), stage: "memo", state: "completed", billing: "possibly_charged", inputRevision: meeting.revision,
    createdAt: meeting.createdAt, updatedAt: meeting.updatedAt, requestId: null, message: "Existing receipt", memoResponse: "",
  };
  const value = { ...meeting, jobs: [historical, ...meeting.jobs] };
  historical.memoResponse = "x".repeat(MAX_MEETING_JSON_BYTES - 5000 - new Blob([JSON.stringify(value, null, 2)]).size);
  return value;
}

test("standard receipt headroom is checked before a standalone attempt is allocated", async () => {
  const meeting = await saveMeeting(fillReceiptHistory(await receiptFixture()));
  const request = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", request);
  await expect(runJob(meeting, "memo", {selection})).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  expect((await getMeeting(meeting.id))!.jobs).toHaveLength(1);
}, 30000);

test("concurrent meeting growth routes the standard body to page export and keeps the ZIP restorable", async () => {
  const meeting = await receiptFixture();
  const body = "paid response ".repeat(5000);
  const request = vi.fn(async () => {
    const latest = (await getMeeting(meeting.id))!;
    await saveMeeting(fillReceiptHistory(latest));
    return new Response(body);
  });
  vi.stubGlobal("fetch", request);
  await expect(runJob(meeting, "memo", {selection})).rejects.toThrow();
  const pending = pendingAgentReceipt(meeting.id)!;
  expect(receiptExport(pending).job.memoResponse === body).toBe(true);
  await expect(recoverAgentReceipt(meeting.id)).rejects.toThrow(/backup/);
  expect(pendingAgentReceipt(meeting.id)).toBe(pending);
  const latest = (await getMeeting(meeting.id))!;
  expect(latest.jobs.at(-1)?.memoResponse).toBeUndefined();
  const restored = await readBackup(new File([await backupMeeting(latest)], "bounded.zip"));
  expect(restored.meeting.jobs).toEqual(latest.jobs);
  const json = await readBackup(new File([JSON.stringify(latest, null, 2)], "bounded.json"));
  expect(json.meeting.jobs).toEqual(latest.jobs);
  expect(request).toHaveBeenCalledTimes(1);
}, 30000);

test("a truncated nested JSON string keeps its paid text and redacts the encoded credential", async () => {
  const saved = await receiptFixture();
  const field = JSON.stringify('{"message":"\\u0073ynthetic-test"}');
  const malformed = '{"paid":"keep this evidence","output":' + field.slice(0, -1);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(malformed)));
  await expect(runJob(saved, "memo", { selection })).rejects.toThrow();
  const body = (await getMeeting(saved.id))!.jobs[0].memoResponse!;
  expect(body).toContain("keep this evidence");
  const repairedField = JSON.parse(body.slice(body.indexOf('"output":') + 9) + '"');
  expect(JSON.parse(repairedField).message).toBe("[redacted provider key]");
});

test("a standard receipt stays exportable if even the metadata write fails and the meeting is removed", async () => {
  const saved = await receiptFixture();
  const quota = vi.spyOn(IDBObjectStore.prototype, "put");
  onTestFinished(() => quota.mockRestore());
  const request = vi.fn(async () => {
    quota.mockImplementation(() => { throw new DOMException("No space", "QuotaExceededError"); });
    return new Response('{"paid":"keep me", "reflection":"\\u0073ynthetic-test"}');
  });
  vi.stubGlobal("fetch", request);
  await expect(runJob(saved, "memo", { selection })).rejects.toThrow(/export/);
  expect((await getMeeting(saved.id))!.jobs[0].state).toBe("in_flight");
  quota.mockRestore();
  await deleteMeeting(saved.id);
  await expect(recoverAgentReceipt(saved.id)).rejects.toThrow(/export/i);
  const exported = receiptExport(pendingAgentReceipt(saved.id)!);
  expect(JSON.parse(exported.job.memoResponse!)).toEqual({ paid: "keep me", reflection: "[redacted provider key]" });
  expect(request).toHaveBeenCalledTimes(1);
  acknowledgeAgentExport(saved.id);
  expect(pendingAgentReceipt(saved.id)).toBeUndefined();
});

test("local recovery fills in known accounting after an interruption was marked in another tab", async () => {
  const saved = await receiptFixture();
  const quota = vi.spyOn(IDBObjectStore.prototype, "put");
  onTestFinished(() => quota.mockRestore());
  const request = vi.fn(async (_url: unknown, init: { body: string }) => {
    quota.mockImplementation(() => { throw new DOMException("No space", "QuotaExceededError"); });
    return response(init.body);
  });
  vi.stubGlobal("fetch", request);
  await expect(runJob(saved, "memo", {selection})).rejects.toThrow(/export/);
  quota.mockRestore();
  const latest = (await getMeeting(saved.id))!;
  await saveMeeting({ ...latest, jobs: latest.jobs.map(job => ({...job, state: "outcome_unknown"})) });
  const recovered = await recoverAgentReceipt(saved.id);
  expect(recovered.jobs[0]).toMatchObject({ state: "completed", requestId: "synthetic-response", usage: {inputTokens: 10} });
  expect(recovered.memos[0].items[0].text).toBe("A candidate for review.");
  expect(recovered.jobs[0].memoResponse).toContain("A candidate for review.");
  expect(request).toHaveBeenCalledTimes(1);
});
