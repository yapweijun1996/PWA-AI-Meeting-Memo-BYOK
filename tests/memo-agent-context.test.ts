import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { expect, test } from "vitest";
import { MEMO_AGENT_REQUEST_BYTES as requestBudget } from "../src/domain/memo-agent-contract";
import { AGENT_ROUTE_PROFILES, newAgentRoute } from "../src/domain/memo-agent-route";
import { streamAgentContext } from "../src/providers/memo-agent-context";
import { agentModel, AgentRequestSizeError, assertAgentTransport, streamAgentRoute } from "../src/providers/memo-agent-transport";

const timestamp = 0;
const usage: AssistantMessage["usage"] = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const bytes = (body: string) => Buffer.byteLength(body);

test.each(Object.values(AGENT_ROUTE_PROFILES))(
  "$provider keeps fitting Pi SDK requests byte-identical and compacts only oversized histories",
  async profile => {
    const route = newAgentRoute(profile);
    const model = agentModel(route);
    const toolName = "read_transcript_range";
    const tools: Tool[] = [{ name: toolName, description: "Read transcript", parameters: { type: "object", properties: { startIndex: { type: "integer" } } } }];
    const tail: Message = { role: "system", content: "Continue within the confirmed attempt ceiling.", timestamp };
    const attempt = async (messages: Message[]) => {
      let result = "";
      let overBudget = false;
      let submissions = 0;
      const context = normalizeContext({ messages: [...messages, tail] });
      await streamAgentRoute(route, context, {
        apiKey: "sk-synthetic-context-unit",
        fetch: async (url, init) => {
          result = String(init?.body);
          try {
            assertAgentTransport(route, url, init);
            submissions++;
          } catch (error) {
            if (!(error instanceof AgentRequestSizeError)) throw error;
            overBudget = true;
            throw error;
          }
          return new Response("Stopped after local serialization", { status: 400 });
        },
      });
      expect(result).toBeTruthy();
      return { result, overBudget, submissions };
    };
    const history = (seed: number): Message[] => {
      const { messages } = normalizeContext({
        systemPrompt: "Use the original review instructions.",
        tools,
        messages: [{ role: "user", content: "Frozen context: 合同 🧪 \\n", timestamp }],
      });
      const rounds = 1 + seed % 17;
      for (let index = 0; index < rounds; index++) {
        const toolCallId = profile.api === "openai-responses" ? `call_${index}|fc_${index}` : `call_${index}`;
        const excerpt = { index, text: `Source ${index}: statement\n🧪`, textOffset: 0, complete: index % 3 !== 0 };
        const excerpts = [excerpt];
        if (index === 2) {
          excerpts.push({ index: 0, text: "Concluding page", textOffset: excerpt.text.length, complete: true });
        }
        if (index === 4) {
          excerpts.push({ index: 3, text: "Tail after a gap", textOffset: excerpt.text.length + 1, complete: true });
        }
        const text = index % 5 === 1
          ? "The lookup did not complete. No evidence returned."
          : JSON.stringify({ excerpts, next: null });
        messages.push({
          role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp, usage,
          stopReason: "toolUse", content: [
            { type: "text", text: "Quoted \"合同\" 🧪".repeat((seed * 17 + index * 11) % 60) },
            { type: "toolCall", id: toolCallId, name: toolName, arguments: { startIndex: index } },
          ],
        }, {
          role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }],
          isError: index % 5 === 1, timestamp,
        });
        if (index % 7 === 2) messages.push({ role: "user", content: "Continue from the saved review.", timestamp });
      }
      return messages;
    };
    for (let seed = 0; seed < 112; seed++) {
      const messages = history(seed);
      const baseline = await attempt(messages);
      expect(baseline.overBudget).toBe(false);
      let tries = 0;
      expect(await streamAgentContext(messages, async candidate => {
        tries++;
        return attempt(candidate);
      })).toBe(baseline.result);
      expect(tries).toBe(1);
    }

    const messages = history(15);
    const prompt = messages[1];
    if (prompt.role !== "user") throw new Error("Missing initial prompt fixture");
    const assistant = messages.find(message => message.role === "assistant")!;
    if (assistant.role !== "assistant" || assistant.content[0].type !== "text")
      throw new Error("Missing assistant fixture");
    // Pad an old assistant block to hit the exact native wire limit with multibyte content.
    prompt.content += "界";
    const padding = requestBudget - bytes((await attempt(messages)).result);
    assistant.content[0].text += "x".repeat(padding);
    const exact = await attempt(messages);
    expect(bytes(exact.result)).toBe(requestBudget);
    expect(await streamAgentContext(messages, attempt)).toBe(exact.result);
    assistant.content[0].text += "x";
    expect(bytes((await attempt(messages)).result)).toBe(requestBudget + 1);
    let submissions = 0;
    const compacted = await streamAgentContext(messages, async candidate => {
      const result = await attempt(candidate);
      submissions += result.submissions;
      return result;
    });
    expect(submissions).toBe(1);
    expect(bytes(compacted)).toBeLessThanOrEqual(requestBudget);
    expect(compacted).toContain("Local context index");
    expect(compacted).toContain("Previously read passage indexes (zero-based): 0, 2, 4–5, 7. Partially read: 3.");
    expect(compacted).toContain("Continue from the saved review.");
    expect(compacted).toContain("Continue within the confirmed attempt ceiling.");
    expect(compacted).toContain("Use the original review instructions.");
    expect(compacted).not.toContain("x".repeat(100));
    expect(compacted).not.toContain("Concluding page");
    const value = JSON.parse(compacted);
    expect(value.tools).toHaveLength(1);
    if (value.input) {
      const calls = new Set(value.input.filter((item: { type: string }) => item.type === "function_call").map((item: { call_id: string }) => item.call_id));
      expect(value.input.filter((item: { type: string }) => item.type === "function_call_output").map((item: { call_id: string }) => item.call_id)).toEqual([...calls]);
    } else {
      const calls = value.messages.flatMap((item: { tool_calls?: { id: string }[] }) => item.tool_calls?.map(call => call.id) ?? []);
      expect(value.messages.filter((item: { role: string }) => item.role === "tool").map((item: { tool_call_id: string }) => item.tool_call_id)).toEqual(calls);
    }

    prompt.content += "界".repeat(requestBudget / 3);
    submissions = 0;
    const blocked = await streamAgentContext(messages, async candidate => {
      const result = await attempt(candidate);
      submissions += result.submissions;
      return result;
    });
    expect(submissions).toBe(0);
    expect(bytes(blocked)).toBeGreaterThan(requestBudget);
  },
);
