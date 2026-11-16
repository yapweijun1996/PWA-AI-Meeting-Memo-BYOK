import { z } from "zod";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  MEMO_AGENT_MODEL,
  MEMO_AGENT_RECORD_BYTES,
  redactAgentSecret,
} from "../domain/memo-agent-contract";
import type { Job } from "../domain/model";

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
    api: z.literal("openai-responses"),
    provider: z.literal("openai"),
    model: z.literal(MEMO_AGENT_MODEL),
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
              id: z.string().min(1).max(1000),
              name: z.string().min(1).max(100),
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

export function readAgentAssistant(record: string): AssistantMessage {
  if (new TextEncoder().encode(record).byteLength > MEMO_AGENT_RECORD_BYTES)
    throw new Error("The saved assistant record is too large.");
  const parsed = RecordSchema.parse(JSON.parse(record));
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
): Job["usage"] | undefined {
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
