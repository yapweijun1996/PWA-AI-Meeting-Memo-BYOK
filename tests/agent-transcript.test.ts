import { expect, test } from "vitest";
import { segment } from "../src/domain/model";
import {
  readAgentTranscript,
  searchAgentTranscript,
  mergeConsulted,
} from "../src/providers/agent-transcript";
import {
  MEMO_AGENT_TOOL_BYTES,
  redactAgentSecret,
} from "../src/domain/memo-agent-contract";

test("search leaves a resumable cursor before exceeding its character budget", () => {
  const sources = Array.from({ length: 12 }, () => segment("x".repeat(19999)));
  const first = JSON.parse(
    searchAgentTranscript(sources, { query: "absent" }).text,
  );
  expect(first.scanned).toBe(10);
  expect(first.nextIndex).toBe(10);
  expect(
    JSON.parse(
      searchAgentTranscript(sources, {
        query: "absent",
        startIndex: first.nextIndex,
      }).text,
    ).nextIndex,
  ).toBeNull();
});

test("bounded range cursors retain every exact multilingual character and revision", () => {
  const source = {
    ...segment('库存检查😀 "quoted" \\ paths\n'.repeat(600)),
    revision: 3,
  };
  const before = structuredClone(source);
  let next: { startIndex: number; textOffset: number } | null = {
    startIndex: 0,
    textOffset: 0,
  };
  let text = "",
    calls = 0;
  while (next) {
    expect(++calls).toBeLessThan(30);
    const result = readAgentTranscript([source], { ...next, count: 1 });
    expect(
      new TextEncoder().encode(result.text).byteLength,
    ).toBeLessThanOrEqual(MEMO_AGENT_TOOL_BYTES);
    const parsed = JSON.parse(result.text);
    expect(parsed.excerpts[0].textOffset).toBe(text.length);
    expect(parsed.excerpts[0].revision).toBe(3);
    expect(result.consulted).toEqual([{ id: source.id, revision: 3 }]);
    expect(parsed.excerpts[0].text).not.toMatch(
      /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/,
    );
    text += parsed.excerpts
      .map((excerpt: { text: string }) => excerpt.text)
      .join("");
    next = parsed.next;
  }
  expect(text).toBe(source.text);
  expect(source).toEqual(before);
});

test("range lookup packs short word-level sources without inventing timing or identities", () => {
  const sources = Array.from({ length: 100 }, (_, i) => segment(`word${i}`));
  const result = readAgentTranscript(sources, { startIndex: 0, count: 40 });
  const parsed = JSON.parse(result.text);
  expect(parsed.excerpts.length).toBeGreaterThan(10);
  expect(parsed.excerpts.length).toBeLessThanOrEqual(40);
  expect(parsed.excerpts[0]).toMatchObject({
    text: "word0",
    start: null,
    end: null,
    speakerIds: [],
  });
  expect(parsed.next.startIndex).toBe(parsed.excerpts.length);
  expect(result.consulted).toHaveLength(parsed.excerpts.length);
  expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(
    MEMO_AGENT_TOOL_BYTES,
  );
});

test("search exposes a bounded continuation cursor and does not count snippets as consulted", () => {
  const sources = Array.from({ length: 1501 }, (_, i) =>
    segment(i === 1500 ? "ERP Budget 決定" : "unrelated"),
  );
  const first = searchAgentTranscript(sources, { query: "ＢＵＤＧＥＴ" });
  expect(JSON.parse(first.text)).toEqual({
    matches: [],
    nextIndex: 1000,
    scanned: 1000,
  });
  const second = searchAgentTranscript(sources, {
    query: "budget",
    startIndex: 1000,
  });
  expect(JSON.parse(second.text).matches[0]).toMatchObject({
    index: 1500,
    id: sources[1500].id,
    excerpt: "ERP Budget 決定",
  });
  expect(second.consulted).toEqual([]);
  expect(searchAgentTranscript(sources, { query: ".*" }).text).toContain(
    '"matches":[]',
  );
});

test("search also bounds long-source scanning and UTF-8 result metadata", () => {
  const sources = Array.from({ length: 50 }, () => ({
    ...segment("target库存".repeat(2000)),
    id: "x".repeat(1900) + crypto.randomUUID(),
  }));
  const result = searchAgentTranscript(sources, { query: "target", limit: 20 });
  const parsed = JSON.parse(result.text);
  expect(parsed.matches.length).toBeGreaterThan(0);
  expect(parsed.matches.length).toBeLessThan(20);
  expect(parsed.nextIndex).toBeLessThan(50);
  expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(
    MEMO_AGENT_TOOL_BYTES,
  );
});

test("lookup arguments fail closed for unknown fields, invalid bounds and missing ranges", () => {
  const sources = [segment("Local evidence")];
  expect(() => searchAgentTranscript(sources, { query: "   " })).toThrow();
  expect(() =>
    searchAgentTranscript(sources, {
      query: "Local",
      url: "https://example.com",
    }),
  ).toThrow();
  expect(() =>
    readAgentTranscript(sources, { startIndex: 0, count: 41 }),
  ).toThrow();
  expect(() =>
    readAgentTranscript(sources, { startIndex: 2, count: 1 }),
  ).toThrow("beyond");
  expect(() =>
    readAgentTranscript(sources, { startIndex: 0, count: 1, textOffset: 100 }),
  ).toThrow("offset");
  expect(
    JSON.parse(readAgentTranscript(sources, { startIndex: 1 }).text),
  ).toEqual({ excerpts: [], next: null });
});

test("consulted references stay ordered, revision-specific and unique", () => {
  const source = segment("Example");
  expect(
    mergeConsulted(
      [{ id: source.id, revision: 1 }],
      [
        { id: source.id, revision: 1 },
        { id: source.id, revision: 2 },
      ],
    ),
  ).toEqual([
    { id: source.id, revision: 1 },
    { id: source.id, revision: 2 },
  ]);
});

test("provider secrets are redacted in both plaintext and escaped response records", () => {
  const key = 'synthetic-"secret"\\-not-real';
  const input = JSON.stringify({ message: `Provider echoed ${key}` });
  expect(redactAgentSecret(input, key)).not.toContain(
    JSON.stringify(key).slice(1, -1),
  );
  expect(JSON.parse(redactAgentSecret(input, key)).message).toContain(
    "[redacted provider key]",
  );
  expect(redactAgentSecret(`Error: ${key}`, key)).not.toContain(key);
});

test("the last search page fits 8 KiB including its null cursor", () => {
  const sources = Array.from({ length: 8 }, (_, index) =>
    segment(index === 7 ? "x" + "\0".repeat(79) + "a" : "x" + "\0".repeat(167)),
  );
  const first = searchAgentTranscript(sources, { query: "x" });
  expect(new TextEncoder().encode(first.text).byteLength).toBeLessThanOrEqual(MEMO_AGENT_TOOL_BYTES);
  const page = JSON.parse(first.text);
  expect(page.nextIndex).toBe(7);
  const last = JSON.parse(searchAgentTranscript(sources, { query: "x", startIndex: page.nextIndex }).text);
  expect([...page.matches, ...last.matches].map(match => match.id)).toEqual(sources.map(source => source.id));
  expect(last.nextIndex).toBeNull();
});
