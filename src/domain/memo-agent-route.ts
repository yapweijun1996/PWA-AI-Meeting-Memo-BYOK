import { z } from "zod";
import { MEMO_AGENT_MODEL } from "./memo-agent-contract";

/** Versioned, explicit routes. No price ranking or automatic model/provider fallback. */
export const AGENT_ROUTE_PROFILES = {
  "openai-luna-v1": {
    provider: "openai",
    model: MEMO_AGENT_MODEL,
    api: "openai-responses",
    endpoint: "https://api.openai.com/v1/responses",
    upstream: null,
  },
  "openrouter-luna-v1": {
    provider: "openrouter",
    model: `openai/${MEMO_AGENT_MODEL}`,
    api: "openai-completions",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    upstream: "openai",
  },
} as const;

export const AgentRouteSchema = z
  .object({
    version: z.literal(1),
    profile: z.enum(["openai-luna-v1", "openrouter-luna-v1"]),
    reasoning: z.enum(["low", "medium", "high"]),
    maxOutputTokens: z.union([
      z.literal(4096),
      z.literal(16384),
      z.literal(32768),
    ]),
  })
  .strict();
export type AgentRoute = z.infer<typeof AgentRouteSchema>;
type Selection = { provider: string; model: string };

export function agentRouteProfile(selection: Selection) {
  return (Object.keys(AGENT_ROUTE_PROFILES) as AgentRoute["profile"][]).find(
    (id) => {
      const profile = AGENT_ROUTE_PROFILES[id];
      return (
        profile.provider === selection.provider &&
        profile.model === selection.model
      );
    },
  );
}

export function newAgentRoute(selection: Selection): AgentRoute {
  const profile = agentRouteProfile(selection);
  if (!profile)
    throw new Error(
      "Pi review requires a supported explicit model route. Choose a supported model in Settings.",
    );
  return { version: 1, profile, reasoning: "high", maxOutputTokens: 32768 };
}

/** Old saved OpenAI plans retain their exact execution parameters when resumed. */
export function resolveAgentRoute(
  plan: Selection & { route?: AgentRoute },
): AgentRoute {
  const route = plan.route
    ? AgentRouteSchema.parse(plan.route)
    : {
        version: 1 as const,
        profile: "openai-luna-v1" as const,
        reasoning: "low" as const,
        maxOutputTokens: 4096 as const,
      };
  const profile = AGENT_ROUTE_PROFILES[route.profile];
  if (
    profile.provider !== plan.provider ||
    profile.model !== plan.model ||
    (!plan.route && plan.provider !== "openai")
  )
    throw new Error(
      "The saved Pi model route does not match its provider and model.",
    );
  return route;
}
