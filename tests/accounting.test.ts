import { afterEach, expect, it, vi } from "vitest";
import { generateMemo, transcribe } from "../src/providers/api";
import { JobSchema, sampleMeeting } from "../src/domain/model";
import { summarizeMeetingAccounting } from "../src/domain/accounting";
import { calculateSpeechEstimate } from "../src/providers/credentials";
import type { SettingsRecord } from "../src/storage/settings";

afterEach(() => vi.unstubAllGlobals());

it("requires a dated, model-bound rate and known duration for an estimate", () => {
  const settings: SettingsRecord = { version: 1, revision: 0, keys: { openai: "", openrouter: "" }, speech: { provider: "openrouter", model: "scribe" }, memo: { provider: "openai", model: "notes" }, speechRate: 0.2, speechRateContext: { provider: "openrouter", model: "scribe", date: "2026-11-05", source: "https://example.com/pricing" } };
  expect(calculateSpeechEstimate(settings, 90)?.amount).toBeCloseTo(0.3);
  expect(calculateSpeechEstimate(settings, null)).toBeNull();
  expect(calculateSpeechEstimate({ ...settings, speech: { provider: "openai", model: "other" } }, 90)).toBeNull();
  expect(calculateSpeechEstimate({ ...settings, speechRateContext: null }, 90)).toBeNull();
  expect(calculateSpeechEstimate({ ...settings, speechRate: 0 }, 0)?.amount).toBe(0);
});

it("keeps old jobs readable and rejects invalid stored cost evidence", () => {
  const old = { id: crypto.randomUUID(), stage: "speech", state: "completed", billing: "unknown", createdAt: "2026-01-01", updatedAt: "2026-01-01", requestId: null, message: "Done", inputRevision: 1 };
  expect(JobSchema.safeParse(old).success).toBe(true);
  expect(JobSchema.safeParse({ ...old, provider: "openrouter", model: "scribe", reportedCostUsd: 0 }).success).toBe(true);
  expect(JobSchema.safeParse({ ...old, reportedCostUsd: -1 }).success).toBe(false);
});

it("captures validated speech accounting even when the transcript is rejected", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    text: "", usage: { input_tokens: 0, output_tokens: -1, seconds: 2, cost: 0 },
  }), { status: 200 })));
  const callback = vi.fn();
  await expect(transcribe(new Blob(["x"]), "test", new AbortController().signal,
    { provider: "openrouter", model: "elevenlabs/scribe-v2" }, "a.wav", callback)).rejects.toThrow();
  expect(callback).toHaveBeenCalledWith({ usage: { inputTokens: 0, outputTokens: null, seconds: 2, cachedInputTokens: null, cacheWriteTokens: null, totalTokens: null }, requestId: null, cost: 0 });
});

it("captures memo usage independently of malformed output and never treats OpenAI cost as reported", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    status: "incomplete", usage: { input_tokens: 12, output_tokens: "bad", cost: 5 }, output: [],
  }), { status: 200 })));
  const callback = vi.fn();
  await expect(generateMemo(sampleMeeting(), "test", new AbortController().signal, callback,
    { provider: "openai", model: "gpt-6-luna" })).rejects.toThrow();
  expect(callback).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: null, seconds: null, cachedInputTokens: null, cacheWriteTokens: null, totalTokens: null }, null, null);
});

it("captures Responses usage cost and cache-write tokens for OpenRouter", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    status: "incomplete",
    id: "resp_123",
    usage: {
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
      input_tokens_details: { cached_tokens: 3, cache_write_tokens: 5 },
      cost: 0.0042,
    },
    output: [],
  }), { status: 200 })));
  const callback = vi.fn();
  await expect(generateMemo(sampleMeeting(), "test", new AbortController().signal, callback,
    { provider: "openrouter", model: "openai/gpt-6-luna" })).rejects.toThrow();
  expect(callback).toHaveBeenCalledWith({
    inputTokens: 12,
    outputTokens: 4,
    seconds: null,
    cachedInputTokens: 3,
    cacheWriteTokens: 5,
    totalTokens: 16,
  }, "resp_123", 0.0042);
});

it("summarizes unique submitted jobs and marks unknown or conflicting totals incomplete", () => {
  const base = {
    id: crypto.randomUUID(),
    stage: "memo" as const,
    state: "completed" as const,
    billing: "provider_reported" as const,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    requestId: "req-1",
    usage: { inputTokens: 10, outputTokens: 2, seconds: null, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 12 },
    estimateUsd: 0.02,
    estimateDetails: { rate: 1, seconds: 1, source: "https://example.com/rate", date: "2026-01-01" as const },
    provider: "openrouter" as const,
    model: "notes",
    reportedCostUsd: 0.01,
    message: "done",
    inputRevision: 1,
  };
  const duplicate = { ...base };
  const unknown = { ...base, id: crypto.randomUUID(), billing: "possibly_charged" as const, reportedCostUsd: null, estimateUsd: null, estimateDetails: null };
  const notSubmitted = { ...base, id: crypto.randomUUID(), billing: "not_submitted" as const, reportedCostUsd: 0.5 };
  const conflicting = { ...base, id: base.id, reportedCostUsd: 0.99 };
  const result = summarizeMeetingAccounting([base, duplicate, unknown, notSubmitted, conflicting]);
  expect(result.reportedUsd).toBeNull();
  expect(result.estimateUsd).toBeNull();
  expect(result.submittedAttempts).toBe(2);
  expect(result.reportedAttempts).toBe(0);
  expect(result.unknownAttempts).toBe(2);
  expect(result.incomplete).toBe(true);
  expect(result.conflictJobIds).toEqual([base.id]);
});
