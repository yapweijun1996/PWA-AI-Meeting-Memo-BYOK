import { spawnSync } from "node:child_process";
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

test.each([
  ["content index", "response.output_text.delta", { content_index: 1 }],
  ["event family", "response.refusal.delta", {}],
  ["item ID", "response.output_text.delta", { item_id: "message-other" }],
] as const)("Responses wire preserves independent text by %s even when concatenation matches", (_label, type, fields) => {
  const frame = (type: string, delta: string, fields: object = {}) =>
    `data: ${JSON.stringify({ type, item_id: "message-first", output_index: 0, content_index: 0, ...fields, delta })}\n\n`;
  const wire = frame("response.output_text.delta", "before sk-synthetic-") + frame(type, "fragments after", fields);
  expect(redactMemoSse(wire, fixture)).toBe(wire);
});

test("Responses item and terminal snapshots preserve distinct content parts", () => {
  const item = { content: [
    { type: "output_text", text: "before sk-synthetic-" },
    { type: "refusal", refusal: "fragments after" },
  ] };
  const wire = `data: ${JSON.stringify({ type: "response.output_item.done", item })}\n\n` +
    `data: ${JSON.stringify({ type: "response.completed", response: { output: [item] } })}\n\n`;
  expect(redactMemoSse(wire, fixture)).toBe(wire);
});

test("Responses reasoning stays independent by summary part and output item", () => {
  const frame = (delta: string, summary_index: number, item_id = "reasoning-first") =>
    `data: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", output_index: 0, item_id, summary_index, delta })}\n\n`;
  const intervening = frame("fragments", 1) + frame("fragments", 0, "reasoning-other");
  const wire = frame("before sk-synthetic-", 0) + intervening + frame("fragments after", 0);
  expect(redactMemoSse(wire, fixture)).toBe(frame("before " + marker, 0) + intervening + frame(" after", 0));
  expect(redactMemoSse(frame("sk-synthetic-", 0) + intervening, fixture)).toBe(frame("sk-synthetic-", 0) + intervening);
});

test("Chat tool fragments follow choice and tool indexes when arrays change order", () => {
  const tool = (index: number, args: string) => ({ index, function: { arguments: args } });
  const choice = (index: number, ...tool_calls: ReturnType<typeof tool>[]) => ({ index, delta: { tool_calls } });
  const frame = (...choices: ReturnType<typeof choice>[]) => `data: ${JSON.stringify({ choices })}\n\n`;
  const first = frame(choice(0, tool(0, "before sk-synthetic-"), tool(1, "fragments")));
  const other = frame(choice(1, tool(0, "fragments")), choice(0, tool(1, " alone")));
  const last = frame(choice(0, tool(1, " keep"), tool(0, "fragments after")));
  expect(redactMemoSse(first + other + last, fixture)).toBe(
    first.replace("sk-synthetic-", marker) + other + last.replace("fragments after", " after"),
  );
  expect(redactMemoSse(first + other, fixture)).toBe(first + other);
});

test.each(["JSON", "SSE"])("4 MiB of malformed %s nesting is handled under a 128 MiB heap", kind => {
  const script = `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      return next(specifier === "../domain/memo-agent-contract" ? specifier + ".ts" : specifier, context);
    } });
    const { redactMemoResponse, redactMemoSse } = await import(${JSON.stringify(new URL("../src/providers/memo-response-redaction.ts", import.meta.url).href)});
    const kind = process.argv[1];
    const redact = kind === "JSON" ? redactMemoResponse : redactMemoSse;
    const prefix = kind === "JSON" ? "" : "data: ";
    const fixture = ${JSON.stringify(fixture)};
    const malformed = prefix + "[".repeat(4 * 1024 * 1024 - prefix.length);
    if (redact(malformed, fixture) !== malformed) throw new Error("Changed the paid response");
    const reflected = malformed.slice(0, -fixture.length - 1) + '"' + fixture;
    if (redact(reflected, fixture) !== reflected.replace(fixture, ${JSON.stringify(marker)})) {
      throw new Error("Failed to mask the credential in the deeply nested fragment");
    }
  `;
  const result = spawnSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "--eval", script, kind], {
    encoding: "utf8", timeout: 10_000,
  });
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
}, 12_000);
