import {
  AGENT_SECRET_REDACTION,
  agentJsonOffsets,
  agentSecretMatcher,
  decodeAgentJsonEscapes,
  redactAgentSecret,
} from "../domain/memo-agent-contract";

type PathPart = string | number;
type StringPart = { start: number; raw: string; text: string };
type Field = StringPart & { path: PathPart[]; complete: boolean };
type Container = { path?: PathPart[]; member: PathPart | undefined };
type Fields = Map<string, Field>;
type MatchSecret = ReturnType<typeof agentSecretMatcher>;
type Spans = ReturnType<MatchSecret>;
type MarkRedaction = (start: number, end: number, head: boolean) => void;
type ResponseGroup = [type: string | undefined, item: string | undefined, output: string | undefined, part: string | null | undefined];
type ResponseTail = { group: ResponseGroup; field: Field };
const MAX_RESPONSE_PATH_DEPTH = 6;
const indexFields = new Set(["output_index", "content_index", "summary_index", "index"]);
const chatDeltaFields = new Set(["content", "reasoning", "reasoning_content", "reasoning_text"]);
const relevantFields = new Set(["type", "text", "delta", "item_id", "arguments", ...indexFields, ...chatDeltaFields]);
const responsePartIndexes = new Map([
  ["response.output_text.delta", "content_index"],
  ["response.refusal.delta", "content_index"],
  ["response.reasoning_text.delta", "content_index"],
  ["response.reasoning_summary_text.delta", "summary_index"],
  ["response.function_call_arguments.delta", null],
]);
const jsonDelimiters = /[\s{}[\],:"]/;

function jsonStringEnd(json: string, start: number, quoteOrEscape: RegExp) {
  quoteOrEscape.lastIndex = start;
  for (let match = quoteOrEscape.exec(json); match; match = quoteOrEscape.exec(json)) {
    if (match[0] === '"') return match.index;
    quoteOrEscape.lastIndex++;
  }
  return json.length;
}

/** Locate response fields even when the last frame or JSON string is incomplete. */
function responseFields(json: string, offset: (index: number) => number, recovery = false) {
  const fields: Field[] = [];
  const stack: Container[] = [];
  const quoteOrEscape = /["\\]/g;
  let skippedDepth = 0;
  let unterminatedString = false;
  for (let cursor = 0; cursor < json.length;) {
    const char = json[cursor++];
    const container = stack.at(-1);
    if (char === "{" || char === "[") {
      if (skippedDepth || stack.length > MAX_RESPONSE_PATH_DEPTH) {
        // The literal matcher still scans this fragment without keeping a container per bracket.
        skippedDepth++;
        continue;
      }
      const path = !container ? [] : container.path && container.member !== undefined
        ? [...container.path, container.member] : undefined;
      stack.push({ path, member: char === "[" ? 0 : undefined });
    } else if (char === "}" || char === "]") {
      if (skippedDepth) skippedDepth--;
      else stack.pop();
    } else if (!skippedDepth && char === "," && container) {
      container.member = typeof container.member === "number" ? container.member + 1 : undefined;
    } else if (char === '"') {
      const start = cursor;
      const end = jsonStringEnd(json, start, quoteOrEscape);
      unterminatedString = end === json.length;
      cursor = end + 1;
      if (skippedDepth || !container?.path) continue;
      if (container.member === undefined) {
        container.member = decodeAgentJsonEscapes(json.slice(start, end));
      } else if (typeof container.member === "string" && (relevantFields.has(container.member) ||
          (recovery && container.path[3] === "reasoning_details" && (container.member === "summary" || container.member === "data")))) {
        const raw = json.slice(start, end);
        fields.push({ path: [...container.path, container.member], start: offset(start), complete: !unterminatedString,
          raw, text: decodeAgentJsonEscapes(raw) });
      }
    } else if (!skippedDepth && !jsonDelimiters.test(char)) {
      const start = cursor - 1;
      while (cursor < json.length && !jsonDelimiters.test(json[cursor])) cursor++;
      if (container?.path && typeof container.member === "string" && indexFields.has(container.member)) {
        const raw = json.slice(start, cursor);
        fields.push({ path: [...container.path, container.member], start: offset(start), complete: cursor < json.length,
          raw, text: String(Number(raw)) });
      }
    }
  }
  return { fields, incomplete: !!(stack.length || skippedDepth || unterminatedString) };
}

function addPart<Key>(parts: Map<Key, Field[]>, key: Key, field: Field) {
  const group = parts.get(key);
  if (group) group.push(field);
  else parts.set(key, [field]);
}

function rememberField<Key>(objects: Map<Key, Fields>, key: Key, name: string, field: Field) {
  let object = objects.get(key);
  if (!object) objects.set(key, object = new Map());
  object.set(name, field);
}

function markPartSpans(parts: Iterable<StringPart>, spans: Spans, mark: MarkRedaction) {
  let offset = 0, spanIndex = 0;
  for (const field of parts) {
    if (spanIndex === spans.length) return;
    const end = offset + field.text.length;
    if (field.text.length && spans[spanIndex].start < end) {
      const rawOffset = agentJsonOffsets(field.raw);
      for (let span = spans[spanIndex]; span && span.start < end; span = spans[spanIndex]) {
        const start = Math.max(0, span.start - offset);
        const length = Math.min(end, span.end) - offset;
        mark(field.start + rawOffset(start), field.start + rawOffset(length), span.start >= offset);
        if (span.end > end) break;
        spanIndex++;
      }
    }
    offset = end;
  }
}

function markParts(parts: Field[], match: MatchSecret, mark: MarkRedaction) {
  if (parts.length < 2) return;
  markPartSpans(parts, match(parts.map(field => field.text).join(""), 1), mark);
}

function redactOutput(fields: Field[], match: MatchSecret, mark: MarkRedaction) {
  const objects = new Map<string, Fields>();
  for (const field of fields) {
    const path = field.path;
    const [root, item, content, part, name] = path;
    if (root === "output" && typeof item === "number" && content === "content" &&
        typeof part === "number" && typeof name === "string" && path.length === 5)
      rememberField(objects, `${item}/${part}`, name, field);
  }
  const output: Field[] = [];
  for (const object of objects.values()) {
    const field = object.get("text");
    if (field && object.get("type")?.text === "output_text") output.push(field);
  }
  markParts(output, match, mark);
}

function wireRedactions(wire: string, key: string) {
  // Candidate groupings share fields. Mark original offsets so one match cannot hide another.
  let marks: Uint8Array | undefined;
  function mark(start: number, end: number, head: boolean) {
    marks ??= new Uint8Array(wire.length);
    const keepHead = head || marks[start] === 2;
    marks.fill(1, start, end);
    if (keepHead) marks[start] = 2;
  }
  function apply() {
    if (!marks) return redactAgentSecret(wire, key);
    const parts: string[] = [];
    let offset = 0;
    for (let index = 0; index < marks.length; index++) {
      if (!marks[index]) continue;
      parts.push(wire.slice(offset, index));
      if (marks[index] === 2) parts.push(AGENT_SECRET_REDACTION);
      while (marks[index + 1] === 1) index++;
      offset = index + 1;
    }
    return redactAgentSecret(parts.join("") + wire.slice(offset), key);
  }
  return { mark, apply };
}

export function redactMemoResponse(body: string, key: string): string {
  if (!key) return body;
  const { fields } = responseFields(body, index => index);
  const { mark, apply } = wireRedactions(body, key);
  redactOutput(fields, agentSecretMatcher(key), mark);
  return apply();
}

function trackFrameDeltas(fields: Field[], event: string, deltas: Map<string, Field[]>, incomplete: boolean) {
  const rootFields = new Map<PathPart, Field>();
  const choiceIndexes = new Map<number, string>();
  const toolIndexes = new Map<string, string>();
  for (const field of fields) {
    const [root, choice, member, leaf, tool, name] = field.path;
    if (field.path.length === 1) rootFields.set(root, field);
    if (root !== "choices" || typeof choice !== "number") continue;
    if (member === "index" && field.path.length === 3) choiceIndexes.set(choice, field.text);
    if (member === "delta" && leaf === "tool_calls" && typeof tool === "number" &&
        name === "index" && field.path.length === 6) toolIndexes.set(`${choice}/${tool}`, field.text);
  }

  const typeField = rootFields.get("type");
  const type = typeField?.complete ? typeField.text : event || undefined;
  const delta = rootFields.get("delta");
  const partIndex = type === undefined ? undefined : responsePartIndexes.get(type);
  let responseGroup: string | undefined;
  if (delta && (partIndex !== undefined || (incomplete && type === undefined))) {
    const identity = (name: string) => {
      const field = rootFields.get(name);
      return field?.complete ? field.text : undefined;
    };
    const item = identity("item_id");
    const output = identity("output_index");
    const part = typeof partIndex === "string" ? identity(partIndex) : partIndex;
    if (incomplete && (type === undefined || item === undefined || output === undefined || part === undefined)) {
      return { group: [type, item, output, part], field: delta } satisfies ResponseTail;
    }
    responseGroup = JSON.stringify([type, item, output ?? "0", part === undefined ? "0" : part]);
  }

  for (const field of fields) {
    const [root, choice, member, leaf, tool, fn, args] = field.path;
    if (field === delta && responseGroup !== undefined) {
      addPart(deltas, responseGroup, field);
      continue;
    }
    if (root !== "choices" || typeof choice !== "number" || member !== "delta") continue;
    const index = choiceIndexes.get(choice) ?? String(choice);
    if (typeof leaf === "string" && chatDeltaFields.has(leaf) && field.path.length === 4) {
      addPart(deltas, JSON.stringify(["chat", index, leaf]), field);
    } else if (leaf === "tool_calls" && typeof tool === "number" && fn === "function" &&
        args === "arguments" && field.path.length === 7) {
      const toolIndex = toolIndexes.get(`${choice}/${tool}`) ?? String(tool);
      addPart(deltas, JSON.stringify(["chat", index, leaf, toolIndex]), field);
    }
  }
}

function trackChatReasoning(fields: Field[], runs: Map<string, Field[]>, match: MatchSecret, mark: MarkRedaction) {
  const choices = new Map<number, string>();
  const entries = new Map<string, Fields>();
  for (const field of fields) {
    const [root, choice, member, leaf, entry, name] = field.path;
    if (root !== "choices" || typeof choice !== "number") continue;
    if (member === "index" && field.path.length === 3) choices.set(choice, field.text);
    if (member === "delta" && leaf === "reasoning_details" && typeof entry === "number" &&
        typeof name === "string" && field.path.length === 6) {
      rememberField(entries, `${choice}/${entry}`, name, field);
    }
  }
  for (const entry of entries.values()) {
    const type = entry.get("type");
    if (!type) continue;
    const choice = type.path[1] as number;
    const index = choices.get(choice) ?? String(choice);
    const value = type.text === "reasoning.summary" ? entry.get("summary") :
      type.text === "reasoning.text" ? entry.get("text") : undefined;
    if (!value && (type.text !== "reasoning.encrypted" || !entry.has("data"))) continue;
    const previous = runs.get(index);
    if (value && previous?.[0].path[5] === value.path[5]) {
      previous.push(value);
    } else {
      if (previous) markParts(previous, match, mark);
      if (value) runs.set(index, [value]);
      else runs.delete(index);
    }
  }
}

function markResponseContinuation(group: Field[], tail: Field, match: MatchSecret, tailPrefix: string, mark: MarkRedaction) {
  const text = group.map(field => field.text).join("");
  const spans = match(text + tailPrefix, 1).filter(span => span.start < text.length && span.end > text.length);
  if (spans.length) markPartSpans([...group, tail], spans, mark);
}

function* sseFrames(wire: string) {
  let data: { text: string; start: number; offset: number }[] = [];
  let dataLength = 0;
  let event = "";
  for (const line of wire.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
    if (!line[0]) break;
    const text = line[0].replace(/[\r\n]+$/, "");
    if (!text) {
      if (data.length) yield { event, ...frameData(data) };
      data = [];
      dataLength = 0;
      event = "";
    } else if (text.startsWith("event:")) {
      event = text.slice(6).trim();
    } else if (text.startsWith("data:")) {
      const prefix = text[5] === " " ? 6 : 5;
      data.push({ text: text.slice(prefix), start: line.index + prefix, offset: dataLength });
      dataLength += text.length - prefix + 1;
    }
  }
  if (data.length) yield { event, ...frameData(data) };

  function frameData(lines: typeof data) {
    let line = 0;
    return {
      json: lines.map(part => part.text).join("\n"),
      offset(index: number) {
        while (line + 1 < lines.length && index >= lines[line + 1].offset) line++;
        return lines[line].start + index - lines[line].offset;
      },
    };
  }
}

function* stringValues(wire: string, jsonBody: boolean): Generator<StringPart> {
  const quoteOrEscape = /["\\]/g;
  const whitespace = /\s/;
  function* scan(json: string, offset: (index: number) => number) {
    for (let quote = json.indexOf('"'); quote !== -1; quote = json.indexOf('"', quote + 1)) {
      const start = quote + 1;
      const end = jsonStringEnd(json, start, quoteOrEscape);
      quote = end;
      let next = end + 1;
      while (next < json.length && whitespace.test(json[next])) next++;
      if (json[next] === ":" || end === start) continue;
      const raw = json.slice(start, end);
      yield { start: offset(start), raw, text: decodeAgentJsonEscapes(raw) };
    }
  }
  if (jsonBody) {
    yield* scan(wire, index => index);
    return;
  }
  for (const { json, offset } of sseFrames(wire)) {
    yield* scan(json, offset);
  }
}

function markStreamOrder(wire: string, jsonBody: boolean, match: MatchSecret, mark: MarkRedaction) {
  let text = "";
  const chunk: string[] = [];
  for (const field of stringValues(wire, jsonBody)) {
    chunk.push(field.text);
    if (chunk.length < 4096) continue;
    text += chunk.join("");
    chunk.length = 0;
  }
  const spans = match(text + chunk.join(""), 1);
  if (spans.length) markPartSpans(stringValues(wire, jsonBody), spans, mark);
}

export function redactMemoSse(wire: string, key: string): string {
  return redactSse(wire, key, false);
}

/** Recovery alone tries all compatible continuations and stream-order string values for truncated data.
 * An unrelated concatenation that spells the exact active key can be masked in that artifact. */
export function redactMemoRecoveryWire(wire: string, key: string): string {
  return redactSse(wire, key, true);
}

function redactSse(wire: string, key: string, recovery: boolean): string {
  if (!key) return wire;
  const first = wire.trimStart()[0];
  const jsonBody = first === "{" || (recovery && first === "[");
  if (jsonBody && !recovery) return redactMemoResponse(wire, key);
  const match = agentSecretMatcher(key);
  const { mark, apply } = wireRedactions(wire, key);
  if (jsonBody) {
    const { fields, incomplete } = responseFields(wire, index => index);
    redactOutput(fields, match, mark);
    if (incomplete) markStreamOrder(wire, true, match, mark);
    return apply();
  }
  const deltas = new Map<string, Field[]>();
  const reasoningRuns = new Map<string, Field[]>();
  let tail: ResponseTail | undefined;
  let incomplete = false;
  for (const { event, json, offset } of sseFrames(wire)) {
    const frame = responseFields(json, offset, recovery);
    tail = trackFrameDeltas(frame.fields, event, deltas, recovery && frame.incomplete) ?? tail;
    if (recovery) {
      incomplete ||= frame.incomplete;
      trackChatReasoning(frame.fields, reasoningRuns, match, mark);
    }
  }
  // Cap the shared tail scan per group. A JSON escape expands a code unit by at most six.
  const tailPrefix = tail?.field.text.slice(0, 6 * key.length) ?? "";
  for (const [groupId, group] of deltas) {
    markParts(group, match, mark);
    if (!tail || !tailPrefix) continue;
    const identity = JSON.parse(groupId) as (string | null)[];
    if (identity[0] !== "chat" && tail.group.every((value, index) => value === undefined || value === identity[index])) {
      markResponseContinuation(group, tail.field, match, tailPrefix, mark);
    }
  }
  for (const run of reasoningRuns.values()) markParts(run, match, mark);
  if (incomplete) markStreamOrder(wire, false, match, mark);
  return apply();
}
