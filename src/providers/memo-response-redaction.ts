import {
  AGENT_SECRET_REDACTION,
  agentJsonOffsets,
  agentSecretMatcher,
  decodeAgentJsonEscapes,
  redactAgentSecret,
} from "../domain/memo-agent-contract";

type PathPart = string | number;
type Field = { path: PathPart[]; start: number; end: number; raw: string; text: string; changed?: boolean };
type Container = { path?: PathPart[]; member: PathPart | undefined };
type Fields = Map<string, Field>;
type MatchSecret = ReturnType<typeof agentSecretMatcher>;
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

/** Locate response fields even when the last frame or JSON string is incomplete. */
function responseFields(json: string, offset: (index: number) => number): Field[] {
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
      let end = json.length;
      quoteOrEscape.lastIndex = start;
      for (let match = quoteOrEscape.exec(json); match; match = quoteOrEscape.exec(json)) {
        if (match[0] === '"') {
          end = match.index;
          break;
        }
        quoteOrEscape.lastIndex++;
      }
      cursor = end + 1;
      if (skippedDepth || !container?.path) continue;
      if (container.member === undefined) {
        container.member = decodeAgentJsonEscapes(json.slice(start, end));
      } else if (typeof container.member === "string" && relevantFields.has(container.member)) {
        const raw = json.slice(start, end);
        fields.push({ path: [...container.path, container.member], start: offset(start), end: offset(end),
          raw, text: decodeAgentJsonEscapes(raw) });
      }
    } else if (!skippedDepth && !jsonDelimiters.test(char)) {
      const start = cursor - 1;
      while (cursor < json.length && !jsonDelimiters.test(json[cursor])) cursor++;
      if (container?.path && typeof container.member === "string" && indexFields.has(container.member)) {
        const raw = json.slice(start, cursor);
        fields.push({ path: [...container.path, container.member], start: offset(start), end: offset(cursor),
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

function redactParts(parts: Field[], match: MatchSecret) {
  if (parts.length < 2) return;
  const spans = match(parts.map(field => field.text).join(""), 1);
  let offset = 0, spanIndex = 0;
  for (const field of parts) {
    if (spanIndex === spans.length) return;
    const end = offset + field.text.length;
    if (field.text.length && spans[spanIndex].start < end) {
      redactField(field, offset, end);
    }
    offset = end;
  }

  function redactField(field: Field, offset: number, end: number) {
    const rawOffset = agentJsonOffsets(field.raw);
    let copied = 0, rawCopied = 0;
    const fragments: string[] = [];
    const rawFragments: string[] = [];
    for (let span = spans[spanIndex]; span && span.start < end; span = spans[spanIndex]) {
      const start = Math.max(0, span.start - offset);
      fragments.push(field.text.slice(copied, start));
      rawFragments.push(field.raw.slice(rawCopied, rawOffset(start)));
      if (span.start >= offset) {
        fragments.push(AGENT_SECRET_REDACTION);
        rawFragments.push(AGENT_SECRET_REDACTION);
      }
      copied = Math.min(end, span.end) - offset;
      rawCopied = rawOffset(copied);
      if (span.end > end) break;
      spanIndex++;
    }
    field.text = fragments.join("") + field.text.slice(copied);
    field.raw = rawFragments.join("") + field.raw.slice(rawCopied);
    field.changed = true;
  }
}

function redactOutput(fields: Field[], match: MatchSecret) {
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
  redactParts(output, match);
}

function applyRedactions(wire: string, fields: Field[], key: string) {
  const parts: string[] = [];
  let offset = 0;
  for (const field of fields) {
    if (!field.changed) continue;
    parts.push(wire.slice(offset, field.start), field.raw);
    offset = field.end;
  }
  const updated = parts.length ? parts.join("") + wire.slice(offset) : wire;
  return redactAgentSecret(updated, key);
}

export function redactMemoResponse(body: string, key: string): string {
  if (!key) return body;
  const fields = responseFields(body, index => index);
  redactOutput(fields, agentSecretMatcher(key));
  return applyRedactions(body, fields, key);
}

function trackFrameDeltas(fields: Field[], event: string, deltas: Map<string, Field[]>, edits: Field[]) {
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

  const type = rootFields.get("type")?.text ?? event;
  const delta = rootFields.get("delta");
  const partIndex = responsePartIndexes.get(type);
  let responseGroup: string | undefined;
  if (delta && partIndex !== undefined) {
    const item = rootFields.get("item_id")?.text;
    const output = rootFields.get("output_index")?.text ?? "0";
    const part = partIndex === null ? null : rootFields.get(partIndex)?.text ?? "0";
    responseGroup = JSON.stringify([type, item, output, part]);
  }

  for (const field of fields) {
    const [root, choice, member, leaf, tool, fn, args] = field.path;
    if (field === delta && responseGroup !== undefined) {
      addPart(deltas, responseGroup, field);
      edits.push(field);
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
    } else continue;
    edits.push(field);
  }
}

/** Preserve SSE framing and non-text fields while masking complete logical output strings. */
export function redactMemoSse(wire: string, key: string): string {
  if (!key) return wire;
  if (wire.trimStart().startsWith("{")) return redactMemoResponse(wire, key);
  const match = agentSecretMatcher(key);
  const edits: Field[] = [];
  const deltas = new Map<string, Field[]>();
  let data: { text: string; start: number; offset: number }[] = [];
  let dataLength = 0;
  let event = "";
  const finishFrame = () => {
    if (data.length) {
      let line = 0;
      const fields = responseFields(data.map(part => part.text).join("\n"), index => {
        while (line + 1 < data.length && index >= data[line + 1].offset) line++;
        return data[line].start + index - data[line].offset;
      });
      trackFrameDeltas(fields, event, deltas, edits);
    }
    data = [];
    dataLength = 0;
    event = "";
  };
  for (const line of wire.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
    if (!line[0]) break;
    const text = line[0].replace(/[\r\n]+$/, "");
    if (!text) finishFrame();
    else if (text.startsWith("event:")) event = text.slice(6).trim();
    else if (text.startsWith("data:")) {
      const prefix = text[5] === " " ? 6 : 5;
      data.push({ text: text.slice(prefix), start: line.index + prefix, offset: dataLength });
      dataLength += text.length - prefix + 1;
    }
  }
  finishFrame();
  for (const group of deltas.values()) redactParts(group, match);
  return applyRedactions(wire, edits, key);
}
