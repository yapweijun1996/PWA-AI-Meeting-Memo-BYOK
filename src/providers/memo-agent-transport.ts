import type {
  TranscriptContext,
  Model,
  StreamOptions,
} from "@earendil-works/pi-ai";
import {
  AGENT_ROUTE_PROFILES,
  type AgentRoute,
} from "../domain/memo-agent-route";
import {
  MEMO_AGENT_REQUEST_BYTES,
  MEMO_AGENT_TOOLS,
} from "../domain/memo-agent-contract";

export function agentModel(
  route: AgentRoute,
): Model<"openai-responses" | "openai-completions"> {
  const profile = AGENT_ROUTE_PROFILES[route.profile];
  return {
    id: profile.model,
    name: profile.model,
    api: profile.api,
    provider: profile.provider,
    baseUrl:
      profile.provider === "openai"
        ? "https://api.openai.com/v1"
        : "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text"],
    // Declared metadata retained from the original route; not a measured context envelope.
    contextWindow: 1050000,
    maxTokens: route.maxOutputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(profile.provider === "openrouter"
      ? {
          compat: {
            supportsStore: true,
            supportsDeveloperRole: true,
            supportsReasoningEffort: true,
            supportsUsageInStreaming: true,
            maxTokensField: "max_tokens" as const,
            thinkingFormat: "openrouter" as const,
            openRouterRouting: {
              only: [profile.upstream],
              order: [profile.upstream],
              allow_fallbacks: false,
              require_parameters: true,
            },
          },
        }
      : {}),
  };
}

/** Import only the selected browser transport; never the auto-discovery/CLI runtime. */
export async function streamAgentRoute(
  route: AgentRoute,
  context: TranscriptContext,
  options: StreamOptions,
) {
  const model = agentModel(route);
  const controlled = {
    ...options,
    maxRetries: 0,
    reasoningEffort: route.reasoning,
    maxTokens: route.maxOutputTokens,
  };
  if (model.api === "openai-responses") {
    const { stream } =
      await import("@earendil-works/pi-ai/api/openai-responses");
    return stream(
      { ...model, api: "openai-responses" },
      context,
      controlled,
    ).result();
  }
  const { stream } =
    await import("@earendil-works/pi-ai/api/openai-completions");
  return stream(
    { ...model, api: "openai-completions" },
    context,
    controlled,
  ).result();
}

export class AgentRequestSizeError extends Error {
  constructor() {
    super("The next request exceeds the 256 KiB input budget. No new request was sent.");
  }
}

/** Treat SDK serialization as untrusted until the final outbound payload is checked. */
export function assertAgentTransport(
  route: AgentRoute,
  input: unknown,
  init?: RequestInit,
) {
  const profile = AGENT_ROUTE_PROFILES[route.profile];
  if (
    String(input) !== profile.endpoint ||
    init?.method !== "POST" ||
    typeof init.body !== "string"
  )
    throw new Error("Unexpected review transport destination or method.");
  if (init.body.length > MEMO_AGENT_REQUEST_BYTES ||
      new TextEncoder().encode(init.body).byteLength > MEMO_AGENT_REQUEST_BYTES)
    throw new AgentRequestSizeError();
  const body = JSON.parse(init.body);
  const tools: { type: string; name?: string; function?: { name?: string } }[] =
    body.tools ?? [];
  const names = tools.map((tool) =>
    profile.provider === "openai" ? tool.name : tool.function?.name,
  );
  const common =
    body.model === profile.model &&
    body.stream === true &&
    !body.background &&
    !body.models &&
    !body.route &&
    !body.plugins &&
    !body.transforms &&
    tools.every((tool) => tool.type === "function") &&
    names.every((name) => MEMO_AGENT_TOOLS.some((allowed) => allowed === name));
  const policy =
    profile.provider === "openai"
      ? body.store === false &&
        body.reasoning?.effort === route.reasoning &&
        body.max_output_tokens === route.maxOutputTokens
      : body.store === false &&
        body.reasoning?.effort === route.reasoning &&
        body.max_tokens === route.maxOutputTokens &&
        body.provider?.allow_fallbacks === false &&
        body.provider?.require_parameters === true &&
        JSON.stringify(body.provider.only) ===
          JSON.stringify([profile.upstream]) &&
        JSON.stringify(body.provider.order) ===
          JSON.stringify([profile.upstream]) &&
        !body.provider.sort;
  if (!common || !policy)
    throw new Error("The review request failed its local transport policy.");
}
