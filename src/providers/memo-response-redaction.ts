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
function responseFields(json: string, offset: (index: number) => number, mode: "output" | "stream") {
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
        const raw = json.slice(start, end);
        fields.push({ path: [...container.path, container.member], start: offset(start), complete: end !== json.length,
          raw, text: decodeAgentJsonEscapes(raw) });
      }
    } else if (!skippedDepth && !jsonDelimiters.test(char)) {
      const start = cursor - 1;
      while (cursor < json.length && !jsonDelimiters.test(json[cursor])) cursor++;
      if (container?.path && typeof container.member === "string" && indexFields.has(container.member) &&
          isTrackedField(container.path, container.member, mode)) {
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

export function redactMemoResponse(body: string, key: string): string {
  if (!key) return body;
  const fields = responseFields(body, index => index, "output");
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
  if (wire.trimStart()[0] === "{") return redactMemoResponse(wire, key);
  const match = agentSecretMatcher(key);
  const { mark, apply } = wireRedactions(wire, key);
  const deltas = new Map<string, Field[]>();
  for (const { event, json, offset } of sseFrames(wire)) {
    trackFrameDeltas(responseFields(json, offset, "stream"), event, deltas);
  }
  for (const group of deltas.values()) markParts(group, match, mark);
  return apply();
}

type RecoveryKind = "outputText" | "refusal" | "reasoningSummary" | "reasoningText" | "toolArguments" | "other";
type RecoveryContent = {
  kind: RecoveryKind;
  text: string;
  fragmentCount: number;
  tailCutMidString: boolean;
};
export type MemoRecoveryArtifact = {
  content: RecoveryContent[];
  byteLength: number;
  frameCount: number;
  eventCounts: Record<string, number>;
};

const responseEventKinds = new Map<string, RecoveryKind>();
for (const [family, kind] of [
  ["output_text", "outputText"],
  ["refusal", "refusal"],
  ["reasoning_summary_text", "reasoningSummary"],
  ["reasoning_text", "reasoningText"],
  ["function_call_arguments", "toolArguments"],
] as const) {
  for (const phase of ["delta", "done"]) responseEventKinds.set(`response.${family}.${phase}`, kind);
}
for (const phase of ["added", "done"]) {
  responseEventKinds.set(`response.reasoning_summary_part.${phase}`, "reasoningSummary");
  responseEventKinds.set(`response.content_part.${phase}`, "outputText");
}
const recoveryEventNames = new Set([
  ...responseEventKinds.keys(),
  "response.created", "response.in_progress", "response.completed", "response.incomplete",
  "response.failed", "response.output_item.added", "response.output_item.done", "error",
]);
const MAX_RECOVERY_CONTEXT_DEPTH = 8;

/** Assemble SSE data lines without retaining an offset record for each line. */
function* recoveryFrames(wire: string) {
  let event = "";
  let data = "";
  let hasData = false;
  for (const [line, text] of wire.matchAll(/([^\r\n]*)(?:\r\n|[\r\n]|$)/g)) {
    if (!line) break;
    if (!text) {
      if (hasData) yield { event, data };
      event = data = "";
      hasData = false;
    } else if (text.startsWith("event:")) {
      event = text.slice(6).trim();
    } else if (text.startsWith("data:")) {
      const value = text.slice(text[5] === " " ? 6 : 5);
      data = hasData ? data + "\n" + value : value;
      hasData = true;
    }
  }
  if (hasData) yield { event, data };
}

type RecoveryStringVisitor = (
  start: number, end: number, key: string | undefined, parents: (string | undefined)[], depth: number, cut: boolean,
) => boolean | void;

function visitRecoveryStrings(json: string, visit: RecoveryStringVisitor) {
  const quoteOrEscape = /["\\]/g;
  const whitespace = /\s/;
  const parents: (string | undefined)[] = [];
  let depth = 0;
  let member: string | undefined;
  for (let cursor = 0; cursor < json.length;) {
    const char = json[cursor++];
    if (char === "{" || char === "[") {
      if (depth < MAX_RECOVERY_CONTEXT_DEPTH) parents[depth] = member;
      depth++;
      member = undefined;
    } else if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
      member = undefined;
    } else if (char === ",") {
      member = undefined;
    } else if (char === '"') {
      const start = cursor;
      const end = jsonStringEnd(json, start, quoteOrEscape);
      const cut = end === json.length;
      cursor = end + 1;
      let next = cursor;
      while (next < json.length && whitespace.test(json[next])) next++;
      // A colon identifies a field name even when a neighboring token is malformed.
      if (json[next] === ":") {
        member = depth <= MAX_RECOVERY_CONTEXT_DEPTH ? decodeAgentJsonEscapes(json.slice(start, end)) : undefined;
        cursor = next + 1;
      } else {
        if (visit(start, end, member, parents, depth, cut)) return;
        member = undefined;
      }
    }
  }
}

function contentKind(
  field: string | undefined, parents: (string | undefined)[], depth: number, eventKind?: RecoveryKind,
): RecoveryKind {
  if (depth > MAX_RECOVERY_CONTEXT_DEPTH) return "other";
  if (depth === 1 && eventKind && (field === "delta" || field === "text")) return eventKind;
  switch (field) {
    case "output_text": return "outputText";
    case "refusal": return "refusal";
    case "reasoning":
    case "reasoning_content":
    case "reasoning_text": return "reasoningText";
    case "reasoning_summary":
    case "summary_text": return "reasoningSummary";
    case "arguments": return "toolArguments";
    case "content":
      if (depth === 4 && parents[1] === "choices" &&
          (parents[3] === "delta" || parents[3] === "message")) return "outputText";
      break;
    case "summary":
      if ((depth === 1 && eventKind === "reasoningSummary") ||
          parents[depth - 2] === "reasoning_details") return "reasoningSummary";
      break;
    case "text":
      // Arrays and their entries each occupy one level. The enclosing field identifies the part.
      if (depth === 2 && parents[1] === "part" && eventKind) return eventKind;
      if (parents[depth - 2] === "reasoning_details") return "reasoningText";
      if (parents[depth - 2] === "summary") return "reasoningSummary";
      if (parents[depth - 2] === "content") return "outputText";
      break;
  }
  return "other";
}

/** Project received content into a page-only artifact without retaining frames or grouping by identity. */
export function buildMemoRecoveryArtifact(wire: string, key: string, byteLength: number): MemoRecoveryArtifact {
  type Fragments = { chunks: string[]; batch: string[]; count: number; cut: boolean };
  const kinds = new Map<RecoveryKind, Fragments>();
  const eventCounts: Record<string, number> = {};
  let frameCount = 0;
  const isJson = (body: string) => /^\s*[[{"]/.test(body);
  if (isJson(wire) || !/(?:^|[\r\n])(?:data|event):/.test(wire)) {
    collectFrame(wire, "");
  } else {
    for (const { event, data } of recoveryFrames(wire)) collectFrame(data, event);
  }
  return {
    byteLength, frameCount, eventCounts,
    content: Array.from(kinds, ([kind, fragments]) => {
      fragments.chunks.push(fragments.batch.join(""));
      return {
        kind,
        text: redactAgentSecret(fragments.chunks.join(""), key),
        fragmentCount: fragments.count,
        tailCutMidString: fragments.cut,
      };
    }),
  };

  function add(kind: RecoveryKind, text: string, cut: boolean) {
    let fragments = kinds.get(kind);
    if (!fragments) {
      fragments = { chunks: [], batch: [], count: 0, cut: false };
      kinds.set(kind, fragments);
    }
    fragments.count++;
    fragments.cut = cut;
    if (text) fragments.batch.push(text);
    if (fragments.batch.length === 4096) {
      fragments.chunks.push(fragments.batch.join(""));
      fragments.batch.length = 0;
    }
  }

  function collectFrame(data: string, headerEvent: string) {
    frameCount++;
    if (!isJson(data)) {
      if (headerEvent && recoveryEventNames.has(headerEvent)) countEvent(headerEvent);
      if (data) add("other", data, false);
      return;
    }
    let event = recoveryEventNames.has(headerEvent) ? headerEvent : "";
    if (!event) {
      // Resolve a JSON event name even when it occurs after the content.
      visitRecoveryStrings(data, (start, end, field, _parents, depth, cut) => {
        if (depth !== 1 || field !== "type" || cut) return;
        const value = decodeAgentJsonEscapes(data.slice(start, end));
        if (!recoveryEventNames.has(value)) return;
        event = value;
        return true;
      });
    }
    if (event) countEvent(event);
    const eventKind = responseEventKinds.get(event);
    visitRecoveryStrings(data, (start, end, field, parents, depth, cut) => {
      if (depth === 1 && field === "type" && event && data.slice(start, end) === event) return;
      add(contentKind(field, parents, depth, eventKind), decodeAgentJsonEscapes(data.slice(start, end)), cut);
    });
  }

  function countEvent(event: string) {
    eventCounts[event] = (eventCounts[event] ?? 0) + 1;
  }
}
