import { sampleMeeting, validateMeeting, type Job } from "../../src/domain/model";
import { planAgentMemo } from "../../src/providers/memo-agent-plan";
import { recordAgentAssistant } from "../../src/providers/agent-record";

/** Synthetic restored checkpoints only; no provider response or private transcript. */
export function agentLocalFinalFixture({ attempts = 100, fullHistory = false, invalid = false, provider = "openai" as "openai" | "openrouter" } = {}) {
  const meeting = sampleMeeting();
  const plan = planAgentMemo(meeting, { provider, model: provider === "openai" ? "gpt-6-luna" : "openai/gpt-6-luna" }, "en");
  const now = new Date().toISOString();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const base = { role: "assistant" as const, api: provider === "openai" ? "openai-responses" as const : "openai-completions" as const, provider, model: plan.model, timestamp: 1, usage };
  const records = [
    recordAgentAssistant({ ...base, stopReason: "toolUse", content: [{ type: "toolCall", id: "local-range", name: "read_transcript_range", arguments: { startIndex: 0, count: 1 } }] }, ""),
    recordAgentAssistant({ ...base, stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ items: [{ type: "summary", text: "Recovered from saved evidence.", owner_speaker_id: null, due_date: null, due_original: null, source_segment_ids: [meeting.segments[invalid ? 1 : 0].id] }] }) }] }, ""),
  ];
  const jobs: Job[] = Array.from({ length: attempts }, (_, index) => ({
    id: crypto.randomUUID(), agentId: plan.id, stage: "memo", state: index < attempts - 2 ? "outcome_unknown" : "completed",
    billing: "possibly_charged", provider: plan.provider, model: plan.model, outputLanguage: plan.outputLanguage,
    createdAt: now, updatedAt: now, inputRevision: meeting.revision, stepIndex: index, requestId: null,
    message: "Synthetic saved attempt", ...(index >= attempts - 2 ? { assistantRecord: records[index - (attempts - 2)] } : {}),
  }));
  plan.jobIds = jobs.map(job => job.id);
  plan.context = jobs.slice(-2).map(job => ({ kind: "assistant", jobId: job.id }));
  plan.state = "paused";
  const original = { id: crypto.randomUUID(), type: "summary" as const, text: "Original draft.", review: "pending" as const, ownerId: null, dueDate: null, dueOriginal: null, sources: [{ id: meeting.segments[0].id, revision: 1 }] };
  const existingMemo = { id: crypto.randomUUID(), createdAt: now, sourceRevision: 1, model: "synthetic", originalItems: [original], items: [{ ...original, text: "Protected human edit.", review: "edited" as const }] };
  if (fullHistory) jobs.push(...Array.from({ length: 400 - jobs.length }, (): Job => ({ id: crypto.randomUUID(), stage: "speech", state: "completed", billing: "unknown", inputRevision: 1, createdAt: now, updatedAt: now, requestId: null, message: "Synthetic history" })));
  return validateMeeting({ ...meeting, schemaVersion: 2, jobs, memoAgents: [plan], memos: [existingMemo], runs: fullHistory ? Array.from({ length: 30 }, () => ({ id: crypto.randomUUID(), provider: "synthetic", model: "synthetic", createdAt: now, speakers: [], originalSegments: [] })) : [] });
}
