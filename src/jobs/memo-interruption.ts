import type { Meeting } from "../domain/model";

export function markInterruptedRequests(meeting: Meeting): Meeting {
  const unfinished = meeting.jobs.filter(job => job.state === "in_flight");
  return {
    ...meeting,
    memoPipelines: meeting.memoPipelines?.map(plan => unfinished.some(job => job.pipelineId === plan.id)
      ? { ...plan, state: "blocked" } : plan),
    memoAgents: meeting.memoAgents?.map(plan => unfinished.some(job => job.agentId === plan.id)
      ? { ...plan, state: "blocked" } : plan),
    jobs: meeting.jobs.map(job => job.state === "in_flight" ? {
      ...job,
      state: "outcome_unknown",
      billing: "possibly_charged",
      message: "Manually marked interrupted. Review the provider account before retrying.",
    } : job),
  };
}
