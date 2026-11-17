import { z } from "zod";

export const MEMO_AGENT_MODEL = "gpt-6-luna";
// Legacy plans retain their old value until the user explicitly continues them.
export const MEMO_AGENT_LEGACY_REQUEST_LIMIT = 6;
// Owner-selected ceiling per persisted plan, including interrupted attempts.
export const MEMO_AGENT_MAX_REQUESTS = 100;
// A per-response burst guard, never a cumulative analysis budget.
export const MEMO_AGENT_MAX_TOOLS_PER_RESPONSE = 32;
export const MEMO_AGENT_NO_PROGRESS_ROUNDS = 3;
export const MEMO_AGENT_MAX_RANGE_SEGMENTS = 40;
export const MEMO_AGENT_MAX_CALL_ID_LENGTH = 1000;
export const MEMO_AGENT_MAX_TOOL_NAME_LENGTH = 100;
export const MEMO_AGENT_TOOL_BYTES = 8 * 1024;
export const MEMO_AGENT_REQUEST_BYTES = 256 * 1024;
export const MEMO_AGENT_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MEMO_AGENT_RECORD_BYTES = 4 * 1024 * 1024;
export const MEMO_AGENT_TOOLS = [
  "search_transcript",
  "read_transcript_range",
] as const;

export const AgentContextItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assistant"), jobId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal("tool"),
      callId: z.string().min(1).max(MEMO_AGENT_MAX_CALL_ID_LENGTH),
      name: z.string().min(1).max(MEMO_AGENT_MAX_TOOL_NAME_LENGTH),
      text: z
        .string()
        .max(MEMO_AGENT_TOOL_BYTES)
        .refine(
          (value) =>
            new TextEncoder().encode(value).byteLength <= MEMO_AGENT_TOOL_BYTES,
        ),
      isError: z.boolean(),
      timestamp: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("user"),
      text: z.string().min(1).max(1000),
      timestamp: z.number().int().nonnegative(),
    })
    .strict(),
]);

export const AgentSearchArguments = z
  .object({
    query: z.string().trim().min(1).max(200),
    startIndex: z.number().int().min(0).max(20000).default(0),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const AgentRangeArguments = z
  .object({
    startIndex: z.number().int().min(0).max(20000),
    count: z.number().int().min(1).max(MEMO_AGENT_MAX_RANGE_SEGMENTS).default(20),
    textOffset: z.number().int().min(0).max(20000).default(0),
  })
  .strict();

export function redactAgentSecret(value: string, key: string): string {
  if (!key) return value;
  const escaped = JSON.stringify(key).slice(1, -1);
  return value
    .replaceAll(escaped, "[redacted provider key]")
    .replaceAll(key, "[redacted provider key]");
}
