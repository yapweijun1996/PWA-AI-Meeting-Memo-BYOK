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

const redaction = "[redacted provider key]";
const jsonEscapes = /\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g;

type Span = { start: number; end: number };

/** Inspect JSON escapes even in incomplete strings. Offset mapping preserves all other wire bytes. */
function credentialSpans(text: string, key: string, layers: number): Span[] {
  const matches: Span[] = [];
  for (let at = text.indexOf(key); at !== -1; at = text.indexOf(key, at + key.length))
    matches.push({ start: at, end: at + key.length });
  if (!layers || !text.includes("\\")) return matches;

  const decoded = text.replace(jsonEscapes, escape => JSON.parse('"' + escape + '"') as string);
  if (decoded === text) return matches;
  const inner = credentialSpans(decoded, key, layers - 1);
  if (!inner.length) return matches;

  // Both the match boundaries and the escape offsets are ordered.
  const escapes = text.matchAll(jsonEscapes);
  let next = escapes.next();
  let extra = 0;
  const rawOffset = (offset: number) => {
    while (!next.done && next.value.index - extra < offset) {
      extra += next.value[0].length - 1;
      next = escapes.next();
    }
    return offset + extra;
  };
  for (const span of inner) matches.push({ start: rawOffset(span.start), end: rawOffset(span.end) });
  matches.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of matches) {
    const last = merged.at(-1);
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }
  return merged;
}

export function redactAgentSecret(value: string, key: string): string {
  if (!key) return value;
  if (!value.includes("\\")) return value.replaceAll(key, redaction);
  // The JSON HTTP body or SSE data field can enclose another serialized memo or tool argument.
  const spans = credentialSpans(value, key, 2);
  if (!spans.length) return value;
  const parts: string[] = [];
  let start = 0;
  for (const span of spans) {
    parts.push(value.slice(start, span.start), redaction);
    start = span.end;
  }
  return parts.join("") + value.slice(start);
}
