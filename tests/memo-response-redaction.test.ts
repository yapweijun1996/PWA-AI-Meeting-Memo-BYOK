import { expect, test } from "vitest";
import { MEMO_AGENT_RESPONSE_BYTES } from "../src/domain/memo-agent-contract";
import { redactMemoResponse, redactMemoSse } from "../src/providers/memo-response-redaction";

const marker = "[redacted provider key]";
const fixture = "sk-synthetic-fragments";

test("memo receipt redaction preserves unrelated wire data at 4 MiB", () => {
  const prefix = '{"output":[{"content":[{"type":"output_text","text":"before sk-synthetic-' +
    '"},{"type":"output_text","text":"fragments after"}]}],"exact":900719925474099312345,"other":"';
  const suffix = '"}';
  const body = prefix + "x".repeat(MEMO_AGENT_RESPONSE_BYTES - prefix.length - suffix.length) + suffix;
  const expected = body.replace("sk-synthetic-", marker).replace("fragments after", " after");
  expect(redactMemoResponse(body, fixture) === expected).toBe(true);
});

test("Pi SSE redaction handles an escape-heavy 4 MiB stream and preserves a near match", () => {
  const first = 'data: {"type":"response.output_text.delta","output_index":0,"delta":"';
  const next = '"}\n\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"';
  const last = 'fragments after sk-synthetic-fragmentX"}\n\n';
  const fixedLength = first.length + next.length + last.length + "sk-synthetic-".length;
  const avail = MEMO_AGENT_RESPONSE_BYTES - fixedLength;
  const padding = "\\u0061".repeat(Math.floor(avail / 6)) + "a".repeat(avail % 6);
  const wire = first + padding + "sk-synthetic-" + next + last;
  const exported = redactMemoSse(wire, fixture);
  expect(exported === first + padding + marker + next + ' after sk-synthetic-fragmentX"}\n\n').toBe(true);
  const [head, tail] = exported.trimEnd().split("\n\n").map(frame => JSON.parse(frame.slice(6)).delta);
  expect(head.endsWith(marker)).toBe(true);
  expect(head.slice(0, -marker.length) === "a".repeat(Math.floor(avail / 6) + avail % 6)).toBe(true);
  expect(tail).toBe(" after sk-synthetic-fragmentX");
});

test("Chat Completions content redacts across deltas by choice index", () => {
  const frame = (content: string, index: number) =>
    `data: ${JSON.stringify({ choices: [{ index, delta: { content } }] })}\n\n`;
  const wire = frame("before sk-synthetic-", 0) + frame("different choice", 1) + frame("fragments after", 0);
  expect(redactMemoSse(wire, fixture)).toBe(
    frame("before " + marker, 0) + frame("different choice", 1) + frame(" after", 0),
  );
});
