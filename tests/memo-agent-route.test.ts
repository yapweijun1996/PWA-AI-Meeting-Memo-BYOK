import { expect, test, vi } from "vitest";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import {
  AGENT_ROUTE_PROFILES,
  newAgentRoute,
  resolveAgentRoute,
} from "../src/domain/memo-agent-route";
import {
  assertAgentTransport,
  streamAgentRoute,
} from "../src/providers/memo-agent-transport";

const selection = { provider: "openrouter", model: "openai/gpt-6-luna" };
const route = newAgentRoute(selection);
const context = normalizeContext({
  messages: [
    { role: "user", content: "Synthetic transport probe", timestamp: 1 },
  ],
});

test("the pinned OpenRouter SDK serializes the frozen route without fallback or a CLI runtime", async () => {
  const fetch = vi.fn(async (input, init) => {
    assertAgentTransport(route, input, init);
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      model: selection.model,
      store: false,
      reasoning: { effort: "high" },
      max_tokens: 32768,
      provider: {
        only: ["openai"],
        order: ["openai"],
        allow_fallbacks: false,
        require_parameters: true,
      },
    });
    return new Response(
      'data: {"id":"synthetic","choices":[{"index":0,"delta":{"content":"Verified serialization"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const result = await streamAgentRoute(route, context, {
    apiKey: "sk-synthetic-probe",
    fetch,
  });
  expect(result.stopReason).toBe("stop");
  expect(result.content).toContainEqual(
    expect.objectContaining({ type: "text", text: "Verified serialization" }),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  { provider: "openai", model: "gpt-6-luna" },
  selection,
])("$provider enforces the inclusive UTF-8 byte limit on the SDK request body", async (selected) => {
  const testRoute = newAgentRoute(selected);
  const limit = 256 * 1024;
  const encoder = new TextEncoder();
  const source = '合成记录 📝 "decision"\n'.repeat(64);
  const payloads: string[] = [];
  const send = vi.fn(async () => new Response("Synthetic provider response", { status: 400 }));
  const fetch = vi.fn(async (input, init) => {
    payloads.push(init.body);
    assertAgentTransport(testRoute, input, init);
    return send();
  });
  const run = (padding: string) => streamAgentRoute(
    testRoute,
    normalizeContext({ messages: [{ role: "user", content: source + padding, timestamp: 1 }] }),
    { apiKey: "sk-synthetic-probe", fetch },
  );

  // Measure each adapter's native envelope before padding by a known byte count.
  await run("");
  const baseBytes = encoder.encode(payloads[0]).byteLength;
  for (const offset of [-1, 0, 1]) {
    const targetBytes = limit + offset;
    const result = await run("x".repeat(targetBytes - baseBytes));
    const payload = payloads.at(-1)!;
    expect(encoder.encode(payload).byteLength).toBe(targetBytes);
    expect(payload.length).toBeLessThan(limit);
    if (offset > 0) {
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("256 KiB input budget");
    }
  }
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(send).toHaveBeenCalledTimes(3);
});

test.each([429, 500, 503])(
  "OpenRouter HTTP %s is never retried by either SDK retry layer",
  async (status) => {
    const fetch = vi.fn(
      async () =>
        new Response('{"error":{"message":"Synthetic failure"}}', {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await streamAgentRoute(route, context, {
      apiKey: "sk-synthetic-probe",
      fetch,
    });
    expect(result.stopReason).toBe("error");
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("legacy execution parameters are preserved and unregistered or mismatched routes fail closed", () => {
  expect(
    resolveAgentRoute({ provider: "openai", model: "gpt-6-luna" }),
  ).toMatchObject({ reasoning: "low", maxOutputTokens: 4096 });
  expect(() => resolveAgentRoute(selection)).toThrow("does not match");
  expect(() =>
    resolveAgentRoute({
      ...selection,
      route: { ...route, profile: "openai-luna-v1" },
    }),
  ).toThrow("does not match");
  expect(() =>
    newAgentRoute({ provider: "openrouter", model: "openrouter/auto" }),
  ).toThrow("supported explicit");
});

test("transport policy rejects substitutions, unsupported tools and silent fallback controls", () => {
  const body = {
    model: selection.model,
    stream: true,
    store: false,
    max_tokens: 32768,
    reasoning: { effort: "high" },
    provider: {
      only: ["openai"],
      order: ["openai"],
      allow_fallbacks: false,
      require_parameters: true,
    },
  };
  const endpoint = AGENT_ROUTE_PROFILES[route.profile].endpoint;
  for (const change of [
    { model: "openrouter/auto" },
    { models: ["openai/other"] },
    { plugins: [{ id: "web" }] },
    { reasoning: { effort: "low" } },
    { max_tokens: 4096 },
    { store: true },
    { store: undefined },
    { tools: [{ type: "function", function: { name: "run_shell" } }] },
    { provider: { ...body.provider, allow_fallbacks: true } },
    { provider: { ...body.provider, require_parameters: false } },
    { provider: { ...body.provider, only: ["azure"] } },
  ])
    expect(() =>
      assertAgentTransport(route, endpoint, {
        method: "POST",
        body: JSON.stringify({ ...body, ...change }),
      }),
    ).toThrow("transport policy");
  expect(() =>
    assertAgentTransport(route, "https://untrusted.invalid", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ).toThrow("destination");
});
