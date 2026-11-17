import { expect, test } from "vitest";
import {
  sampleMeeting,
  validateMeeting,
  type Meeting,
} from "../src/domain/model";
import {
  agentMeeting,
  planAgentMemo,
  resumableAgentMemo,
} from "../src/providers/memo-agent-plan";
import {
  recordAgentAssistant,
  readAgentAssistant,
  readAgentReportedUsage,
} from "../src/providers/agent-record";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const selection = { provider: "openai" as const, model: "gpt-6-luna" };

test("missing or malformed usage never becomes a zero-token provider report", () => {
  expect(
    readAgentReportedUsage({ type: "response.completed", response: {} }),
  ).toBeUndefined();
  expect(
    readAgentReportedUsage({
      type: "response.completed",
      response: { usage: { input_tokens: -1, output_tokens: 0 } },
    }),
  ).toBeUndefined();
  expect(
    readAgentReportedUsage({
      type: "response.completed",
      response: { usage: { input_tokens: 0, output_tokens: 0 } },
    }),
  ).toMatchObject({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: null,
    cachedInputTokens: null,
  });
});
const planned = () => {
  const meeting = sampleMeeting();
  const plan = planAgentMemo(meeting, selection, "zh-CN");
  return {
    meeting: validateMeeting({
      ...meeting,
      schemaVersion: 2,
      memoAgents: [plan],
    }),
    plan,
  };
};

test("agent plans freeze source references and language without copying transcript text", () => {
  const { meeting, plan } = planned();
  expect(plan.snapshot.sourceRefs).toEqual(
    meeting.segments.map(({ id, revision }) => ({ id, revision })),
  );
  expect(JSON.stringify(plan)).not.toContain(meeting.segments[0].text);
  expect(plan.outputLanguage).toBe("zh-CN");
  expect(plan.requestLimit).toBeNull();
  expect(validateMeeting(agentMeeting(meeting, plan)).segments).toEqual(
    meeting.segments,
  );
});

test("a 20 MB meeting can plan selective review without dropping its saved history", () => {
  const meeting = sampleMeeting();
  meeting.history = Array.from({ length: 500 }, () => ({
    ...meeting.segments[0],
    id: crypto.randomUUID(),
    text: "x".repeat(20000),
    originalText: "x".repeat(20000),
  }));
  const size = new TextEncoder().encode(JSON.stringify(meeting)).byteLength;
  expect(size).toBeGreaterThan(16 * 1024 * 1024);
  const plan = planAgentMemo(meeting, selection, "zh-CN");
  expect(plan.snapshot.sourceRefs).toEqual(meeting.segments.map(({ id, revision }) => ({ id, revision })));
  expect(meeting.history).toHaveLength(500);
  expect(new TextEncoder().encode(JSON.stringify(meeting)).byteLength).toBe(size);
});

test("agent snapshots resolve exact historical revisions and never silently substitute current text", () => {
  const { meeting, plan } = planned();
  const original = meeting.segments[0];
  const edited = {
    ...meeting,
    revision: 2,
    history: [original],
    segments: [
      { ...original, revision: 2, text: "Human correction" },
      ...meeting.segments.slice(1),
    ],
  };
  expect(agentMeeting(validateMeeting(edited), plan).segments[0].text).toBe(
    original.text,
  );
  expect(resumableAgentMemo(edited, selection)).toBeUndefined();
  expect(() => validateMeeting({ ...edited, history: [] })).toThrow("sources");
});

test("agent record validation rejects substituted sources, invented consultation and extra budget", () => {
  const { meeting } = planned();
  for (const change of [
    (value: Meeting) => {
      value.memoAgents![0].snapshot.sourceRefs[0].revision = 999;
    },
    (value: Meeting) => {
      value.memoAgents![0].consulted = [
        { id: crypto.randomUUID(), revision: 1 },
      ];
    },
  ]) {
    const value = structuredClone(meeting);
    change(value);
    expect(() => validateMeeting(value)).toThrow();
  }
  expect(() =>
    validateMeeting({
      ...meeting,
      memoAgents: [{ ...meeting.memoAgents![0], requestLimit: 100 }],
    }),
  ).toThrow("invalid");
  expect(() => validateMeeting({ ...meeting, schemaVersion: 1 })).toThrow(
    "version 2",
  );
});

test("unsupported providers, empty transcripts and exhausted history do not produce a plan", () => {
  const meeting = sampleMeeting();
  expect(() =>
    planAgentMemo(
      meeting,
      { provider: "openrouter", model: "gpt-6-luna" },
      "en",
    ),
  ).toThrow("requires");
  expect(() =>
    planAgentMemo({ ...meeting, segments: [] }, selection, "en"),
  ).toThrow("transcript");
  const { plan } = planned();
  expect(() =>
    planAgentMemo(
      {
        ...meeting,
        memoAgents: Array.from({ length: 30 }, () => structuredClone(plan)),
      },
      selection,
      "en",
    ),
  ).toThrow("history");
});

test("decoded assistant content and reasoning signatures round trip without SDK prices or provider keys", () => {
  const key = "sk-synthetic-agent-response-key";
  const message: AssistantMessage = {
    role: "assistant",
    api: "openai-responses",
    provider: "openai",
    model: "gpt-6-luna",
    timestamp: Date.now(),
    content: [
      {
        type: "thinking",
        thinking: "",
        thinkingSignature: "opaque-synthetic-signature",
      },
      { type: "text", text: `A result with ${key}` },
    ],
    stopReason: "stop",
    usage: {
      input: 100,
      output: 20,
      cacheRead: 10,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 999 },
    },
  };
  const record = recordAgentAssistant(message, key);
  expect(record).not.toContain(key);
  expect(JSON.parse(record).usage).not.toHaveProperty("cost");
  const restored = readAgentAssistant(record);
  expect(restored.content[0]).toEqual(message.content[0]);
  expect(restored.usage.input).toBe(100);
  expect(restored.usage.cost.total).toBe(0);
});

test("saved assistant records cannot switch provider, add system messages or execute nested non-JSON arguments", () => {
  const base = {
    role: "assistant",
    api: "openai-responses",
    provider: "openai",
    model: "gpt-6-luna",
    timestamp: 1,
    content: [],
    stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  };
  expect(() =>
    readAgentAssistant(JSON.stringify({ ...base, role: "system" })),
  ).toThrow();
  expect(() =>
    readAgentAssistant(JSON.stringify({ ...base, provider: "other" })),
  ).toThrow();
  let nested: unknown = {};
  for (let i = 0; i < 20; i++) nested = { child: nested };
  expect(() =>
    readAgentAssistant(
      JSON.stringify({
        ...base,
        content: [
          {
            type: "toolCall",
            id: "x",
            name: "read_transcript_range",
            arguments: nested,
          },
        ],
      }),
    ),
  ).toThrow();
});

test("saved response API and model must match the frozen route", () => {
  const message = { role: "assistant", api: "openai-completions", provider: "openrouter", model: "openai/gpt-6-luna", timestamp: 1, content: [], stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } };
  const plan = planAgentMemo(sampleMeeting(), selection, "en");
  expect(() => readAgentAssistant(JSON.stringify(message), plan.route)).toThrow("does not match");
  expect(() => readAgentAssistant(JSON.stringify({ ...message, api: "openai-responses" }))).toThrow("does not match");
});
