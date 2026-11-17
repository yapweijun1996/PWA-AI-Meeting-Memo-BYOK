import { expect, test } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { sampleMeeting, segment } from "../src/domain/model";
import {
  MEMO_AGENT_MAX_CALL_ID_LENGTH,
  MEMO_AGENT_MAX_RANGE_SEGMENTS,
  MEMO_AGENT_MAX_TOOLS_PER_RESPONSE,
  MEMO_AGENT_MAX_TOOL_NAME_LENGTH,
  MEMO_AGENT_RECORD_BYTES,
  MEMO_AGENT_TOOL_BYTES,
} from "../src/domain/memo-agent-contract";
import { agentStorageReserve } from "../src/providers/memo-agent-plan";
import { recordAgentAssistant } from "../src/providers/agent-record";
import { normalizeMemo } from "../src/providers/api";

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

test("next-step reservation covers escaped responses, copied notes, tools and consulted source revisions", () => {
  const meeting = sampleMeeting();
  meeting.segments = Array.from({ length: MEMO_AGENT_MAX_TOOLS_PER_RESPONSE * MEMO_AGENT_MAX_RANGE_SEGMENTS }, (_, index) => ({
    ...segment("Synthetic source."),
    id: `part-0:${index.toString(36)}_`.padEnd(100, "a"),
    revision: Number.MAX_SAFE_INTEGER,
  }));
  const sourceIds = meeting.segments.slice(0, 100).map(source => source.id);
  const text = "\u0000".repeat(1200) + "\\".repeat(1200) + "汉".repeat(5000);
  const output = { items: Array.from({ length: 100 }, () => ({
    type: "summary", text, owner_speaker_id: null, due_date: null, due_original: null,
    source_segment_ids: sourceIds,
  })) };
  const assistant: AssistantMessage = {
    role: "assistant", api: "openai-responses", provider: "openai", model: "gpt-6-luna", timestamp: 1,
    content: [{ type: "text", text: JSON.stringify(output) }], stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const record = recordAgentAssistant(assistant, "");
  expect(bytes(record)).toBeGreaterThan(3 * 1024 * 1024);
  expect(bytes(record)).toBeLessThanOrEqual(MEMO_AGENT_RECORD_BYTES);
  const items = normalizeMemo(output, meeting);
  const context = Array.from({ length: MEMO_AGENT_MAX_TOOLS_PER_RESPONSE }, () => ({
    kind: "tool" as const, callId: "\u0000".repeat(MEMO_AGENT_MAX_CALL_ID_LENGTH),
    name: "\u0000".repeat(MEMO_AGENT_MAX_TOOL_NAME_LENGTH),
    text: "\u0000".repeat(MEMO_AGENT_TOOL_BYTES), isError: false, timestamp: 1,
  }));
  const consulted = meeting.segments.map(({ id, revision }) => ({ id, revision }));
  for (const used of [0, 16, MEMO_AGENT_MAX_TOOLS_PER_RESPONSE]) {
    const before = { jobs: [], memos: [], memoAgents: [{ context: context.slice(0, used), consulted: consulted.slice(0, used * MEMO_AGENT_MAX_RANGE_SEGMENTS) }] };
    const after = { jobs: [{ assistantRecord: record }], memos: [{ items, originalItems: items }], memoAgents: [{ context, consulted }] };
    const growth = bytes(JSON.stringify(after)) - bytes(JSON.stringify(before));
    expect(growth + 64 * 1024).toBeLessThanOrEqual(agentStorageReserve());
  }
});
