import { MEMO_AGENT_MAX_REQUESTS } from "./memo-agent-contract";
import type { MemoAgentPlan } from "./model";

export const AGENT_REQUEST_LIMIT_MESSAGE = "The 100-request limit for this review was reached. Saved responses remain available; no new request was sent.";

/** The validated, append-only job references also count failed or interrupted attempts. */
export function remainingAgentRequests(plan: Pick<MemoAgentPlan, "jobIds">): number {
  return Math.max(0, MEMO_AGENT_MAX_REQUESTS - plan.jobIds.length);
}

/** Refresh the remaining allowance for every model turn, not just at session start. */
export function agentRequestInstruction(plan: Pick<MemoAgentPlan, "jobIds">): string {
  return `Request ${plan.jobIds.length + 1} of ${MEMO_AGENT_MAX_REQUESTS}; ${remainingAgentRequests(plan)} requests available including this request. Finish when the evidence is sufficient. If this is the final allowed request, return only a supported final memo from already consulted evidence; never invent claims to fill gaps.`;
}
