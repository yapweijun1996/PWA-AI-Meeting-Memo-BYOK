import { id, type Job, type Meeting, type MemoItem } from "../domain/model";
import { clientDraft, type MemoTemplate } from "../domain/memo-templates";
import type { MemoInput } from "../providers/memo-input";
import { captureExtraction } from "../providers/memo-plan";

export interface StandardMemoContext {
  source: Meeting;
  template?: MemoTemplate;
  prepared?: MemoInput;
}

/** Apply one validated response to the latest meeting, using the evidence sent for this step. */
export function applyStandardMemoResult(
  latest: Meeting, job: Job, context: StandardMemoContext, items: MemoItem[], pauseAfterExtraction = false,
): Meeting {
  const { source, template } = context;
  const plans = latest.memoPipelines ?? [];
  const plan = plans.find(value => value.id === job.pipelineId);
  const index = job.stepIndex;
  if (job.pipelineId && (!plan || plan.state === "completed" || index === undefined ||
      latest.jobs.filter(value => value.pipelineId === plan.id).at(-1)?.id !== job.id))
    throw new Error("The saved plan has moved on. Export this response for review.");
  if (!job.pipelineId) {
    const attemptIndex = latest.jobs.findIndex(value => value.id === job.id);
    const newerMemo = latest.jobs.slice(attemptIndex + 1).some(value => {
      if (value.stage !== "memo" || value.contextual || value.state !== "completed") return false;
      if (value.pipelineId) return plans.some(plan =>
        plan.id === value.pipelineId && plan.state === "completed" && value.stepIndex === plan.chunks.length);
      if (value.agentId) return latest.memoAgents?.some(plan =>
        plan.id === value.agentId && plan.state === "completed" && plan.jobIds.at(-1) === value.id);
      return true;
    });
    if (newerMemo)
      throw new Error("A newer memo result is already saved. Export this response for review.");
  }

  if (plan && index !== undefined && index < plan.chunks.length) {
    if (plan.results[index]) throw new Error("This extraction already has a saved result.");
    const result = captureExtraction(source, items);
    const results = plan.results.map((previous, i) => i === index ? result : previous);
    return {
      ...latest,
      memoPipelines: plans.map(value => value.id === plan.id
        ? { ...plan, state: pauseAfterExtraction ? "paused" : "running", results }
        : value),
    };
  }
  const provider = plan ? plan.provider : job.provider === "openai" ? "OpenAI" : "OpenRouter";
  const memo = {
    id: id(), createdAt: new Date().toISOString(), sourceRevision: job.inputRevision,
    model: `${provider}: ${job.model}`.slice(0, 100), items, template,
    externalCopy: clientDraft(template, items), originalItems: structuredClone(items),
  };
  const result = { ...latest, memos: [...latest.memos, memo] };
  if (plan) {
    const known = new Set([...latest.segments, ...latest.history].map(s => `${s.id}:${s.revision}`));
    result.history = [...latest.history, ...source.segments.filter(s => !known.has(`${s.id}:${s.revision}`))];
    result.memoPipelines = plans.map(value => value.id === plan.id
      ? { ...plan, memoId: memo.id, state: "completed" } : value);
  }
  return result;
}
