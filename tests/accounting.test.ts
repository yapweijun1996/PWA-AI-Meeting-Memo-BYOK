import { afterEach, expect, it, vi } from "vitest";
import { generateMemo, transcribe } from "../src/providers/api";
import { JobSchema, sampleMeeting } from "../src/domain/model";
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
  expect(callback).toHaveBeenCalledWith({ usage: { inputTokens: 0, outputTokens: null, seconds: 2, cachedInputTokens: null, totalTokens: null }, requestId: null, cost: 0 });
});

it("captures memo usage independently of malformed output and never treats OpenAI cost as reported", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    status: "incomplete", usage: { input_tokens: 12, output_tokens: "bad", cost: 5 }, output: [],
  }), { status: 200 })));
  const callback = vi.fn();
  await expect(generateMemo(sampleMeeting(), "test", new AbortController().signal, callback,
    { provider: "openai", model: "gpt-6-luna" })).rejects.toThrow();
  expect(callback).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: null, seconds: null, cachedInputTokens: null, totalTokens: null }, null, null);
});
