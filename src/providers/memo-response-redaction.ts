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
const MAX_RESPONSE_PATH_DEPTH = 6;
const MAX_TRACKED_RESPONSE_FIELDS = 8192;
const MAX_SSE_FRAME_DATA_LINES = 8192;
const indexFields = new Set(["output_index", "content_index", "summary_index", "index"]);
const chatDeltaFields = new Set(["content", "reasoning", "reasoning_content", "reasoning_text"]);
const responseEventFields = new Set(["type", "delta", "item_id", ...indexFields]);
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

function isTrackedField(path: PathPart[], name: string, mode: "output" | "stream") {
  const [root, item, container, part, index, fn] = path;
  if (mode === "output") {
    return path.length === 4 && root === "output" && typeof item === "number" &&
      container === "content" && typeof part === "number" && (name === "type" || name === "text");
  }
  if (path.length === 0) return responseEventFields.has(name);
  if (root !== "choices" || typeof item !== "number") return false;
  if (path.length === 2) return name === "index";
  if (container !== "delta") return false;
  if (path.length === 3) return chatDeltaFields.has(name);
  if (part !== "tool_calls" || typeof index !== "number") return false;
  return (path.length === 5 && name === "index") ||
    (path.length === 6 && fn === "function" && name === "arguments");
}

/** Retain only fields used by the adapter redactor, even if the frame is malformed. */
function responseFields(
  json: string, offset: (index: number) => number, mode: "output" | "stream", limit: number,
) {
  const fields: Field[] = [];
  const stack: Container[] = [];
  const quoteOrEscape = /["\\]/g;
  let skippedDepth = 0;
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
      cursor = end + 1;
      if (skippedDepth || !container?.path) continue;
      if (container.member === undefined) {
        container.member = decodeAgentJsonEscapes(json.slice(start, end));
      } else if (typeof container.member === "string" && isTrackedField(container.path, container.member, mode)) {
        if (fields.length === limit) return undefined;
        const raw = json.slice(start, end);
        fields.push({ path: [...container.path, container.member], start: offset(start), complete: end !== json.length,
          raw, text: decodeAgentJsonEscapes(raw) });
      }
    } else if (!skippedDepth && !jsonDelimiters.test(char)) {
      const start = cursor - 1;
      while (cursor < json.length && !jsonDelimiters.test(json[cursor])) cursor++;
      if (container?.path && typeof container.member === "string" && indexFields.has(container.member) &&
          isTrackedField(container.path, container.member, mode)) {
        if (fields.length === limit) return undefined;
        const raw = json.slice(start, cursor);
        fields.push({ path: [...container.path, container.member], start: offset(start), complete: cursor < json.length,
          raw, text: String(Number(raw)) });
      }
    }
  }
  return fields;
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

export function redactMemoResponse(body: string, key: string, fieldLimit = Infinity): string {
  if (!key) return body;
  const fields = responseFields(body, index => index, "output", fieldLimit);
  if (!fields) return redactAgentSecret(body, key);
  const { mark, apply } = wireRedactions(body, key);
  redactOutput(fields, agentSecretMatcher(key), mark);
  return apply();
}

function trackFrameDeltas(fields: Field[], event: string, deltas: Map<string, Field[]>) {
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
  if (delta && partIndex !== undefined) {
    const identity = (name: string) => {
      const field = rootFields.get(name);
      return field?.complete ? field.text : undefined;
    };
    const item = identity("item_id");
    const output = identity("output_index");
    const part = typeof partIndex === "string" ? identity(partIndex) : partIndex;
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
      if (data.length === MAX_SSE_FRAME_DATA_LINES) {
        yield undefined;
        return;
      }
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

export function redactMemoSse(wire: string, key: string): string {
  if (!key) return wire;
  if (wire.trimStart()[0] === "{") return redactMemoResponse(wire, key, MAX_TRACKED_RESPONSE_FIELDS);
  const deltas = new Map<string, Field[]>();
  let remainingFields = MAX_TRACKED_RESPONSE_FIELDS;
  for (const frame of sseFrames(wire)) {
    if (!frame) return redactAgentSecret(wire, key);
    const { event, json, offset } = frame;
    const fields = responseFields(json, offset, "stream", remainingFields);
    if (!fields) return redactAgentSecret(wire, key);
    remainingFields -= fields.length;
    trackFrameDeltas(fields, event, deltas);
  }
  const match = agentSecretMatcher(key);
  const { mark, apply } = wireRedactions(wire, key);
  for (const group of deltas.values()) markParts(group, match, mark);
  return apply();
}
