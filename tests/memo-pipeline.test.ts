import "fake-indexeddb/auto";
import { expect, test, vi, afterEach } from "vitest";
import { createMeeting, segment, validateMeeting } from "../src/domain/model";
import {
  planMemo,
  extractionInput,
  synthesisInput,
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
  bad.memoPipelines![0].snapshot.segments[0].text = "Changed evidence";
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
