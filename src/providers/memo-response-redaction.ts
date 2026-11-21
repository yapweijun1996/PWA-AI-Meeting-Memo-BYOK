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
const indexFields = new Set(["output_index", "content_index", "index"]);
const relevantFields = new Set(["type", "text", "refusal", "delta", "content", "item_id", ...indexFields]);
const jsonDelimiters = /[\s{}[\],:"]/;

/** Locate response fields even when the last frame or JSON string is incomplete. */
function responseFields(json: string, offset: (index: number) => number): Field[] {
  const fields: Field[] = [];
  const stack: Container[] = [];
  const quoteOrEscape = /["\\]/g;
  for (let cursor = 0; cursor < json.length;) {
    const char = json[cursor++];
    const container = stack.at(-1);
    if (char === "{" || char === "[") {
      const path = !container ? [] : container.path && container.path.length < 6 && container.member !== undefined
        ? [...container.path, container.member] : undefined;
      stack.push({ path, member: char === "[" ? 0 : undefined });
    } else if (char === "}" || char === "]") {
      stack.pop();
    } else if (char === "," && container) {
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
      if (!container?.path) continue;
      if (container.member === undefined) {
        container.member = decodeAgentJsonEscapes(json.slice(start, end));
      } else if (typeof container.member === "string" && relevantFields.has(container.member)) {
        const raw = json.slice(start, end);
        fields.push({ path: [...container.path, container.member], start: offset(start), end: offset(end),
          raw, text: decodeAgentJsonEscapes(raw) });
      }
    } else if (!jsonDelimiters.test(char)) {
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

function redactOutput(fields: Field[], match: MatchSecret, streamed: boolean) {
  const objects = new Map<string, Fields>();
  const groups = new Map<string, Field[]>();
  for (const field of fields) {
    const path = field.path;
    const [root, first, second, third, fourth, fifth] = path;
    const standard = root === "output" && typeof first === "number" && second === "content" &&
      typeof third === "number" && typeof fourth === "string" && path.length === 5;
    const item = root === "item" && first === "content" && typeof second === "number" &&
      typeof third === "string" && path.length === 4;
    const terminal = root === "response" && first === "output" && typeof second === "number" && third === "content" &&
      typeof fourth === "number" && typeof fifth === "string" && path.length === 6;
    if (standard && !streamed) rememberField(objects, `output/${first}/${third}`, fourth, field);
    if (item && streamed) rememberField(objects, `item/${second}`, third, field);
    if (terminal && streamed) rememberField(objects, `response/${second}/${fourth}`, fifth, field);
  }
  for (const [path, object] of objects) {
    const type = object.get("type")?.text;
    const field = type === "output_text" ? object.get("text")
      : streamed && type === "refusal" ? object.get("refusal") : undefined;
    if (field) addPart(groups, path.slice(0, path.lastIndexOf("/")), field);
  }
  if (streamed) {
    for (const group of groups.values()) redactParts(group, match);
  } else redactParts([...groups.values()].flat(), match);
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
  redactOutput(fields, agentSecretMatcher(key), false);
  return applyRedactions(body, fields, key);
}

/** Preserve SSE framing and non-text fields while masking complete logical output strings. */
export function redactMemoSse(wire: string, key: string): string {
  if (!key) return wire;
  if (wire.trimStart().startsWith("{")) return redactMemoResponse(wire, key);
  const match = agentSecretMatcher(key);
  const edits: Field[] = [];
  const deltas = new Map<string, Field[]>();
  const contentParts = new Map<string, Field[]>();
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
      const root = new Map(fields.filter(field => field.path.length === 1)
        .map(field => [field.path[0], field]));
      const type = root.get("type")?.text ?? event;
      const delta = root.get("delta");
      if (delta && (type === "response.output_text.delta" || type === "response.refusal.delta")) {
        const output = root.get("output_index")?.text ?? root.get("item_id")?.text ?? "0";
        addPart(deltas, `responses/${output}`, delta);
        addPart(contentParts, `${output}/${root.get("content_index")?.text ?? "0"}`, delta);
      }
      const choices = new Map<number, Fields>();
      for (const field of fields) {
        const [key, choice, member, leaf] = field.path;
        if (key !== "choices" || typeof choice !== "number") continue;
        if (member === "index" && field.path.length === 3)
          rememberField(choices, choice, member, field);
        else if (member === "delta" && leaf === "content" && field.path.length === 4)
          rememberField(choices, choice, leaf, field);
      }
      for (const [choice, value] of choices) {
        const field = value.get("content");
        if (field) addPart(deltas, `chat/${value.get("index")?.text ?? choice}`, field);
      }
      redactOutput(fields, match, true);
      for (const field of fields)
        if (field.changed || field === delta || (field.path[0] === "choices" && field.path.at(-1) === "content")) edits.push(field);
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
  // Native SSE consumers track content indexes. Pi also concatenates by output index.
  for (const group of contentParts.values()) redactParts(group, match);
  for (const group of deltas.values()) redactParts(group, match);
  return applyRedactions(wire, edits, key);
}
