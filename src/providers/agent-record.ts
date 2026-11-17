import { z } from "zod";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  MEMO_AGENT_RECORD_BYTES,
  MEMO_AGENT_MAX_CALL_ID_LENGTH,
  MEMO_AGENT_MAX_TOOL_NAME_LENGTH,
  redactAgentSecret,
} from "../domain/memo-agent-contract";
import type { Job } from "../domain/model";
import { AGENT_ROUTE_PROFILES, agentRouteProfile, type AgentRoute } from "../domain/memo-agent-route";

type JsonObject = Extract<
  AssistantMessage["content"][number],
  { type: "toolCall" }
>["arguments"];
function jsonObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 10000 || current.depth > 16) return false;
    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    )
      continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (typeof current.value !== "object") return false;
    for (const item of Object.values(current.value))
      pending.push({ value: item, depth: current.depth + 1 });
  }
  return true;
}
const boundedText = z.string().max(MEMO_AGENT_RECORD_BYTES);
const count = z.number().int().nonnegative();
const RecordSchema = z
  .object({
    role: z.literal("assistant"),
    api: z.enum(["openai-responses", "openai-completions"]),
    provider: z.enum(["openai", "openrouter"]),
    model: z.string().min(1).max(100),
    responseId: z.string().max(1000).optional(),
    responseModel: z.string().max(200).optional(),
    timestamp: count,
    content: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("text"),
              text: boundedText,
              textSignature: boundedText.optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("thinking"),
              thinking: boundedText,
              thinkingSignature: boundedText.optional(),
              redacted: z.boolean().optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("toolCall"),
              id: z.string().min(1).max(MEMO_AGENT_MAX_CALL_ID_LENGTH),
              name: z.string().min(1).max(MEMO_AGENT_MAX_TOOL_NAME_LENGTH),
              arguments: z.custom<JsonObject>(jsonObject),
              thoughtSignature: boundedText.optional(),
              namespace: z.string().max(100).optional(),
              argumentsError: boundedText.optional(),
            })
            .strict(),
        ]),
      )
      .max(256),
    usage: z
      .object({
        input: count,
        output: count,
        cacheRead: count,
        cacheWrite: count,
        totalTokens: count,
        cacheWrite1h: count.optional(),
        reasoning: count.optional(),
      })
      .strict(),
    stopReason: z.enum([
      "pending",
      "stop",
      "length",
      "toolUse",
      "error",
      "aborted",
      "deferred",
    ]),
    errorMessage: boundedText.optional(),
  })
  .strict();

/** Preserve decoded content/signatures and tokens; SDK catalogue prices are not billing evidence. */
export function recordAgentAssistant(
  message: AssistantMessage,
  key: string,
): string {
  const { cost: _catalogueCost, ...usage } = message.usage;
  const record = redactAgentSecret(
    JSON.stringify({
      role: message.role,
      api: message.api,
      provider: message.provider,
      model: message.model,
      responseId: message.responseId,
      responseModel: message.responseModel,
      timestamp: message.timestamp,
      content: message.content,
      usage,
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
    }),
    key,
  );
  if (new TextEncoder().encode(record).byteLength > MEMO_AGENT_RECORD_BYTES)
    throw new Error(
      "The assistant record exceeds the supported local response limit.",
    );
  return record;
}

export function readAgentAssistant(record: string, route?: AgentRoute): AssistantMessage {
  if (new TextEncoder().encode(record).byteLength > MEMO_AGENT_RECORD_BYTES)
    throw new Error("The saved assistant record is too large.");
  const parsed = RecordSchema.parse(JSON.parse(record));
  const profile = agentRouteProfile(parsed);
  if (!profile || AGENT_ROUTE_PROFILES[profile].api !== parsed.api || (route && route.profile !== profile))
    throw new Error("The saved assistant response does not match its Pi model route.");
  // SDK-required placeholders only; never persist or display these as a provider charge.
  return {
    ...parsed,
    usage: {
      ...parsed.usage,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export function agentAssistantText(record: string) {
  return readAgentAssistant(record)
    .content.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** Missing provider usage stays unknown; an SDK's zero-initialized counters are not a report. */
export function readAgentReportedUsage(
  event: unknown,
  provider: "openai" | "openrouter" = "openai",
): Job["usage"] | undefined {
  if (provider === "openrouter") {
    const parsed = z.object({ usage: z.object({
      prompt_tokens: count, completion_tokens: count, total_tokens: count.optional(),
      prompt_tokens_details: z.object({ cached_tokens: count.optional() }).optional(),
    }) }).safeParse(event);
    if (!parsed.success) return undefined;
    const usage = parsed.data.usage;
    return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens ?? null, cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
      cacheWriteTokens: null, seconds: null };
  }
  const parsed = z
    .object({
      type: z.enum([
        "response.completed",
        "response.incomplete",
        "response.failed",
      ]),
      response: z.object({
        usage: z.object({
          input_tokens: count,
          output_tokens: count,
          total_tokens: count.optional(),
          input_tokens_details: z
            .object({ cached_tokens: count.optional() })
            .optional(),
        }),
      }),
    })
    .safeParse(event);
  if (!parsed.success) return undefined;
  const usage = parsed.data.response.usage;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens ?? null,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: null,
    seconds: null,
  };
}
