import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { MEMO_AGENT_RESPONSE_BYTES } from "../src/domain/memo-agent-contract";
import { buildMemoRecoveryArtifact, redactMemoResponse, redactMemoSse } from "../src/providers/memo-response-redaction";

const marker = "[redacted provider key]";
const fixture = "sk-synthetic-fragments";
const recover = (wire: string, key = fixture) =>
  buildMemoRecoveryArtifact(wire, key, new TextEncoder().encode(wire).length);

function runConstrainedRecoveryCheck(check: string, argument?: string) {
  const script = `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      return next(specifier === "../domain/memo-agent-contract" ? specifier + ".ts" : specifier, context);
    } });
    const { buildMemoRecoveryArtifact, redactMemoResponse, redactMemoSse } = await import(${JSON.stringify(new URL("../src/providers/memo-response-redaction.ts", import.meta.url).href)});
    const fixture = ${JSON.stringify(fixture)};
    const marker = ${JSON.stringify(marker)};
    const recover = (wire, key = fixture) => buildMemoRecoveryArtifact(wire, key, wire.length);
    ${check}
  `;
  const result = spawnSync(
    process.execPath, ["--max-old-space-size=128", "--input-type=module", "--eval", script, ...(argument ? [argument] : [])],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
}

test.each(["summary", "text", "arguments"])("interrupted Chat masks a split credential when %s comes before its discriminator", name => {
  const frame = (id: string, value: string) => {
    const delta = name === "arguments" ? { tool_calls: [{ function: { arguments: value }, index: 4 }] }
      : { reasoning_details: [{ [name]: value, type: `reasoning.${name}`, index: 4 }] };
    return `data: ${JSON.stringify({ id, choices: [{ delta, index: 2 }] })}\n\n`;
  };
  const last = frame("final", "fragments after");
  const wire = frame("first", "before sk-syn") + frame("second", "thetic-") +
    last.slice(0, last.indexOf('after"') + "after".length);
  const kind = name === "arguments" ? "toolArguments" : name === "summary" ? "reasoningSummary" : "reasoningText";
  expect(recover(wire).content).toContainEqual({
    kind, text: "before " + marker + " after", fragmentCount: 3, tailCutMidString: true,
  });
});

test("a malformed terminal does not erase paid text across an output and refusal", () => {
  const first = 'data: {"type":"response.output_text.delta","item_id":"first","delta":"before sk-synthetic-"}\n\n';
  const second = 'data: {"delta":"fragments after","type":"response.refusal.delta","item_id":"second"}\n\n';
  const wire = first + second + 'data: {"type":"response.completed","response":';
  const recovered = recover(wire);
  expect(recovered.content).toEqual(expect.arrayContaining([
    { kind: "outputText", text: "before sk-synthetic-", fragmentCount: 1, tailCutMidString: false },
    { kind: "refusal", text: "fragments after", fragmentCount: 1, tailCutMidString: false },
  ]));
  expect(recovered.eventCounts).toEqual({
    "response.output_text.delta": 1, "response.refusal.delta": 1, "response.completed": 1,
  });
});

test.each(['{"data":""},', '{"data":"x","summary":"y","text":"z"},'])(
  "a dense 4 MiB truncated reasoning array survives a 128 MiB heap (%s)", entry => {
    runConstrainedRecoveryCheck(`
      const entry = process.argv[1];
      const prefix = 'data: {"choices":[{"index":0,"delta":{"reasoning_details":[';
      const remaining = 4 * 1024 * 1024 - prefix.length;
      const wire = prefix + entry.repeat(Math.floor(remaining / entry.length)) + " ".repeat(remaining % entry.length);
      const result = recover(wire);
      const count = Math.floor(remaining / entry.length);
      const expected = entry.includes("summary") ? { reasoningSummary: "y", reasoningText: "z", other: "x" } : { other: "" };
      for (const [kind, value] of Object.entries(expected)) {
        const content = result.content.find(section => section.kind === kind);
        if (content?.text !== value.repeat(count) || content.fragmentCount !== count) throw new Error("Changed the paid response");
      }
    `, entry);
  }, 12_000,
);

test("4 MiB Responses recovery survives thousands of identities and a long unfinished tail under 128 MiB", () => {
  runConstrainedRecoveryCheck(`
    const type = "response.output_text.delta";
    const key = "sk-" + "x".repeat(131072);
    const frames = Array.from({ length: 2048 }, (_, i) => "data: " +
      JSON.stringify({ type, item_id: "item-" + i, output_index: i, content_index: 0, delta: "unrelated" }) + "\\n\\n").join("");
    const tailText = "z".repeat(5 * 131072);
    const tail = "event: " + type + '\\ndata: {"delta":"' + tailText;
    const padding = ":" + " ".repeat(4 * 1024 * 1024 - frames.length - tail.length - 2) + "\\n";
    const content = recover(padding + frames + tail, key).content.find(section => section.kind === "outputText");
    if (content.text !== "unrelated".repeat(2048) + tailText || content.fragmentCount !== 2049 ||
        !content.tailCutMidString) throw new Error("Changed the paid response");
  `);
}, 12_000);

test("4 MiB of irrelevant fields at clean EOF reaches decoding under 128 MiB", () => {
  runConstrainedRecoveryCheck(`
    const prefix = 'data: {"choices":[{"index":0,"delta":{"reasoning_details":[';
    const entry = '{"type":""},';
    const remaining = 4 * 1024 * 1024 - prefix.length;
    const wire = prefix + entry.repeat(Math.floor(remaining / entry.length)) + " ".repeat(remaining % entry.length);
    if (redactMemoSse(wire, fixture) !== wire) throw new Error("Changed the adapter input");
  `);
}, 12_000);

test("other strings keep their own order and an intervening same-kind value breaks exact adjacency", () => {
  const frame = (delta: string, item_id: string, index: number) =>
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta, item_id, output_index: index })}\n\n`;
  const wire = frame("before sk-synthetic-", "sk-synthetic-", 0) + frame(" unrelated ", "fragments", 1) +
    frame("fragments after", "tail", 0);
  expect(recover(wire).content).toEqual([
    { kind: "outputText", text: "before sk-synthetic- unrelated fragments after", fragmentCount: 3, tailCutMidString: false },
    { kind: "other", text: marker + "tail", fragmentCount: 3, tailCutMidString: false },
  ]);
});

test("Responses recovery classifies text inside a reasoning summary part by its event name", () => {
  const wire = 'data: {"part":{"text":"Keep this summary."},"type":"response.reasoning_summary_part.done"}\n\n';
  expect(recover(wire)).toMatchObject({
    eventCounts: { "response.reasoning_summary_part.done": 1 },
    content: [{ kind: "reasoningSummary", text: "Keep this summary.", fragmentCount: 1, tailCutMidString: false }],
  });
});

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

test.each(["JSON", "SSE", "SSE recovery"])("4 MiB of malformed %s nesting is handled under a 128 MiB heap", kind => {
  runConstrainedRecoveryCheck(`
    const kind = process.argv[1];
    const redact = kind === "JSON" ? redactMemoResponse : redactMemoSse;
    const prefix = kind === "JSON" ? "" : "data: ";
    const malformed = prefix + "[".repeat(4 * 1024 * 1024 - prefix.length);
    const reflected = malformed.slice(0, -fixture.length - 1) + '"' + fixture;
    if (kind === "SSE recovery") {
      if (recover(malformed).content.length !== 0) throw new Error("Invented text in malformed nesting");
      const [deep] = recover(reflected).content;
      if (deep.text !== marker || !deep.tailCutMidString) {
        throw new Error("Failed to mask the credential in the deeply nested fragment");
      }
      const head = 'data: ["before sk-synthetic-",';
      const tail = '"fragments after",';
      const budget = 4 * 1024 * 1024 - head.length - tail.length;
      const padding = '"x",'.repeat(Math.floor(budget / 4)) + ' '.repeat(budget % 4);
      const dense = 'data: [' + padding + head.slice(7) + tail;
      const expected = "x".repeat(Math.floor(budget / 4)) + "before " + marker + " after";
      if (recover(dense).content[0].text !== expected) throw new Error("Failed to mask split strings in the dense truncated frame");
    } else {
      if (redact(malformed, fixture) !== malformed) throw new Error("Changed the paid response");
      if (redact(reflected, fixture) !== reflected.replace(fixture, marker)) {
        throw new Error("Failed to mask the credential in the deeply nested fragment");
      }
    }
  `, kind);
}, 12_000);
