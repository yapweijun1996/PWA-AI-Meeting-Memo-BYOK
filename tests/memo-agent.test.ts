import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import {
  sampleMeeting,
  validateMeeting,
  type Meeting,
} from "../src/domain/model";
import { saveMeeting, getMeeting } from "../src/storage/repository";
import { hasSavedAgentFinal, planAgentMemo } from "../src/providers/memo-agent-plan";
import { runAgentMemo } from "../src/jobs/memo-agent";
import { readAgentAssistant } from "../src/providers/agent-record";
import { previewHistoryCleanup } from "../src/domain/history-cleanup";
import {
  acknowledgeAgentExport,
  pendingAgentReceipt,
  recoverAgentReceipt,
  retainAgentReceipt,
} from "../src/jobs/agent-recovery";
import * as repository from "../src/storage/repository";
import { backupMeeting, readBackup } from "../src/storage/backup";

const selection = { provider: "openai" as const, model: "gpt-6-luna" };
const key = "sk-synthetic-agent-unit-key";
const meetingIds: string[] = [];
afterEach(() => {
  for (const meetingId of meetingIds.splice(0))
    acknowledgeAgentExport(meetingId);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function setup() {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const meeting = await saveMeeting(sampleMeeting());
  meetingIds.push(meeting.id);
  return {
    meeting,
    plan: planAgentMemo(meeting, selection, "zh-CN"),
    signal: new AbortController().signal,
  };
}
function agentSse(items: Record<string, unknown>[], id = "synthetic-response") {
  const event = (type: string, values: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...values })}\n\n`;
  return new Response(
    event("response.created", { response: { id, status: "in_progress" } }) +
      items
        .map((item, index) =>
          event("response.output_item.done", { output_index: index, item }),
        )
        .join("") +
      event("response.completed", {
        response: {
          id,
          status: "completed",
          output: items,
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_tokens_details: { cached_tokens: 10 },
          },
        },
      }),
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "synthetic-request",
      },
    },
  );
}
const call = (
  args: object = { startIndex: 0, count: 2 },
  id = "call-read",
  name = "read_transcript_range",
) => ({
  type: "function_call",
  id: `fc-${id}`,
  call_id: id,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});
const final = (source: string) => ({
  type: "message",
  id: "message-final",
  role: "assistant",
  status: "completed",
  content: [
    {
      type: "output_text",
      text: JSON.stringify({
        items: [
          {
            type: "summary",
            text: "Synthetic evidence for human review.",
            owner_speaker_id: null,
            due_date: null,
            due_original: null,
            source_segment_ids: [source],
          },
        ],
      }),
    },
  ],
});

async function largeMeeting(historyEntries: number, useUndo = false) {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const meeting = sampleMeeting();
  const entries = Array.from({ length: historyEntries }, () => ({
    ...meeting.segments[0],
    id: crypto.randomUUID(),
    originalText: "x".repeat(20000),
    text: "x".repeat(20000),
  }));
  if (useUndo) {
    meeting.undo = [{ title: meeting.title, date: meeting.date, timezone: meeting.timezone, speakers: meeting.speakers, segments: entries }];
  } else meeting.history = entries;
  const original = {
    id: crypto.randomUUID(), type: "summary" as const, text: "Original note.",
    ownerId: null, dueDate: null, dueOriginal: null,
    sources: [{ id: meeting.segments[0].id, revision: meeting.segments[0].revision }],
    review: "pending" as const,
  };
  meeting.memos = [{
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceRevision: meeting.revision,
    model: "synthetic", items: [{ ...original, text: "Human edited note.", review: "edited" }],
    originalItems: [original],
  }];
  const saved = await saveMeeting(meeting);
  meetingIds.push(saved.id);
  return saved;
}

test("a large meeting preserves edited notes and exact citations through selective review and backup", async () => {
  const meeting = await largeMeeting(500);
  const originalSize = new TextEncoder().encode(JSON.stringify(meeting)).byteLength;
  expect(originalSize).toBeGreaterThan(16 * 1024 * 1024);
  const plan = planAgentMemo(meeting, selection, "zh-CN");
  let calls = 0;
  const request = vi.fn(async () =>
    ++calls === 1 ? agentSse([call()]) : agentSse([final(meeting.segments[0].id)]),
  );
  vi.stubGlobal("fetch", request);
  const completed = await runAgentMemo(meeting, plan, key, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(2);
  expect(completed.history).toHaveLength(500);
  expect(completed.memos[0]).toEqual(meeting.memos[0]);
  expect(completed.memos[1].items[0].sources).toEqual([{ id: meeting.segments[0].id, revision: meeting.segments[0].revision }]);
  expect(completed.jobs.every(job => !!job.assistantRecord)).toBe(true);
  const restored = await readBackup(new File([await backupMeeting(completed)], "large-synthetic.zip"));
  expect(restored.meeting.memos).toEqual(completed.memos);
  expect(restored.meeting.jobs).toEqual(completed.jobs);
  expect(restored.meeting.history).toEqual(completed.history);
  expect(JSON.stringify(restored.meeting)).not.toContain(key);
}, 120000);

test("a capacity pause retains the paid response and resumes only after explicit local cleanup", async () => {
  const meeting = await largeMeeting(1170, true);
  const plan = planAgentMemo(meeting, selection, "zh-CN");
  const reasoning = { type: "reasoning", id: "synthetic-reasoning", summary: [], encrypted_content: "a".repeat(250000) };
  let turns = 0;
  const request = vi.fn(async () => ++turns === 1 ? agentSse([reasoning, call()]) : agentSse([final(meeting.segments[0].id)]));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, new AbortController().signal)).rejects.toThrow(/next review response/i);
  expect(request).toHaveBeenCalledTimes(1);
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.jobs).toHaveLength(1);
  expect(saved.jobs[0].state).toBe("completed");
  expect(saved.jobs[0].assistantRecord).toContain("synthetic-reasoning");
  expect(saved.memoAgents?.[0].state).toBe("blocked");
  expect(saved.memos[0]).toEqual(meeting.memos[0]);
  expect(saved.undo[0].segments).toHaveLength(1170);
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
  const restored = await readBackup(new File([await backupMeeting(saved)], "paused-synthetic.zip"));
  expect(restored.meeting.jobs).toEqual(saved.jobs);
  expect(restored.meeting.memos).toEqual(saved.memos);
  expect(restored.meeting.memoAgents).toEqual(saved.memoAgents);
  expect(request).toHaveBeenCalledTimes(1);
  await expect(runAgentMemo(saved, saved.memoAgents![0], key, new AbortController().signal)).rejects.toThrow(/next review response/i);
  expect(request).toHaveBeenCalledTimes(1);
  const latest = (await getMeeting(meeting.id))!;
  const preview = previewHistoryCleanup(latest);
  expect(preview.undoCount).toBe(1);
  expect(preview.afterBytes).toBeLessThan(preview.beforeBytes);
  const cleaned = await saveMeeting(preview.result);
  const completed = await runAgentMemo(cleaned, cleaned.memoAgents![0], key, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(2);
  expect(completed.jobs[0].assistantRecord).toBe(saved.jobs[0].assistantRecord);
  expect(completed.memos[0]).toEqual(meeting.memos[0]);
  expect(completed.memos[1].items[0].sources).toEqual([{ id: meeting.segments[0].id, revision: meeting.segments[0].revision }]);
}, 120000);

test("real Pi SSE transport saves each receipt, exact local tool evidence and final pending memo before returning", async () => {
  const { meeting, plan, signal } = await setup();
  let submitted = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const latest = (await getMeeting(meeting.id))!;
      expect(latest.jobs.at(-1)?.state).toBe("in_flight");
      expect(latest.jobs.at(-1)?.reportedCostUsd).toBeNull();
      const body = JSON.parse(init.body);
      expect(body.store).toBe(false);
      expect(body.stream).toBe(true);
      expect(body.reasoning.effort).toBe("high");
      expect(body.max_output_tokens).toBe(32768);
      expect(init.cache).toBe("no-store");
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      if (++submitted === 1) return agentSse([call()]);
      expect(latest.jobs[0].assistantRecord).toBeDefined();
      expect(
        latest.memoAgents![0].context.some(
          (item) =>
            item.kind === "tool" &&
            item.text.includes(meeting.segments[0].text),
        ),
      ).toBe(true);
      expect(latest.memoAgents![0].consulted).toContainEqual({
        id: meeting.segments[0].id,
        revision: 1,
      });
      expect(
        body.input.some(
          (item: { type: string }) => item.type === "function_call_output",
        ),
      ).toBe(true);
      return agentSse([final(meeting.segments[0].id)]);
    }),
  );
  const result = validateMeeting(
    await runAgentMemo(meeting, plan, key, signal),
  );
  expect(submitted).toBe(2);
  expect(result.jobs).toHaveLength(2);
  expect(
    result.jobs.every(
      (job) =>
        job.state === "completed" &&
        job.billing === "possibly_charged" &&
        job.reportedCostUsd === null,
    ),
  ).toBe(true);
  expect(result.jobs[0].usage?.inputTokens).toBe(100);
  expect(result.jobs[0].requestId).toBe("synthetic-request");
  expect(result.memoAgents![0].state).toBe("completed");
  expect(result.memos[0].items[0].review).toBe("pending");
  expect(result.memos[0].originalItems).toEqual(result.memos[0].items);
  expect(JSON.stringify(result)).not.toContain(key);
  expect(
    readAgentAssistant(result.jobs[0].assistantRecord!).content[0].type,
  ).toBe("toolCall");
  const restored = await readBackup(
    new File([JSON.stringify(result)], "synthetic-agent.json"),
  );
  expect(restored.meeting.memoAgents).toEqual(result.memoAgents);
  expect(restored.meeting.jobs).toEqual(result.jobs);
});

test.each([400, 408, 429, 500, "disconnect", "truncated"])(
  "submitted %s stops after one attempt and never retries on reload",
  async (status) => {
    const { meeting, plan, signal } = await setup();
    const request = vi.fn(async () => {
      if (status === "disconnect") throw new TypeError("Synthetic disconnect");
      if (status === "truncated")
        return new Response(
          'event: response.created\ndata: {"type":"response.created","response":{"id":"synthetic"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      return new Response(
        JSON.stringify({ error: { message: `Synthetic refusal ${key}` } }),
        { status: status as number },
      );
    });
    vi.stubGlobal("fetch", request);
    await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
    const latest = validateMeeting((await getMeeting(meeting.id))!);
    expect(request).toHaveBeenCalledTimes(1);
    expect(latest.jobs).toHaveLength(1);
    expect(latest.jobs[0].state).toBe("outcome_unknown");
    expect(latest.jobs[0].billing).toBe("possibly_charged");
    expect(latest.memoAgents![0].state).toBe("blocked");
    expect(latest.memos).toHaveLength(0);
    expect(latest.jobs[0].usage).toBeNull();
    expect(JSON.stringify(latest)).not.toContain(key);
    await expect(
      runAgentMemo(latest, latest.memoAgents![0], key, signal),
    ).rejects.toThrow("previous paid outcome");
    expect(request).toHaveBeenCalledTimes(1);
  },
);

test("search snippets never count as consulted citations and an invalid final response is retained", async () => {
  const { meeting, plan, signal } = await setup();
  let turns = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ++turns === 1
        ? agentSse([call({ query: "a" }, "search", "search_transcript")])
        : agentSse([final(meeting.segments[0].id)]),
    ),
  );
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow(
    "did not read",
  );
  const latest = (await getMeeting(meeting.id))!;
  expect(turns).toBe(2);
  expect(latest.jobs.every((job) => job.state === "completed")).toBe(true);
  expect(latest.memoAgents![0].consulted).toEqual([]);
  expect(latest.memos).toEqual([]);
  expect(latest.jobs.at(-1)!.assistantRecord).toContain("Synthetic evidence");
});

test("tool budget is enforced before execution and the next paid request", async () => {
  const { meeting, plan, signal } = await setup();
  const request = vi.fn(async () =>
    agentSse(
      Array.from({ length: 33 }, (_, i) =>
        call({ startIndex: i }, `call-${i}`),
      ),
    ),
  );
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow(
    "tool budget",
  );
  const latest = (await getMeeting(meeting.id))!;
  expect(request).toHaveBeenCalledTimes(1);
  expect(latest.memoAgents![0].consulted).toEqual([]);
  expect(latest.jobs[0].state).toBe("completed");
  expect(latest.jobs[0].assistantRecord).toBeDefined();
});

test("repeated lookups stop without another paid turn when they produce no new evidence", async () => {
  const { meeting, plan, signal } = await setup();
  let turns = 0;
  const request = vi.fn(async () =>
    agentSse([call({ startIndex: 0, count: 1 }, `call-${++turns}`)]),
  );
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow(
    "no new evidence",
  );
  const latest = (await getMeeting(meeting.id))!;
  expect(request).toHaveBeenCalledTimes(4);
  expect(latest.jobs).toHaveLength(4);
  expect(latest.memoAgents![0].failure?.kind).toBe("limit");
});

test("explicit continuation replays saved read-only tools without resubmitting a known paid response", async () => {
  const { meeting, plan } = await setup();
  const controller = new AbortController();
  let submitted = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      submitted++;
      return agentSse([call()]);
    }),
  );
  await expect(
    runAgentMemo(meeting, plan, key, controller.signal, false, (saved) => {
      if (saved.jobs.some((job) => job.assistantRecord)) controller.abort();
    }),
  ).rejects.toThrow();
  let latest = (await getMeeting(meeting.id))!;
  expect(submitted).toBe(1);
  expect(latest.jobs[0].state).toBe("completed");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      submitted++;
      return agentSse([final(meeting.segments[0].id)]);
    }),
  );
  latest = await runAgentMemo(
    latest,
    latest.memoAgents![0],
    key,
    new AbortController().signal,
  );
  expect(submitted).toBe(2);
  expect(latest.memoAgents![0].state).toBe("completed");
});

test("an unsaved known receipt can be recovered locally without losing newer human changes", async () => {
  const { meeting, plan } = await setup();
  const jobId = crypto.randomUUID();
  const job: Meeting["jobs"][number] = {
    id: jobId,
    agentId: plan.id,
    stage: "memo",
    stepIndex: 0,
    state: "in_flight",
    billing: "possibly_charged",
    provider: "openai",
    model: selection.model,
    inputRevision: 1,
    outputLanguage: plan.outputLanguage,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    requestId: null,
    message: "Synthetic receipt",
  };
  const current = await saveMeeting({
    ...meeting,
    schemaVersion: 2,
    memoAgents: [{ ...plan, jobIds: [jobId], state: "running" }],
    jobs: [job],
  });
  const { retainAgentReceipt } = await import("../src/jobs/agent-recovery");
  const record = JSON.stringify({
    role: "assistant",
    api: "openai-responses",
    provider: "openai",
    model: selection.model,
    timestamp: Date.now(),
    content: [],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    stopReason: "stop",
  });
  retainAgentReceipt({
    meetingId: meeting.id,
    agentId: plan.id,
    job: { ...job, state: "completed", assistantRecord: record },
  });
  await saveMeeting({ ...current, title: "New human title" });
  const forbidden = vi.fn();
  vi.stubGlobal("fetch", forbidden);
  const saved = await recoverAgentReceipt(meeting.id);
  expect(saved.title).toBe("New human title");
  expect(saved.jobs[0].assistantRecord).toBe(record);
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
  expect(forbidden).not.toHaveBeenCalled();
  acknowledgeAgentExport(meeting.id);
});

test("quota failure after a paid response blocks further requests and retains a key-free local recovery receipt", async () => {
  const { meeting, plan, signal } = await setup();
  const original = repository.saveMeeting;
  let rejected = false;
  vi.spyOn(repository, "saveMeeting").mockImplementation(async (value) => {
    if (!rejected && value.jobs.some((job) => job.assistantRecord)) {
      rejected = true;
      throw new DOMException("Synthetic quota failure", "QuotaExceededError");
    }
    return original(value);
  });
  const request = vi.fn(async () => agentSse([call()]));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow(
    "quota",
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(pendingAgentReceipt(meeting.id)?.job.assistantRecord).toBeDefined();
  expect(JSON.stringify(pendingAgentReceipt(meeting.id))).not.toContain(key);
  const latest = (await getMeeting(meeting.id))!;
  await expect(
    runAgentMemo(latest, latest.memoAgents![0], key, signal),
  ).rejects.toThrow("unsaved");
  const recovered = await recoverAgentReceipt(meeting.id);
  expect(recovered.jobs[0].state).toBe("completed");
  expect(request).toHaveBeenCalledTimes(1);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => agentSse([final(meeting.segments[0].id)])),
  );
  const completed = await runAgentMemo(
    recovered,
    recovered.memoAgents![0],
    key,
    signal,
  );
  expect(completed.memos).toHaveLength(1);
  expect(completed.jobs).toHaveLength(2);
});

test("failed durable intent does not send a request or create a false response recovery", async () => {
  const { meeting, plan, signal } = await setup();
  const original = repository.saveMeeting;
  vi.spyOn(repository, "saveMeeting").mockImplementation(async (value) => {
    if (value.jobs.some((job) => job.state === "in_flight"))
      throw new DOMException("Synthetic intent quota", "QuotaExceededError");
    return original(value);
  });
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
  expect((await getMeeting(meeting.id))!.jobs).toHaveLength(0);
});

test("source edits made during processing remain current while the review retains its frozen evidence", async () => {
  const { meeting, plan, signal } = await setup();
  let turns = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (++turns === 1) return agentSse([call()]);
      const latest = (await getMeeting(meeting.id))!;
      const source = latest.segments[0];
      await saveMeeting({
        ...latest,
        revision: 2,
        segments: [
          { ...source, text: "Human correction while processing", revision: 2 },
          ...latest.segments.slice(1),
        ],
        history: [source],
      });
      return agentSse([final(source.id)]);
    }),
  );
  const completed = await runAgentMemo(meeting, plan, key, signal);
  expect(completed.revision).toBe(2);
  expect(completed.segments[0].text).toBe("Human correction while processing");
  expect(completed.memos[0].sourceRevision).toBe(1);
  expect(completed.memos[0].items[0].sources[0].revision).toBe(1);
});

test("aborting a submitted request records an unknown outcome and never continues", async () => {
  const { meeting, plan } = await setup();
  const controller = new AbortController();
  const request = vi.fn(async (_input, init) => {
    controller.abort();
    init.signal.throwIfAborted();
    return agentSse([call()]);
  });
  vi.stubGlobal("fetch", request);
  await expect(
    runAgentMemo(meeting, plan, key, controller.signal),
  ).rejects.toThrow();
  const latest = (await getMeeting(meeting.id))!;
  expect(request).toHaveBeenCalledTimes(1);
  expect(latest.jobs[0].state).toBe("outcome_unknown");
  expect(latest.jobs[0].billing).toBe("possibly_charged");
});

test("schema coercion cannot make invalid raw tool arguments into consulted evidence", async () => {
  const { meeting, plan, signal } = await setup();
  let turns = 0;
  const request = vi.fn(async () =>
    ++turns === 1
      ? agentSse([call({ startIndex: "0", count: 1 })])
      : agentSse([final(meeting.segments[0].id)]),
  );
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow(
    "did not read",
  );
  const latest = (await getMeeting(meeting.id))!;
  expect(latest.memoAgents![0].consulted).toEqual([]);
  expect(
    latest.memoAgents![0].context.some(
      (item) => item.kind === "tool" && item.isError,
    ),
  ).toBe(true);
});

test("an unsupported decoded response retains its bounded wire text for explicit export", async () => {
  const { meeting, plan, signal } = await setup();
  const args: Record<string, unknown> = {};
  let cursor = args;
  for (let i = 0; i < 20; i++) {
    const next = {};
    cursor.next = next;
    cursor = next;
  }
  const request = vi.fn(async () => agentSse([call(args)]));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(pendingAgentReceipt(meeting.id)?.wireResponse).toContain(
    "response.completed",
  );
  expect(JSON.stringify(pendingAgentReceipt(meeting.id))).not.toContain(key);
  const saved = await recoverAgentReceipt(meeting.id);
  expect(saved.jobs[0].state).toBe("outcome_unknown");
  expect(pendingAgentReceipt(meeting.id)).toBeDefined();
  expect(request).toHaveBeenCalledTimes(1);
  acknowledgeAgentExport(meeting.id);
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
});

test("oversized wire responses stop at the disclosed boundary without retrying or inventing usage", async () => {
  const { meeting, plan, signal } = await setup();
  const request = vi.fn(
    async () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
  );
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  const latest = (await getMeeting(meeting.id))!;
  expect(latest.jobs[0].state).toBe("outcome_unknown");
  expect(latest.jobs[0].usage).toBeNull();
  expect(latest.memos).toEqual([]);
});

async function recoveryFixture(advanced = false) {
  const { meeting, plan } = await setup();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const job: Meeting["jobs"][number] = {
    id: jobId,
    agentId: plan.id,
    stage: "memo",
    stepIndex: 0,
    state: "outcome_unknown",
    billing: "possibly_charged",
    provider: "openai",
    model: selection.model,
    inputRevision: 1,
    outputLanguage: plan.outputLanguage,
    createdAt: now,
    updatedAt: now,
    requestId: null,
    message: "Previous uncertain attempt",
  };
  const next = {
    ...job,
    id: crypto.randomUUID(),
    stepIndex: 1,
    state: "in_flight" as const,
    message: "New explicit attempt is active",
  };
  const record = JSON.stringify({
    role: "assistant",
    api: "openai-responses",
    provider: "openai",
    model: selection.model,
    timestamp: Date.now(),
    content: [],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    stopReason: "stop",
  });
  const current = await saveMeeting({
    ...meeting,
    schemaVersion: 2,
    memoAgents: [
      {
        ...plan,
        jobIds: advanced ? [jobId, next.id] : [jobId],
        state: "running",
      },
    ],
    jobs: advanced ? [job, next] : [job],
  });
  const recovered = {
    ...job,
    state: "completed" as const,
    assistantRecord: record,
    reportedCostUsd: null,
  };
  retainAgentReceipt({
    meetingId: meeting.id,
    agentId: plan.id,
    job: recovered,
  });
  return { current, recovered };
}

test("late receipt recovery never pauses or replaces a newer running plan", async () => {
  const { current, recovered } = await recoveryFixture(true);
  const forbidden = vi.fn();
  vi.stubGlobal("fetch", forbidden);
  const saved = await recoverAgentReceipt(current.id);
  expect(saved.jobs[0].assistantRecord).toBe(recovered.assistantRecord);
  expect(saved.jobs[0].state).toBe("completed");
  expect(saved.jobs[1]).toEqual(current.jobs[1]);
  expect(saved.memoAgents).toEqual(current.memoAgents);
  expect(forbidden).not.toHaveBeenCalled();
});

test("idempotent receipt recovery preserves later accounting and makes no extra write", async () => {
  const { current, recovered } = await recoveryFixture();
  const newer = await saveMeeting({
    ...current,
    jobs: [
      {
        ...recovered,
        billing: "provider_reported",
        reportedCostUsd: 0.012,
        message: "Later reconciled provider report",
      },
    ],
  });
  const saved = await recoverAgentReceipt(current.id);
  expect(saved).toEqual(newer);
  expect(saved.version).toBe(newer.version);
  expect(pendingAgentReceipt(current.id)).toBeUndefined();
});

test("local receipt recovery respects another tab's processing lock and retains its export copy", async () => {
  const { current } = await recoveryFixture();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: object,
        callback: (lock: null) => Promise<Meeting>,
      ) => callback(null),
    },
  });
  await expect(recoverAgentReceipt(current.id)).rejects.toThrow(
    "Another tab is processing this meeting.",
  );
  expect(await getMeeting(current.id)).toEqual(current);
  expect(pendingAgentReceipt(current.id)).toBeDefined();
});


test("new evidence resets the consecutive no-progress guard", async () => {
  const { meeting, signal } = await setup();
  const plan = planAgentMemo(meeting, selection, "zh-CN");
  const ranges = [0, 0, 0, 1, 1, 1];
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const turn = calls++;
    return agentSse(turn < ranges.length
      ? [call({ startIndex: ranges[turn], count: 1 }, `progress-${turn}`)]
      : [final(meeting.segments[1].id)]);
  }));
  const completed = await runAgentMemo(meeting, plan, key, signal);
  expect(calls).toBe(7);
  expect(completed.memoAgents![0].state).toBe("completed");
  expect(completed.memoAgents![0].consulted).toHaveLength(2);
  expect(completed.jobs.every(job => job.state === "completed")).toBe(true);
});

test("legacy six-request checkpoints continue explicitly without losing receipts or source revisions", async () => {
  const { meeting, signal } = await setup();
  const expanded = await saveMeeting({ ...meeting, segments: Array.from({ length: 40 }, (_, index) => ({
    ...meeting.segments[0], id: crypto.randomUUID(), text: `Evidence ${index}.`, originalText: `Evidence ${index}.`,
  })) });
  const plan = planAgentMemo(expanded, selection, "zh-CN");
  const controller = new AbortController();
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => agentSse([call({ startIndex: calls, count: 1 }, `legacy-${calls++}`)])));
  await expect(runAgentMemo(expanded, plan, key, controller.signal, false, saved => {
    if (saved.jobs.length === 6 && saved.jobs[5].state === "completed") controller.abort();
  })).rejects.toThrow();
  let latest = (await getMeeting(meeting.id))!;
  const oldReceipts = structuredClone(latest.jobs);
  latest.memoAgents![0].requestLimit = 6;
  latest.memoAgents![0].failure = { kind: "limit", message: "The six-request limit was reached. Saved responses remain available." };
  latest = await saveMeeting(latest);
  const restored = await readBackup(new File([await backupMeeting(latest)], "legacy.zip"));
  expect(restored.meeting.memoAgents![0].requestLimit).toBe(6);
  vi.stubGlobal("fetch", vi.fn(async () => { calls++; return agentSse([final(expanded.segments[5].id)]); }));
  const completed = await runAgentMemo(latest, latest.memoAgents![0], key, signal);
  expect(calls).toBe(7);
  expect(completed.jobs.slice(0, 6)).toEqual(oldReceipts);
  expect(completed.memoAgents![0].requestLimit).toBe(100);
  expect(completed.memoAgents![0].state).toBe("completed");
  expect(completed.memos[0].items[0].sources).toEqual([{ id: expanded.segments[5].id, revision: 1 }]);
  const exported = await readBackup(new File([await backupMeeting(completed)], "continued.zip"));
  expect(exported.meeting.jobs).toHaveLength(7);
  expect(exported.meeting.memoAgents![0].requestLimit).toBe(100);
});

const routerSelection = { provider: "openrouter" as const, model: "openai/gpt-6-luna" };
function routerSse(delta: object, finish: string, extra: object = {}) {
  return new Response(`data: ${JSON.stringify({ id: "synthetic-router-response", model: routerSelection.model, provider: "OpenAI", choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, ...extra })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}
const routerReasoning = [{ type: "reasoning.encrypted", id: "synthetic-reasoning", data: "opaque-router-signature", format: "openai-responses-v1", index: 0 }];
const routerCall = () => routerSse({ reasoning_details: routerReasoning, tool_calls: [{ index: 0, id: "call-router", type: "function", function: { name: "read_transcript_range", arguments: '{"startIndex":0,"count":2}' } }] }, "tool_calls");
const routerFinal = (source: string) => routerSse({ content: final(source).content[0].text }, "stop");

test("OpenRouter Pi saves exact route, tool evidence, actual usage and backup without changing original notes", async () => {
  const { meeting, signal } = await setup();
  const plan = planAgentMemo(meeting, routerSelection, "zh-CN");
  plan.route = { ...plan.route!, reasoning: "medium", maxOutputTokens: 16384 };
  let calls = 0;
  const request = vi.fn(async (url, init) => {
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const persisted = (await getMeeting(meeting.id))!;
    expect(persisted.memoAgents![0].route).toEqual(plan.route);
    expect(persisted.jobs.at(-1)).toMatchObject({ state: "in_flight", provider: "openrouter", model: routerSelection.model });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ reasoning: { effort: "medium" }, max_tokens: 16384, provider: { only: ["openai"], allow_fallbacks: false, require_parameters: true } });
    expect(init).toMatchObject({ redirect: "error", cache: "no-store", credentials: "omit" });
    if (++calls === 1) return routerCall();
    expect(body.messages.some((message: { role: string }) => message.role === "tool")).toBe(true);
    expect(body.messages.find((message: { role: string }) => message.role === "assistant").reasoning_details).toEqual(routerReasoning);
    return routerFinal(meeting.segments[0].id);
  });
  vi.stubGlobal("fetch", request);
  const completed = await runAgentMemo(meeting, plan, key, signal);
  expect(request).toHaveBeenCalledTimes(2);
  expect(completed.memoAgents![0]).toMatchObject({ state: "completed", route: plan.route });
  expect(completed.memos.slice(0, meeting.memos.length)).toEqual(meeting.memos);
  expect(completed.memos.at(-1)?.model).toContain("OpenRouter: openai/gpt-6-luna");
  expect(completed.jobs.every(job => job.upstreamProvider === "OpenAI" && job.usage?.inputTokens === 100 && job.reportedCostUsd === null)).toBe(true);
  const restored = await readBackup(new File([await backupMeeting(completed)], "router.zip"));
  expect(restored.meeting.memoAgents).toEqual(completed.memoAgents);
  expect(restored.meeting.jobs).toEqual(completed.jobs);
  expect(JSON.stringify(restored.meeting)).not.toContain(key);
});

test("legacy OpenAI checkpoints resume with low/4096 and keep their missing route field", async () => {
  const { meeting, plan, signal } = await setup();
  delete plan.route;
  let calls = 0;
  const request = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    expect(body.reasoning.effort).toBe("low");
    expect(body.max_output_tokens).toBe(4096);
    return ++calls === 1 ? agentSse([call()]) : agentSse([final(meeting.segments[0].id)]);
  });
  vi.stubGlobal("fetch", request);
  const completed = await runAgentMemo(meeting, plan, key, signal);
  expect(completed.memoAgents![0].route).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(2);
});

test("interrupted OpenRouter review requires explicit authorization and resumes the frozen route", async () => {
  const { meeting, signal } = await setup();
  const plan = planAgentMemo(meeting, routerSelection, "en");
  let calls = 0;
  const request = vi.fn(async () => {
    if (++calls === 1) return routerCall();
    throw new Error("Synthetic interrupted transfer");
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.jobs.at(-1)?.state).toBe("outcome_unknown");
  expect(request).toHaveBeenCalledTimes(2);
  await expect(runAgentMemo(saved, saved.memoAgents![0], key, signal)).rejects.toThrow("previous paid outcome");
  await expect(runAgentMemo(saved, { ...saved.memoAgents![0], route: { ...plan.route!, reasoning: "low" } }, key, signal, true)).rejects.toThrow("confirmed review changed");
  expect(request).toHaveBeenCalledTimes(2);
  request.mockImplementation(async () => routerFinal(meeting.segments[0].id));
  const completed = await runAgentMemo(saved, saved.memoAgents![0], key, signal, true);
  expect(request).toHaveBeenCalledTimes(3);
  expect(completed.memoAgents![0].route).toEqual(plan.route);
  expect(completed.memoAgents![0].state).toBe("completed");
});

test.each([{ provider: "Azure" }, { model: "other/model" }, { provider: key }])("a reported OpenRouter substitution %j stops without fallback", async extra => {
  const { meeting, signal } = await setup();
  const plan = planAgentMemo(meeting, routerSelection, "en");
  const request = vi.fn(async () => routerSse({ content: "Unapproved model result" }, "stop", extra));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.jobs[0].state).toBe("outcome_unknown");
  expect(saved.jobs[0].assistantRecord).toContain("different Pi model route");
  expect(JSON.stringify(saved)).not.toContain(key);
  expect(saved.memos).toEqual(meeting.memos);
});

async function longReviewSetup() {
  const setupValue = await setup();
  const meeting = await saveMeeting({ ...setupValue.meeting, segments: Array.from({ length: 120 }, (_, index) => ({
    ...setupValue.meeting.segments[0], id: crypto.randomUUID(), text: `Evidence ${index}.`, originalText: `Evidence ${index}.`,
  })) });
  return { ...setupValue, meeting, plan: planAgentMemo(meeting, selection, "zh-CN") };
}

test("Pi completes useful analysis on request 100 with every attempt durably recorded before sending", async () => {
  const { meeting, plan, signal } = await longReviewSetup();
  let calls = 0;
  const prompts: string[] = [];
  const request = vi.fn(async (_url, init) => {
    const attempt = ++calls;
    prompts.push(init.body);
    const saved = (await getMeeting(meeting.id))!;
    expect(saved.memoAgents![0].jobIds).toHaveLength(attempt);
    expect(saved.jobs.at(-1)).toMatchObject({ state: "in_flight", stepIndex: attempt - 1 });
    return agentSse(attempt < 100
      ? [call({ startIndex: attempt - 1, count: 1 }, `hundred-${attempt}`)]
      : [final(meeting.segments[98].id)]);
  });
  vi.stubGlobal("fetch", request);
  const completed = await runAgentMemo(meeting, plan, key, signal);
  expect(request).toHaveBeenCalledTimes(100);
  for (const [index, prompt] of prompts.entries()) expect(prompt).toContain(`Request ${index + 1} of 100; ${100 - index} requests available including this request.`);
  expect(completed.memoAgents![0]).toMatchObject({ requestLimit: 100, state: "completed" });
  expect(completed.memoAgents![0].consulted).toHaveLength(99);
  expect(completed.memos.at(-1)!.items[0].sources).toEqual([{ id: meeting.segments[98].id, revision: 1 }]);
  expect(completed.jobs).toHaveLength(100);
  const interrupted = await saveMeeting({ ...completed, memos: [], memoAgents: [{ ...completed.memoAgents![0], state: "paused", memoId: null }] });
  expect(hasSavedAgentFinal(interrupted, interrupted.memoAgents![0])).toBe(true);
  const recovered = await runAgentMemo(interrupted, interrupted.memoAgents![0], key, signal);
  expect(request).toHaveBeenCalledTimes(100);
  expect(recovered.memoAgents![0].state).toBe("completed");
  expect(recovered.memos).toHaveLength(1);
  const originalPlan = completed.memoAgents![0];
  for (const jobIds of [originalPlan.jobIds.slice(0, 99), [...originalPlan.jobIds.slice(0, 99), originalPlan.jobIds[0]]]) {
    expect(() => validateMeeting({ ...completed, memoAgents: [{ ...originalPlan, jobIds }] })).toThrow();
  }
  expect(() => validateMeeting({ ...completed, jobs: completed.jobs.map((job, index) => index === 99 ? { ...job, stepIndex: 98 } : job) })).toThrow("Invalid agent job checkpoint");
});

test("request 101 stays blocked after explicit continuation and backup restore, including legacy over-limit records", async () => {
  const { meeting, plan, signal } = await longReviewSetup();
  let calls = 0;
  const request = vi.fn(async () => {
    const attempt = ++calls;
    return agentSse([call({ startIndex: attempt - 1, count: 1 }, `ceiling-${attempt}`)]);
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("100-request limit");
  expect(request).toHaveBeenCalledTimes(100);
  let latest = (await getMeeting(meeting.id))!;
  const savedJobs = structuredClone(latest.jobs);
  expect(latest.memoAgents![0]).toMatchObject({ requestLimit: 100, state: "blocked", failure: { kind: "limit" } });
  const restored = await readBackup(new File([await backupMeeting(latest)], "capped-review.zip"));
  const restoredMeeting = await saveMeeting({ ...restored.meeting, id: crypto.randomUUID(), version: 0 });
  await expect(runAgentMemo(restoredMeeting, restoredMeeting.memoAgents![0], key, signal, true)).rejects.toThrow("100-request limit");
  expect(request).toHaveBeenCalledTimes(100);
  expect((await getMeeting(restoredMeeting.id))!.jobs).toEqual(savedJobs);
  await expect(runAgentMemo(latest, latest.memoAgents![0], key, signal, true)).rejects.toThrow("100-request limit");
  latest = (await getMeeting(meeting.id))!;
  expect(latest.jobs).toEqual(savedJobs);
  const previous = latest.memoAgents![0];
  const extra = { ...latest.jobs.at(-1)!, id: crypto.randomUUID(), stepIndex: 100 };
  latest = await saveMeeting({ ...latest, jobs: [...latest.jobs, extra], memoAgents: [{ ...previous, requestLimit: null, jobIds: [...previous.jobIds, extra.id] }] });
  const overLimit = await readBackup(new File([await backupMeeting(latest)], "legacy-over-limit.zip"));
  expect(overLimit.meeting.memoAgents![0].jobIds).toHaveLength(101);
  expect(overLimit.meeting.memoAgents![0].requestLimit).toBeNull();
  await expect(runAgentMemo(latest, latest.memoAgents![0], key, signal, true)).rejects.toThrow("100-request limit");
  expect(request).toHaveBeenCalledTimes(100);
  expect((await getMeeting(meeting.id))!.jobs).toHaveLength(101);
});

test("a failed 100th request consumes its durable allowance while another plan has its own allowance", async () => {
  const { meeting, plan } = await longReviewSetup();
  const controller = new AbortController();
  let calls = 0;
  const request = vi.fn(async () => {
    const attempt = ++calls;
    return agentSse([call({ startIndex: attempt - 1, count: 1 }, `interrupted-${attempt}`)]);
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, controller.signal, false, saved => {
    if (saved.jobs.length === 99 && saved.jobs[98].state === "completed") controller.abort();
  })).rejects.toThrow();
  let latest = (await getMeeting(meeting.id))!;
  expect(latest.memoAgents![0].jobIds).toHaveLength(99);
  const failed = vi.fn(async () => { throw new Error("Synthetic disconnect"); });
  vi.stubGlobal("fetch", failed);
  await expect(runAgentMemo(latest, latest.memoAgents![0], key, new AbortController().signal, true)).rejects.toThrow();
  latest = (await getMeeting(meeting.id))!;
  expect(failed).toHaveBeenCalledTimes(1);
  expect(latest.memoAgents![0].jobIds).toHaveLength(100);
  expect(latest.jobs.at(-1)?.state).toBe("outcome_unknown");
  await expect(runAgentMemo(latest, latest.memoAgents![0], key, new AbortController().signal, true)).rejects.toThrow("100-request limit");
  expect(failed).toHaveBeenCalledTimes(1);
  latest = (await getMeeting(meeting.id))!;
  const nextPlan = planAgentMemo(latest, selection, "zh-CN");
  let nextCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ++nextCalls === 1 ? agentSse([call()]) : agentSse([final(meeting.segments[0].id)])));
  const completed = await runAgentMemo(latest, nextPlan, key, new AbortController().signal);
  expect(nextCalls).toBe(2);
  expect(completed.memoAgents!.map(value => value.jobIds.length)).toEqual([100, 2]);
});


test("canceling after receipt persistence consumes an attempt without sending and non-agent jobs keep their step bound", async () => {
  const { meeting, plan } = await setup();
  const controller = new AbortController();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, controller.signal, false, saved => {
    if (saved.jobs.at(-1)?.state === "in_flight") controller.abort();
  })).rejects.toThrow();
  const latest = (await getMeeting(meeting.id))!;
  expect(request).not.toHaveBeenCalled();
  expect(latest.memoAgents![0].jobIds).toHaveLength(1);
  expect(latest.jobs[0]).toMatchObject({ state: "failed_before_send", billing: "not_submitted", stepIndex: 0 });
  const { agentId: _agentId, assistantRecord: _record, ...ordinary } = latest.jobs[0];
  expect(_agentId).toBe(plan.id);
  expect(_record).toBeDefined();
  expect(() => validateMeeting({ ...meeting, jobs: [{ ...ordinary, stepIndex: 9 }] })).toThrow();
});
