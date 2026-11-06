import type { Job } from "./model";

export type MeetingAccountingSummary = {
  /** Provider-reported request charges in USD. Null means no complete total. */
  reportedUsd: number | null;
  /** Pre-request estimates in USD, kept separate from reported charges. */
  estimateUsd: number | null;
  /** Number of unique submitted attempts with a provider-reported charge. */
  reportedAttempts: number;
  /** Number of unique submitted attempts with a dated estimate. */
  estimatedAttempts: number;
  /** Unique submitted attempts whose final charge is not known. */
  unknownAttempts: number;
  /** Unique submitted attempts considered by the summary. */
  submittedAttempts: number;
  /** True when any submitted attempt is unknown or duplicate records conflict. */
  incomplete: boolean;
  /** IDs with conflicting duplicate records; the conflicting amount is excluded. */
  conflictJobIds: string[];
};

function sameAccounting(a: Job, b: Job) {
  return (
    a.stage === b.stage &&
    a.pipelineId === b.pipelineId &&
    a.stepIndex === b.stepIndex &&
    a.state === b.state &&
    a.billing === b.billing &&
    a.requestId === b.requestId &&
    a.provider === b.provider &&
    a.model === b.model &&
    a.reportedCostUsd === b.reportedCostUsd &&
    a.estimateUsd === b.estimateUsd &&
    JSON.stringify(a.estimateDetails ?? null) ===
      JSON.stringify(b.estimateDetails ?? null) &&
    JSON.stringify(a.usage ?? null) === JSON.stringify(b.usage ?? null)
  );
}

/**
 * Summarize persisted job accounting without double-counting duplicate IDs.
 *
 * A duplicate with identical accounting is ignored. Conflicting records are
 * excluded from both totals and make the result incomplete so a caller cannot
 * present a misleading amount. Missing charge data also keeps the submitted
 * total incomplete. `not_submitted` jobs never contribute to submitted totals.
 */
export function summarizeMeetingAccounting(
  jobs: readonly Job[],
): MeetingAccountingSummary {
  const byId = new Map<string, Job>();
  const conflicts = new Set<string>();
  for (const job of jobs) {
    const previous = byId.get(job.id);
    if (!previous) {
      byId.set(job.id, job);
      continue;
    }
    if (!sameAccounting(previous, job)) conflicts.add(job.id);
  }

  let reported = 0;
  let estimates = 0;
  let reportedAttempts = 0;
  let estimatedAttempts = 0;
  let unknownAttempts = 0;
  let submittedAttempts = 0;
  for (const job of byId.values()) {
    if (job.billing === "not_submitted") continue;
    submittedAttempts += 1;
    if (conflicts.has(job.id)) {
      unknownAttempts += 1;
      continue;
    }
    if (job.reportedCostUsd != null) {
      reported += job.reportedCostUsd;
      reportedAttempts += 1;
    } else {
      unknownAttempts += 1;
    }
    if (job.estimateDetails && job.estimateUsd != null) {
      estimates += job.estimateUsd;
      estimatedAttempts += 1;
    }
  }

  return {
    reportedUsd: reportedAttempts ? reported : null,
    estimateUsd: estimatedAttempts ? estimates : null,
    reportedAttempts,
    estimatedAttempts,
    unknownAttempts,
    submittedAttempts,
    incomplete: conflicts.size > 0 || unknownAttempts > 0,
    conflictJobIds: [...conflicts],
  };
}

// Short alias for callers that already have the meeting-level context.
export const summarizeJobAccounting = summarizeMeetingAccounting;
