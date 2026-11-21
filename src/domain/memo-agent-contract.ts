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

export const AGENT_SECRET_REDACTION = "[redacted provider key]";
const jsonEscapes = /\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g;

type Span = { start: number; end: number };

export function decodeAgentJsonEscapes(text: string): string {
  return text.replace(jsonEscapes, escape => JSON.parse('"' + escape + '"') as string);
}

/** Map increasing decoded UTF-16 offsets to offsets before one layer of unescaping. */
export function agentJsonOffsets(text: string) {
  const escapes = text.matchAll(jsonEscapes);
  let next = escapes.next();
  let extra = 0;
  return (offset: number) => {
    while (!next.done && next.value.index - extra < offset) {
      extra += next.value[0].length - 1;
      next = escapes.next();
    }
    return offset + extra;
  };
}

/** Match overlapping occurrences in linear time, then map decoded matches back to source offsets. */
export function agentSecretMatcher(key: string) {
  if (!key) return () => [] as Span[];
  const prefix = new Uint32Array(key.length);
  for (let index = 1, length = 0; index < key.length; index++) {
    while (length && key[index] !== key[length]) length = prefix[length - 1];
    if (key[index] === key[length]) length++;
    prefix[index] = length;
  }

  return function credentialSpans(text: string, layers = 2): Span[] {
    const matches: Span[] = [];
    for (let index = 0, length = 0; index < text.length; index++) {
      while (length && text[index] !== key[length]) length = prefix[length - 1];
      if (text[index] === key[length]) length++;
      if (length !== key.length) continue;
      appendSpan(matches, { start: index + 1 - length, end: index + 1 });
      length = prefix[length - 1];
    }
    if (!layers || !text.includes("\\")) return matches;

    const decoded = decodeAgentJsonEscapes(text);
    if (decoded === text) return matches;
    const inner = credentialSpans(decoded, layers - 1);
    if (!inner.length) return matches;

    const rawOffset = agentJsonOffsets(text);
    const mapped = inner.map(span => ({ start: rawOffset(span.start), end: rawOffset(span.end) }));
    const merged: Span[] = [];
    let left = 0, right = 0;
    while (left < matches.length || right < mapped.length) {
      const span = right === mapped.length || (left < matches.length && matches[left].start <= mapped[right].start)
        ? matches[left++] : mapped[right++];
      appendSpan(merged, span);
    }
    return merged;
  };
}

function appendSpan(matches: Span[], span: Span) {
  const previous = matches.at(-1);
  if (previous && span.start < previous.end) previous.end = Math.max(previous.end, span.end);
  else matches.push(span);
}

export function redactAgentSecret(value: string, key: string): string {
  if (!key) return value;
  // The JSON HTTP body or SSE data field can enclose another serialized memo or tool argument.
  const spans = agentSecretMatcher(key)(value);
  if (!spans.length) return value;
  const parts: string[] = [];
  let start = 0;
  for (const span of spans) {
    parts.push(value.slice(start, span.start), AGENT_SECRET_REDACTION);
    start = span.end;
  }
  return parts.join("") + value.slice(start);
}
