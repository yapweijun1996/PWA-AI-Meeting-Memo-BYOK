import "fake-indexeddb/auto";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test, vi } from "vitest";
import {
  sampleMeeting,
  validateMeeting,
  type Job,
  type Meeting,
} from "../src/domain/model";
import { saveMeeting, getMeeting } from "../src/storage/repository";
import { hasSavedAgentFinal, planAgentMemo } from "../src/providers/memo-agent-plan";
import { runAgentMemo } from "../src/jobs/memo-agent";
import { readAgentAssistant } from "../src/providers/agent-record";
import { previewHistoryCleanup } from "../src/domain/history-cleanup";
import {
  acknowledgeAgentExport,
  hasPendingAgentReceipt,
  pendingAgentMeetingId,
  pendingAgentReceipt,
  receiptExport,
  recoverAgentReceipt,
  retainAgentReceipt,
} from "../src/jobs/agent-recovery";
import * as repository from "../src/storage/repository";
import { backupMeeting, readBackup } from "../src/storage/backup";
import * as agentTransport from "../src/providers/memo-agent-transport";
import { MEMO_AGENT_REQUEST_BYTES, MEMO_AGENT_RESPONSE_BYTES } from "../src/domain/memo-agent-contract";

const selection = { provider: "openai" as const, model: "gpt-6-luna" };
const key = "sk-synthetic-agent-unit-key";
const redaction = "[redacted provider key]";
const meetingIds: string[] = [];
function exportedReceipt(meetingId: string) {
  const pending = pendingAgentReceipt(meetingId);
  expect(pending).toBeDefined();
  return receiptExport(pending!);
}
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

test.each([17, 22])("Pi compacts an oversized request after %i tool rounds without losing citations or receipts", async rounds => {
  const { meeting: base, signal } = await setup();
  const speakers = Array.from({ length: 14 }, (_, index) => ({
    ...base.speakers[0], id: crypto.randomUUID(), name: `Speaker ${index + 1}`,
  }));
  const segments = Array.from({ length: 11865 }, (_, index) => {
    const word = ["meeting", "agenda", "review"][index % 3];
    return {
      ...base.segments[0], id: `part-${Math.floor(index / 3955)}:${crypto.randomUUID()}`,
      text: word, originalText: word, start: index / 4, end: (index + 1) / 4,
      speakerIds: [speakers[index % speakers.length].id],
    };
  });
  const speechJobs = Array.from({ length: 3 }, (_, index) => ({
    id: crypto.randomUUID(), stage: "speech" as const, state: "completed" as const,
    billing: "possibly_charged" as const, createdAt: base.createdAt, updatedAt: base.updatedAt,
    requestId: null, message: "Synthetic transcription", inputRevision: base.revision, chunk: { index, total: 3 },
  }));
  const meeting = await saveMeeting({
    ...base, speakers, segments, jobs: speechJobs, runs: [{
      id: crypto.randomUUID(), provider: "openai", model: "synthetic", createdAt: base.createdAt,
      speakers, originalSegments: segments,
    }],
  });
  const plan = planAgentMemo(meeting, selection, "en");
  const guard = vi.spyOn(agentTransport, "assertAgentTransport");
  let nextPassage = 0;
  let submitted = 0;
  const request = vi.fn(async (_url, init: RequestInit) => {
    const round = ++submitted;
    if (round === rounds + 1) {
      expect(String(init.body)).toContain("Local context index");
      expect(new TextEncoder().encode(String(init.body)).length).toBeLessThanOrEqual(MEMO_AGENT_REQUEST_BYTES);
      return agentSse([final(segments[0].id)]);
    }
    if (round > rounds + 1) throw new Error("Unexpected additional provider request");
    const count = rounds === 22 ? 16 : round === 17 ? 32 : 20;
    const calls = [0, 1].map(index => {
      const startIndex = nextPassage;
      nextPassage += count;
      return call({ startIndex, count }, `read-${round}-${index}`);
    });
    // Keep the precise crossing reproducible as the SDK's request framing evolves.
    const previousBytes = new TextEncoder().encode(String(init.body)).length;
    const reasoningBytes = round === rounds ? MEMO_AGENT_REQUEST_BYTES - previousBytes : 2000;
    return agentSse([{
      type: "reasoning", id: `rs_${round}`, summary: [], encrypted_content: "x".repeat(reasoningBytes),
    }, ...calls]);
  });
  vi.stubGlobal("fetch", request);
  const saved = await runAgentMemo(meeting, plan, key, signal);
  expect(request).toHaveBeenCalledTimes(rounds + 1);
  expect(guard.mock.calls.some(([, , init]) => new TextEncoder().encode(String(init!.body)).length > MEMO_AGENT_REQUEST_BYTES)).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(saved)).length).toBeLessThan(10 * 1024 * 1024);
  expect(saved.jobs.slice(0, 3)).toEqual(speechJobs);
  expect(saved.jobs.slice(3)).toHaveLength(rounds + 1);
  expect(saved.jobs.slice(3).every(job => job.state === "completed" && job.assistantRecord)).toBe(true);
  expect(saved.memoAgents![0].jobIds).toEqual(saved.jobs.slice(3).map(job => job.id));
  expect(saved.memoAgents![0].consulted).toHaveLength(704);
  expect(saved.memoAgents![0]).toMatchObject({ state: "completed", failure: null });
  expect(saved.memos[0].items[0].sources).toEqual([{ id: segments[0].id, revision: segments[0].revision }]);
  expect(saved.jobs[rounds + 2].assistantRecord).toContain("x".repeat(2000));
}, 120000);

test("checkpoints tool evidence before the next request without rewriting unchanged review state", async () => {
  const { meeting, plan, signal } = await setup();
  const checkpoints: string[] = [];
  let attempt = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const saved = (await getMeeting(meeting.id))!;
    expect(saved.jobs.at(-1)?.state).toBe("in_flight");
    if (++attempt === 1) return agentSse([call()]);
    expect(saved.memoAgents?.[0].context.some(item => item.kind === "tool")).toBe(true);
    return agentSse([final(meeting.segments[0].id)]);
  }));

  await runAgentMemo(meeting, plan, key, signal, false, saved => {
    checkpoints.push(JSON.stringify({
      jobs: saved.jobs, review: saved.memoAgents?.[0], memos: saved.memos,
    }));
  });

  expect(attempt).toBe(2);
  expect(new Set(checkpoints).size).toBe(checkpoints.length);
});

test("an SDK failure before the fetch hook reports request preparation and leaves the ledger empty", async () => {
  const { meeting, plan, signal } = await setup();
  vi.spyOn(agentTransport, "streamAgentRoute").mockResolvedValue({
    role: "assistant", api: "openai-responses", provider: "openai", model: selection.model,
    timestamp: 0, content: [], stopReason: "error", errorMessage: "Synthetic request preparation error.",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("could not prepare the next provider request");
  expect(request).not.toHaveBeenCalled();
  expect((await getMeeting(meeting.id))!.jobs).toEqual([]);
});

test("a competing meeting version at the intent write preserves the edit and reports the version conflict", async () => {
  const { meeting, plan, signal } = await setup();
  const save = repository.saveMeeting;
  vi.spyOn(repository, "saveMeeting").mockImplementation(async value => {
    if (value.jobs.at(-1)?.state === "in_flight") {
      const latest = (await getMeeting(meeting.id))!;
      await save({ ...latest, title: "Concurrent human edit" });
    }
    return save(value);
  });
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("changed in another tab");
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.title).toBe("Concurrent human edit");
  expect(saved.jobs).toEqual([]);
  expect(saved.memoAgents![0].jobIds).toEqual([]);
  expect(saved.memoAgents![0].failure?.message).toBe(new repository.ConflictError().message);
  expect(request).not.toHaveBeenCalled();
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
    if (status === "truncated") {
      expect(exportedReceipt(meeting.id)).toMatchObject({
        version: 1, wireResponse: 'event: response.created\ndata: {"type":"response.created","response":{"id":"synthetic"}}\n\n',
      });
      await expect(runAgentMemo(latest, latest.memoAgents![0], key, signal, true)).rejects.toThrow("unsaved");
      acknowledgeAgentExport(meeting.id);
    }
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

test.each(["distinct passages", "one repeated passage", "an empty result"] as const)(
  "compacted progress guard handles rereads of %s",
  async (scenario) => {
    const { meeting: sample, signal } = await setup();
    const segments = Array.from({ length: 6 }, (_, index) => ({
      ...sample.segments[0], id: crypto.randomUUID(), text: `Omitted source fact ${index}.`,
    }));
    const meeting = await saveMeeting({ ...sample, segments });
    const plan = planAgentMemo(meeting, selection, "zh-CN");
    const distinct = scenario === "distinct passages";
    const empty = scenario === "an empty result";
    const firstReads = [0, 1, 2, 3, 4, empty ? segments.length : 5];
    const expectedTurns = empty ? 9 : 10;
    let turn = 0;
    const request = vi.fn(async (_input, init: RequestInit) => {
      turn++;
      const body = String(init.body);
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(MEMO_AGENT_REQUEST_BYTES);
      if (distinct && turn === 10) return agentSse([final(segments[3].id)]);
      if (turn > expectedTurns) throw new Error("Unexpected provider submission");
      const index = firstReads[turn - 1] ?? (distinct ? turn - 6 : empty ? segments.length : 1);
      if (turn > 6) {
        expect(body).toContain("Local context index");
        if (segments[index]) expect(body).not.toContain(segments[index].text);
      }
      const lookup = call({ startIndex: index, count: 1 }, `lookup-${turn}`);
      // In the repeat case, keep projecting away the repeated result on every turn.
      return turn === 6 || (!distinct && turn > 6)
        ? agentSse([{
          type: "reasoning", id: `rs_oversize_${turn}`, summary: [],
          encrypted_content: "r".repeat(MEMO_AGENT_REQUEST_BYTES),
        }, lookup])
        : agentSse([lookup]);
    });
    vi.stubGlobal("fetch", request);
    const run = runAgentMemo(meeting, plan, key, signal);
    if (distinct) {
      const saved = await run;
      expect(saved.memoAgents![0].state).toBe("completed");
      expect(saved.memos[0].items[0].sources).toEqual([{ id: segments[3].id, revision: segments[3].revision }]);
    } else {
      await expect(run).rejects.toThrow("repeated lookups produced no new evidence");
      const saved = (await getMeeting(meeting.id))!;
      expect(saved.memoAgents![0].failure?.kind).toBe("limit");
      expect(saved.memos).toHaveLength(0);
    }
    const saved = (await getMeeting(meeting.id))!;
    expect(request).toHaveBeenCalledTimes(expectedTurns);
    expect(saved.jobs).toHaveLength(expectedTurns);
    expect(saved.jobs.every(job => job.state === "completed" && job.assistantRecord)).toBe(true);
    expect(saved.memoAgents![0].consulted).toHaveLength(empty ? 5 : 6);
  },
  60_000,
);

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

test("a compacted request preserves the interrupted attempt, evidence and order across ZIP restore", async () => {
  const { meeting, plan, signal } = await setup();
  const controller = new AbortController();
  let turns = 0;
  const request = vi.fn(async (_input, init: RequestInit) => {
    switch (++turns) {
      case 1:
        return agentSse([{
          type: "reasoning", id: "rs_compacted", summary: [], encrypted_content: "r".repeat(MEMO_AGENT_REQUEST_BYTES),
        }, call()]);
      case 2:
        expect(String(init.body)).toContain("Local context index");
        controller.abort();
        init.signal?.throwIfAborted();
        throw new Error("Expected the request to be aborted.");
      case 3:
        expect(String(init.body)).toContain("Local context index");
        expect(String(init.body)).toContain("Request 3 of 100");
        return agentSse([final(meeting.segments[0].id)]);
      default:
        throw new Error("Unexpected provider submission");
    }
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, controller.signal)).rejects.toThrow();
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.jobs.map(job => job.state)).toEqual(["completed", "outcome_unknown"]);
  expect(saved.memoAgents![0].context.filter(item => item.kind === "tool")).toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(2);
  const restored = await readBackup(new File([await backupMeeting(saved)], "compacted-interrupted.zip"));
  const copy = await saveMeeting(restored.meeting);
  const savedPlan = copy.memoAgents![0];
  await expect(runAgentMemo(copy, savedPlan, key, signal)).rejects.toThrow("Review the previous paid outcome");
  expect(request).toHaveBeenCalledTimes(2);
  const completed = await runAgentMemo(copy, savedPlan, key, signal, true);
  expect(request).toHaveBeenCalledTimes(3);
  expect(completed.jobs.map(job => job.state)).toEqual(["completed", "outcome_unknown", "completed"]);
  expect(completed.jobs[0].assistantRecord).toBe(saved.jobs[0].assistantRecord);
  expect(completed.memoAgents![0].jobIds).toEqual([...savedPlan.jobIds, completed.jobs[2].id]);
  expect(completed.memos[0].items[0].sources).toEqual([{ id: meeting.segments[0].id, revision: meeting.segments[0].revision }]);
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
  const wire = await agentSse([call(args)]).text();
  const request = vi.fn(async () => {
    const response = agentSse([call(args)]);
    response.headers.delete("x-request-id");
    return response;
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(exportedReceipt(meeting.id)).toMatchObject({ version: 1, wireResponse: wire });
  expect(JSON.stringify(pendingAgentReceipt(meeting.id))).not.toContain(key);
  const saved = await recoverAgentReceipt(meeting.id);
  expect(saved.jobs[0]).toMatchObject({
    state: "outcome_unknown", requestId: "synthetic-response", usage: { inputTokens: 100, outputTokens: 20 },
  });
  expect(pendingAgentReceipt(meeting.id)).toBeDefined();
  expect(request).toHaveBeenCalledTimes(1);
  acknowledgeAgentExport(meeting.id);
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
});

test("oversized wire responses stop at the disclosed boundary without retrying or inventing usage", async () => {
  const { meeting, plan, signal } = await setup();
  const prefix = 'event: response.output_text.delta\ndata: {"delta":"Captured paid text. ';
  const request = vi.fn(
    async () => new Response(prefix + "x".repeat(MEMO_AGENT_RESPONSE_BYTES + 1 - prefix.length)),
  );
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  const latest = (await getMeeting(meeting.id))!;
  expect(latest.jobs[0].state).toBe("outcome_unknown");
  expect(latest.jobs[0].usage).toBeNull();
  expect(latest.memos).toEqual([]);
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
  expect(latest.jobs[0].assistantRecord).not.toContain("Captured paid text.");
  await expect(runAgentMemo(latest, latest.memoAgents![0], key, signal)).rejects.toThrow("previous paid outcome");
  expect(request).toHaveBeenCalledTimes(1);
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


test("canceling a proven-unsent Pi intent leaves the allowance and billing consent available after restore", async () => {
  const { meeting, plan } = await setup();
  const controller = new AbortController();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, controller.signal, false, saved => {
    if (saved.jobs.at(-1)?.state === "in_flight") controller.abort();
  })).rejects.toThrow();
  const latest = (await getMeeting(meeting.id))!;
  expect(request).not.toHaveBeenCalled();
  expect(latest.memoAgents![0].jobIds).toHaveLength(0);
  expect(latest.jobs).toHaveLength(0);
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
  const restored = await readBackup(new File([await backupMeeting(latest)], "unsent.zip"));
  const copy = await saveMeeting(restored.meeting);
  meetingIds.push(copy.id);
  request.mockResolvedValueOnce(agentSse([call()])).mockResolvedValueOnce(agentSse([final(copy.segments[0].id)]));
  const completed = await runAgentMemo(copy, copy.memoAgents![0], key, new AbortController().signal);
  expect(completed.jobs.map(job => job.stepIndex)).toEqual([0, 1]);
  expect(completed.memos).toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(2);
  const { agentId: _agentId, assistantRecord: _record, ...ordinary } = completed.jobs[0];
  expect(() => validateMeeting({ ...meeting, jobs: [{ ...ordinary, stepIndex: 9 }] })).toThrow();
});

test("the next POST uses the checkpointed bounded result for an SDK argument error", async () => {
  const { meeting, plan, signal } = await setup();
  let sentOutput = "";
  const request = vi.fn(async (_url, init) => {
    const output = JSON.parse(init.body).input.find((part: { type: string }) => part.type === "function_call_output");
    if (!output) return agentSse([call({ startIndex: "x".repeat(12000) })]);
    sentOutput = output.output;
    return agentSse([final(meeting.segments[0].id)]);
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("did not read");
  const savedPlan = (await getMeeting(meeting.id))!.memoAgents![0];
  const result = savedPlan.context.find(item => item.kind === "tool");
  expect(result?.isError).toBe(true);
  expect(new TextEncoder().encode(sentOutput).byteLength).toBeLessThanOrEqual(8192);
  expect(sentOutput).toBe(result?.text);
  expect(savedPlan.consulted).toEqual([]);
  expect(request).toHaveBeenCalledTimes(2);
});

test("duplicate provider call IDs stop live execution even with distinct Responses item IDs", async () => {
  const { meeting, plan, signal } = await setup();
  const first = call({ startIndex: 0, count: 1 });
  const second = { ...call({ startIndex: 1, count: 1 }), id: "fc_second_item" };
  const request = vi.fn().mockResolvedValueOnce(agentSse([first, second]))
    .mockResolvedValueOnce(agentSse([final(meeting.segments[1].id)]));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("tool call ID");
  expect(request).toHaveBeenCalledTimes(1);
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.memoAgents![0].consulted).toEqual([]);
  expect(saved.jobs[0].assistantRecord).toContain(second.id);
});

test("continuation cannot replay a previously rejected duplicate tool burst", async () => {
  const { meeting, plan, signal } = await setup();
  const request = vi.fn().mockResolvedValueOnce(agentSse([call(), call()]))
    .mockResolvedValueOnce(agentSse([final(meeting.segments[0].id)]));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("tool call ID");
  const saved = (await getMeeting(meeting.id))!;
  await expect(runAgentMemo(saved, saved.memoAgents![0], key, signal)).rejects.toThrow("tool call ID");
  expect(request).toHaveBeenCalledTimes(1);
  expect((await getMeeting(meeting.id))!.jobs).toEqual(saved.jobs);
});

test("a reflected credential in the request ID is redacted before persistence and backup", async () => {
  const { meeting, plan, signal } = await setup();
  const response = agentSse([final(meeting.segments[0].id)]);
  response.headers.set("x-request-id", "receipt-" + key);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("did not read");
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.jobs[0].requestId).toBe("receipt-[redacted provider key]");
  const restored = await readBackup(new File([await backupMeeting(saved)], "receipt.zip"));
  expect(JSON.stringify(restored.meeting)).not.toContain(key);
});

test("an explicitly confirmed correction can replace a locally unrepresentable saved final", async () => {
  const { meeting, plan, signal } = await setup();
  const invalid = final(meeting.segments[0].id);
  const json = JSON.parse(invalid.content[0].text);
  json.items[0].due_original = "x".repeat(201);
  invalid.content[0].text = JSON.stringify(json);
  const request = vi.fn().mockResolvedValueOnce(agentSse([call()]))
    .mockResolvedValueOnce(agentSse([invalid]))
    .mockResolvedValueOnce(agentSse([final(meeting.segments[0].id)]));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  const saved = (await getMeeting(meeting.id))!;
  expect(request).toHaveBeenCalledTimes(2);
  const corrected = await runAgentMemo(saved, saved.memoAgents![0], key, signal);
  expect(request).toHaveBeenCalledTimes(3);
  expect(corrected.jobs.slice(0, 2)).toEqual(saved.jobs);
  expect(corrected.memoAgents![0].state).toBe("completed");
});

test("a credential in a range stays out of provider tool results and cannot authorize its citation", async () => {
  const setupValue = await setup();
  const source = { ...setupValue.meeting.segments[0], text: "Echo " + key };
  const meeting = await saveMeeting({ ...setupValue.meeting, segments: [source] });
  const plan = planAgentMemo(meeting, selection, "en");
  let sentOutput = "";
  const request = vi.fn(async (_url, init) => {
    const output = JSON.parse(init.body).input.find((part: { type: string }) => part.type === "function_call_output");
    if (!output) return agentSse([call({ startIndex: 0 })]);
    sentOutput = output.output;
    return agentSse([final(source.id)]);
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, setupValue.signal)).rejects.toThrow("did not read");
  expect(request).toHaveBeenCalledTimes(2);
  expect(sentOutput).not.toContain(key);
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.memoAgents![0].consulted).toEqual([]);
  expect(saved.segments[0].text).toBe(source.text);
});

test.each(["no items", "unfinished item"])("a terminal response containing paid output missing from the SDK record is available for export (%s)", async mode => {
  const { meeting, plan, signal } = await setup();
  const output = final(meeting.segments[0].id);
  const terminal = { type: "response.completed", response: { id: "terminal-only", status: "completed", output: [output] } };
  const added = { type: "response.output_item.added", output_index: 0, item: { ...output, content: [] } };
  const prefix = mode === "unfinished item" ? "event: response.output_item.added\ndata: " + JSON.stringify(added) + "\n\n" : "";
  const request = vi.fn().mockResolvedValue(new Response(
    prefix + "event: response.completed\ndata: " + JSON.stringify(terminal) + "\n\n",
    { headers: { "content-type": "text/event-stream" } },
  ));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  expect(exportedReceipt(meeting.id)).toMatchObject({
    version: 1, wireResponse: expect.stringContaining("Synthetic evidence for human review."),
  });
  expect((await getMeeting(meeting.id))!.memos).toEqual(meeting.memos);
});

test.each([6, null])("confirmed continuation upgrades legacy limit %s when recovering a final without another POST", async requestLimit => {
  const { meeting, plan, signal } = await setup();
  const request = vi.fn().mockResolvedValueOnce(agentSse([call()]))
    .mockResolvedValueOnce(agentSse([final(meeting.segments[0].id)]));
  vi.stubGlobal("fetch", request);
  const finished = await runAgentMemo(meeting, plan, key, signal);
  const paused = await saveMeeting({ ...finished, memos: [], memoAgents: [{
    ...finished.memoAgents![0], state: "paused", memoId: null, requestLimit: requestLimit as 6 | null,
  }] });
  const recovered = await runAgentMemo(paused, paused.memoAgents![0], key, signal);
  expect(recovered.jobs).toEqual(paused.jobs);
  expect(request).toHaveBeenCalledTimes(2);
  expect(recovered.memoAgents![0].requestLimit).toBe(100);
});

test("an expired per-request deadline stops the current attempt and requires billing review", async () => {
  const { meeting, plan, signal } = await setup();
  const deadlines: AbortController[] = [];
  let transportTimedOut = false;
  vi.spyOn(AbortSignal, "timeout").mockImplementation(delay => {
    expect(delay).toBe(9 * 60 * 1000);
    const deadline = new AbortController();
    deadlines.push(deadline);
    return deadline.signal;
  });
  const request = vi.fn(async (_url, init) => {
    if (deadlines.length === 1) return agentSse([call()]);
    deadlines[1].abort(new DOMException("Synthetic deadline", "TimeoutError"));
    transportTimedOut = init.signal.aborted;
    init.signal.throwIfAborted();
    throw new Error("The timeout was not propagated");
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(deadlines).toHaveLength(2);
  expect(transportTimedOut).toBe(true);
  expect(deadlines[0].signal.aborted).toBe(false);
  const saved = (await getMeeting(meeting.id))!;
  expect(saved.jobs.map(job => job.state)).toEqual(["completed", "outcome_unknown"]);
  await expect(runAgentMemo(saved, saved.memoAgents![0], key, signal)).rejects.toThrow("previous paid outcome");
  expect(request).toHaveBeenCalledTimes(2);
});

test.each(["memo slots", "response reserve"])("durable intent checks the latest %s before sending", async capacity => {
  const { meeting, plan, signal } = await setup();
  const save = repository.saveMeeting;
  let runningCheckpoints = 0;
  vi.spyOn(repository, "saveMeeting").mockImplementation(async value => {
    const saved = await save(value);
    if (saved.memoAgents?.[0].state === "running" && !saved.jobs.length && ++runningCheckpoints === 1) {
      // A concurrent local save wins after the running plan is saved and before request intent.
      if (capacity === "response reserve") {
        const text = "x".repeat(20000);
        const history = Array.from({ length: 1200 }, () => ({
          ...meeting.segments[0], id: crypto.randomUUID(), text, originalText: text,
        }));
        await save({ ...saved, history });
      } else {
        const memos = Array.from({ length: 30 }, () => ({
          id: crypto.randomUUID(), createdAt: saved.createdAt, sourceRevision: saved.revision,
          model: "synthetic", items: [],
        }));
        await save({ ...saved, memos });
      }
    }
    return saved;
  });
  const request = vi.fn().mockResolvedValueOnce(agentSse([final(meeting.segments[0].id)]));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  const saved = (await getMeeting(meeting.id))!;
  expect(capacity === "response reserve" ? saved.history.length : saved.memos.length)
    .toBe(capacity === "response reserve" ? 1200 : 30);
  expect(saved.jobs).toHaveLength(0);
  expect(saved.memoAgents![0].jobIds).toHaveLength(0);
});

function interruptedResponse(wire: string, contentType: string, abort?: AbortController) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(wire);
      const splitAt = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.subarray(0, splitAt));
      controller.enqueue(bytes.subarray(splitAt));
    },
    pull(controller) {
      if (abort) {
        abort.abort();
        controller.close();
      } else {
        controller.error(new Error("Synthetic reader disconnect"));
      }
    },
  });
  return new Response(body, { headers: { "content-type": contentType } });
}

test.each(["Responses", "Chat", "text/plain", "abort"] as const)(
  "interrupted %s body saves one uncertain receipt and offers no export", async mode => {
    const { meeting, plan, signal } = await setup();
    const controller = mode === "abort" ? new AbortController() : undefined;
    const selectedPlan = mode === "Chat" ? planAgentMemo(meeting, routerSelection, "en") : plan;
    const marker = "Synthetic paid text before interruption";
    const head = marker + " " + key.slice(0, 11);
    const tail = key.slice(11);
    const chatFrame = (summary: string) => 'data: ' + JSON.stringify({
      choices: [{ delta: { reasoning_details: [{ summary, type: "reasoning.summary", index: 4 }] }, index: 2 }],
    }) + "\n\n";
    const responsesFrame = (delta: string, vendor_text: string) => 'data: ' + JSON.stringify({
      type: "response.reasoning_text.delta", delta, vendor_text, item_id: "synthetic-item", output_index: 0,
    }) + "\n\n";
    const wire = mode === "Chat" ? chatFrame(head) + chatFrame(tail)
      : mode === "text/plain" ? "# Memo\n" + head + "\ndata: 42\n" + tail
      : responsesFrame(head, key.slice(0, 11)) + responsesFrame(tail, tail);
    const request = vi.fn(async (_url, init) => {
      expect(init.method).toBe("POST");
      expect((await getMeeting(meeting.id))!.jobs.at(-1)?.state).toBe("in_flight");
      return interruptedResponse(wire, mode === "text/plain" ? mode : "text/event-stream", controller);
    });
    vi.stubGlobal("fetch", request);
    await expect(runAgentMemo(meeting, selectedPlan, key, controller?.signal ?? signal)).rejects.toThrow();

    const saved = (await getMeeting(meeting.id))!;
    expect(saved.jobs).toHaveLength(1);
    expect(saved.jobs[0]).toMatchObject({ state: "outcome_unknown", billing: "possibly_charged", usage: null });
    expect(readAgentAssistant(saved.jobs[0].assistantRecord!).content).toEqual([]);
    expect(saved.memoAgents![0].state).toBe(mode === "abort" ? "paused" : "blocked");
    expect(saved.memoAgents![0].jobIds).toEqual([saved.jobs[0].id]);
    expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain(marker);
    await expect(runAgentMemo(saved, saved.memoAgents![0], key, signal)).rejects.toThrow("previous paid outcome");
    expect(request).toHaveBeenCalledTimes(1);
  },
);

test("an interrupted receipt can be saved locally after a transient write failure", async () => {
  const { meeting, plan, signal } = await setup();
  const original = repository.saveMeeting;
  let rejected = false;
  vi.spyOn(repository, "saveMeeting").mockImplementation(async value => {
    if (!rejected && value.jobs.some(job => job.state === "outcome_unknown")) {
      rejected = true;
      throw new DOMException("Synthetic quota failure", "QuotaExceededError");
    }
    return original(value);
  });
  const marker = "Synthetic text lost on disconnect";
  const request = vi.fn(() => interruptedResponse("data: " + marker, "text/event-stream"));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("quota");
  expect(pendingAgentReceipt(meeting.id)?.job.state).toBe("outcome_unknown");
  expect(JSON.stringify(pendingAgentReceipt(meeting.id))).not.toContain(marker);
  const saved = await recoverAgentReceipt(meeting.id);
  expect(saved.jobs[0].state).toBe("outcome_unknown");
  expect(pendingAgentReceipt(meeting.id)).toBeUndefined();
  await expect(runAgentMemo(saved, saved.memoAgents![0], key, signal)).rejects.toThrow("previous paid outcome");
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([1, 100])("an interrupted attempt %i remains counted after repeated save failures, receipt export and release", async attempt => {
  const { meeting, plan, signal } = await setup();
  const priorJobs: Job[] = Array.from({ length: attempt - 1 }, (_, stepIndex) => ({
    id: crypto.randomUUID(), agentId: plan.id, stage: "memo", stepIndex,
    state: "outcome_unknown", billing: "possibly_charged", requestId: null,
    createdAt: meeting.createdAt, updatedAt: meeting.updatedAt, inputRevision: meeting.revision,
    ...selection, outputLanguage: plan.outputLanguage, message: "Synthetic prior attempt",
  }));
  const savedPlan = { ...plan, jobIds: priorJobs.map(job => job.id) };
  const initial = await saveMeeting({ ...meeting, schemaVersion: 2, jobs: priorJobs, memoAgents: [savedPlan] });
  const put = IDBObjectStore.prototype.put;
  const failedWrite = vi.fn(() => { throw new DOMException("Synthetic quota failure", "QuotaExceededError"); });
  const putSpy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === "meetings") {
      const { jobs } = value as Meeting;
      if (jobs.length === attempt && jobs.at(-1)?.state === "outcome_unknown") failedWrite();
    }
    return put.call(this, value, key);
  });
  const marker = "Synthetic text lost on disconnect";
  const request = vi.fn(async (_url, init) => {
    expect(init.method).toBe("POST");
    expect((await getMeeting(meeting.id))!.jobs.at(-1)?.state).toBe("in_flight");
    return interruptedResponse("data: " + marker, "text/event-stream");
  });
  vi.stubGlobal("fetch", request);

  await expect(runAgentMemo(initial, initial.memoAgents![0], key, signal, attempt > 1)).rejects.toThrow("quota");
  await expect(recoverAgentReceipt(meeting.id)).rejects.toThrow("quota");
  await expect(recoverAgentReceipt(meeting.id)).rejects.toThrow("quota");
  expect(failedWrite).toHaveBeenCalledTimes(3);
  expect(pendingAgentMeetingId()).toBe(meeting.id);
  expect(hasPendingAgentReceipt()).toBe(true);
  const before = (await getMeeting(meeting.id))!;
  const durableJob = before.jobs.at(-1)!;
  expect(durableJob.state).toBe("in_flight");
  expect(before.memoAgents![0].jobIds).toEqual([...savedPlan.jobIds, durableJob.id]);
  await expect(runAgentMemo(before, before.memoAgents![0], key, signal, true)).rejects.toThrow("unsaved review response");

  const receipt = exportedReceipt(meeting.id);
  expect(receipt).toMatchObject({
    format: "meeting-memo-agent-receipt", version: 1, meetingId: meeting.id, agentId: plan.id,
    job: { id: durableJob.id, ...selection, stepIndex: attempt - 1, state: "outcome_unknown", billing: "possibly_charged", usage: null },
  });
  expect(receipt).not.toHaveProperty("wireResponse");
  expect(receipt.job).not.toHaveProperty("assistantRecord");
  expect(receipt.job).not.toHaveProperty("memoResponse");
  expect(JSON.stringify(receipt)).not.toContain(marker);
  expect(hasPendingAgentReceipt()).toBe(true);
  acknowledgeAgentExport(meeting.id);
  expect(pendingAgentMeetingId()).toBeUndefined();
  expect(hasPendingAgentReceipt()).toBe(false);
  await expect(repository.flushWrites()).resolves.toBeUndefined();
  const after = (await getMeeting(meeting.id))!;
  expect(after).toEqual(before);
  await expect(runAgentMemo(after, after.memoAgents![0], key, signal, true)).rejects.toThrow("unfinished request");

  putSpy.mockRestore();
  const restored = await readBackup(new File([await backupMeeting(after)], "interrupted-review.zip"));
  const copy = await saveMeeting(restored.meeting);
  expect(copy.memoAgents![0].jobIds).toEqual(before.memoAgents![0].jobIds);
  expect(copy.jobs.at(-1)).toMatchObject({ id: durableJob.id, state: "outcome_unknown" });
  await expect(runAgentMemo(copy, copy.memoAgents![0], key, signal)).rejects.toThrow("previous paid outcome");
  if (attempt === 100)
    await expect(runAgentMemo(copy, copy.memoAgents![0], key, signal, true)).rejects.toThrow("100-request limit");
  expect(request).toHaveBeenCalledTimes(1);
});

test("clean EOF preserves a bracket-led Markdown data frame after a memo rejected by record validation", async () => {
  const { meeting, plan, signal } = await setup();
  const escaped = "\\u0073" + key.slice(1);
  const output = final(meeting.segments[0].id);
  const responseBody = await agentSse([output], "R".repeat(1001)).text();
  const wire = responseBody + "data: [read the decision](https://example.invalid/notes) " + escaped +
    "\r\n\r\n: preserve this comment " + key + "\r\n";
  const request = vi.fn(() => new Response(wire, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("responseId");
  expect(exportedReceipt(meeting.id)).toEqual({
    format: "meeting-memo-agent-receipt", version: 1, meetingId: meeting.id, agentId: plan.id,
    job: expect.objectContaining({ state: "outcome_unknown" }),
    wireResponse: wire.replace(escaped, redaction).replace(key, redaction),
  });
  expect((await getMeeting(meeting.id))!.jobs[0].state).toBe("outcome_unknown");
  expect(request).toHaveBeenCalledTimes(1);
});

test("clean EOF preserves a text/plain body containing a literal data line", async () => {
  const { meeting, plan, signal } = await setup();
  const escaped = "\\u0073" + key.slice(1);
  const wire = "\ufeff# Meeting notes 📓\r\nKeep these details.\r\ndata: 42\r\n<strong>Conclusion</strong> " +
    key + ' and "' + escaped + '"\r\n';
  const request = vi.fn(async () => {
    const bytes = new TextEncoder().encode(wire);
    const split = bytes.indexOf(0xf0) + 2;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    }), { headers: { "content-type": "text/plain" } });
  });
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow();
  expect(exportedReceipt(meeting.id)).toMatchObject({
    version: 1, wireResponse: wire.replace(key, redaction).replace(escaped, redaction),
  });
  expect((await getMeeting(meeting.id))!.jobs[0].state).toBe("outcome_unknown");
  expect(request).toHaveBeenCalledTimes(1);
});

test("clean EOF leaves independent credential fragments and malformed SSE intact in the raw export", async () => {
  const { meeting, plan, signal } = await setup();
  const frame = (type: string, data: object) => `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
  const wire = frame("response.created", { type: "response.created", response: { id: "R".repeat(1001) } }) +
    frame("response.output_text.delta", { item_id: "first", output_index: 0, delta: "before " + key.slice(0, 11) }) +
    frame("response.output_text.delta", { delta: key.slice(11) + " after", item_id: "second", output_index: 0 }) +
    'event: response.completed\r\ndata: {"type":\r\n\r\n';
  const request = vi.fn(() => new Response(wire, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(meeting, plan, key, signal)).rejects.toThrow("responseId");
  expect(exportedReceipt(meeting.id)).toMatchObject({ version: 1, wireResponse: wire });
  expect(request).toHaveBeenCalledTimes(1);
});

test("clean EOF with dense tracked Chat indexes saves its receipt under 128 MiB", () => {
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    import "fake-indexeddb/auto";
    registerHooks({ resolve(specifier, context, next) {
      if (/^\\.\\.?\\//.test(specifier) && context.parentURL?.includes("/src/") && !/\\.\\w+$/.test(specifier)) {
        return next(specifier + ".ts", context);
      }
      return next(specifier, context);
    } });
    globalThis.window = new EventTarget();
    globalThis.BroadcastChannel = undefined;
    const base = ${JSON.stringify(new URL("../src/", import.meta.url).href)};
    const { sampleMeeting } = await import(base + "domain/model.ts");
    const { getMeeting, saveMeeting } = await import(base + "storage/repository.ts");
    const { planAgentMemo } = await import(base + "providers/memo-agent-plan.ts");
    const { runAgentMemo } = await import(base + "jobs/memo-agent.ts");
    const { pendingAgentReceipt, receiptExport } = await import(base + "jobs/agent-recovery.ts");

    const meeting = await saveMeeting(sampleMeeting());
    const selection = { provider: "openrouter", model: "openai/gpt-6-luna" };
    const plan = planAgentMemo(meeting, selection, "en");
    const marker = "Synthetic paid result.";
    const prefix = 'data: {"id":"' + "R".repeat(1001) + '","model":"' + selection.model +
      '","provider":"OpenAI","choices":[{';
    const indexes = '"index":0,'.repeat(419313);
    const suffix = '"index":0,"delta":{"content":"' + marker + '"},"finish_reason":"stop"}]}\\n\\ndata: [DONE]\\n\\n';
    const limit = 4194304;
    const padding = " ".repeat(limit - prefix.length - indexes.length - suffix.length);
    const wire = prefix + indexes + padding + suffix;
    assert.equal(Buffer.byteLength(wire), limit);

    let posts = 0;
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.method, "POST");
      assert.equal(++posts, 1);
      assert.equal((await getMeeting(meeting.id)).jobs[0].state, "in_flight");
      return new Response(wire, { headers: { "content-type": "text/event-stream" } });
    };
    await assert.rejects(runAgentMemo(meeting, plan, ${JSON.stringify(key)}, new AbortController().signal), /responseId/);
    const saved = await getMeeting(meeting.id);
    assert.equal(posts, 1);
    assert.equal(saved.jobs.length, 1);
    assert.equal(saved.jobs[0].state, "outcome_unknown");
    assert.equal(saved.memoAgents[0].jobIds[0], saved.jobs[0].id);
    const exported = receiptExport(pendingAgentReceipt(meeting.id));
    assert.equal(exported.version, 1);
    assert.ok(exported.wireResponse === wire, "Did not preserve the complete Chat body");
  `;
  const result = spawnSync(process.execPath, [
    "--max-old-space-size=128", "--experimental-transform-types", "--input-type=module", "--eval", script,
  ], { encoding: "utf8", timeout: 15_000 });
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
}, 20_000);

test("Pi masks split finished output in the assistant record, memo and restored backup", async () => {
  const { meeting, plan, signal } = await setup();
  const output = final(meeting.segments[0].id);
  const original = output.content[0].text;
  const [before, after] = original.split("Synthetic evidence for human review.");
  output.content = [
    { type: "output_text", text: before + "Before " + key.slice(0, 11) },
    { type: "output_text", text: key.slice(11) + " after." + after },
  ];
  const request = vi.fn().mockResolvedValueOnce(agentSse([call()])).mockResolvedValueOnce(agentSse([output]));
  vi.stubGlobal("fetch", request);
  const completed = await runAgentMemo(meeting, plan, key, signal);
  const restored = await readBackup(new File([await backupMeeting(completed)], "agent.zip"));
  const expected = "Before [redacted provider key] after.";
  for (const value of [completed, restored.meeting]) {
    expect(value.jobs.at(-1)!.assistantRecord).not.toContain(key);
    expect(value.memos[0].originalItems![0].text).toBe(expected);
    expect(value.memos[0].items[0].text).toBe(expected);
  }
  expect(request).toHaveBeenCalledTimes(2);
});

test.each([6, null, "mismatch"] as const)("continuation verifies checkpointed search evidence (%s)", async mode => {
  const { meeting: base, signal } = await setup();
  const segments = Array.from({ length: 120 }, (_, index) => ({
    ...base.segments[0], id: crypto.randomUUID(), text: "界".repeat(160) + "a".repeat(index < 11 ? 20 : 19),
  }));
  const meeting = { ...base, segments };
  const plan = planAgentMemo(meeting, selection, "en");
  const jobId = crypto.randomUUID();
  const callId = "legacy-search";
  const args = { query: "a", limit: 20 };
  const assistantRecord = JSON.stringify({
    role: "assistant", api: "openai-responses", provider: "openai", model: selection.model,
    content: [{ type: "toolCall", id: callId, name: "search_transcript", arguments: args }],
    timestamp: 1, stopReason: "toolUse", usage: {input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0},
  });
  const matches = segments.slice(0, 14).map((s, index) => ({ index, id: s.id, revision: s.revision, excerpt: s.text }));
  const text = JSON.stringify({ matches, nextIndex: 14, scanned: 14 });
  expect(new TextEncoder().encode(text).length).toBe(8190);
  const savedResult = { kind: "tool" as const, callId, name: "search_transcript",
    text: mode === "mismatch" ? text.replace("界", "x") : text, isError: false, timestamp: 123 };
  plan.jobIds = [jobId];
  plan.context = [{ kind: "assistant", jobId }, savedResult];
  plan.requestLimit = mode === "mismatch" ? 6 : mode;
  plan.state = "paused";
  const paused = await saveMeeting({ ...meeting, memoAgents: [plan], jobs: [{
    id: jobId, agentId: plan.id, stage: "memo", state: "completed", stepIndex: 0, outputLanguage: plan.outputLanguage,
    billing: "possibly_charged", provider: "openai", model: selection.model, inputRevision: meeting.revision,
    requestId: null, createdAt: meeting.createdAt, updatedAt: meeting.updatedAt, message: "Recorded search", assistantRecord,
  }] });
  const request = vi.fn(async (_url: unknown, _init: RequestInit) => new Response("", { status: 503 }));
  vi.stubGlobal("fetch", request);
  await expect(runAgentMemo(paused, paused.memoAgents![0], key, signal)).rejects.toThrow();
  const saved = (await getMeeting(meeting.id))!;
  if (mode === "mismatch") {
    expect(request).not.toHaveBeenCalled();
    expect(saved).toEqual(paused);
  } else {
    expect(request).toHaveBeenCalledTimes(1);
    expect(saved.memoAgents![0].context[1]).toEqual(savedResult);
    const sent = JSON.parse(String(request.mock.calls[0][1].body));
    expect(sent.input).toContainEqual(expect.objectContaining({ type: "function_call_output", output: savedResult.text }));
    // Upgraded plans still need to verify old search receipts on the next reload.
    await expect(runAgentMemo(saved, saved.memoAgents![0], key, signal, true)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
    expect((await getMeeting(meeting.id))!.memoAgents![0].context[1]).toEqual(savedResult);
  }
});
