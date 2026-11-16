import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import {
  sampleMeeting,
  validateMeeting,
  type Meeting,
} from "../src/domain/model";
import { saveMeeting, getMeeting } from "../src/storage/repository";
import { planAgentMemo } from "../src/providers/memo-agent-plan";
import { runAgentMemo } from "../src/jobs/memo-agent";
import { readAgentAssistant } from "../src/providers/agent-record";
import {
  acknowledgeAgentExport,
  pendingAgentReceipt,
  recoverAgentReceipt,
} from "../src/jobs/agent-recovery";
import * as repository from "../src/storage/repository";
import { readBackup } from "../src/storage/backup";

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
      expect(body.reasoning.effort).toBe("low");
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

test("six paid turns are a hard limit even when the assistant asks to keep reading", async () => {
  const { meeting, plan, signal } = await setup();
  let turns = 0;
  const request = vi.fn(async () =>
    agentSse([call({ startIndex: 0, count: 1 }, `call-${++turns}`)]),
  );
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow(
    "six-request",
  );
  const latest = (await getMeeting(meeting.id))!;
  expect(request).toHaveBeenCalledTimes(6);
  expect(latest.jobs).toHaveLength(6);
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
