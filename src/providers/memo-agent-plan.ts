import {
  id,
  MAX_JOBS,
  MAX_MEETING_JSON_BYTES,
  memoSnapshotSegments,
  type Meeting,
  type MemoAgentPlan,
} from "../domain/model";
import {
  MEMO_AGENT_MAX_TOOLS_PER_RESPONSE,
  MEMO_AGENT_MAX_RANGE_SEGMENTS,
  MEMO_AGENT_MAX_CALL_ID_LENGTH,
  MEMO_AGENT_MAX_TOOL_NAME_LENGTH,
  MEMO_AGENT_MODEL,
  MEMO_AGENT_RECORD_BYTES,
  MEMO_AGENT_TOOL_BYTES,
} from "../domain/memo-agent-contract";
import type { MemoOutputLanguage } from "../domain/memo-language";
import type { Selection } from "./credentials";

const encoder = new TextEncoder();
export const supportsAgentMemo = (selection: Selection) =>
  selection.provider === "openai" && selection.model === MEMO_AGENT_MODEL;

/** Reserve the next response, both final note copies and one bounded tool burst. */
export function agentStorageReserve() {
  // A JSON record can double when embedded as a string. Two final note copies
  // can each use the response size, plus citation/revision and item metadata.
  const nextRecord = MEMO_AGENT_RECORD_BYTES * 2;
  const finalNotes = MEMO_AGENT_RECORD_BYTES * 2 + 1024 * 1024;
  // Arbitrary control characters can expand sixfold in JSON; source IDs are
  // bounded ASCII, and each range can consult at most 40 source revisions.
  const toolCheckpoint = 6 * (MEMO_AGENT_TOOL_BYTES + MEMO_AGENT_MAX_CALL_ID_LENGTH + MEMO_AGENT_MAX_TOOL_NAME_LENGTH) + 512;
  const consultedSources = MEMO_AGENT_MAX_RANGE_SEGMENTS * 160;
  return nextRecord + finalNotes + MEMO_AGENT_MAX_TOOLS_PER_RESPONSE * (toolCheckpoint + consultedSources) + 64 * 1024;
}

export function assertAgentStorageBudget(
  meeting: Meeting,
  reserveFuture = true,
) {
  const bytes = encoder.encode(JSON.stringify(meeting)).byteLength;
  if (
    bytes + (reserveFuture ? agentStorageReserve() : 0) >
    MAX_MEETING_JSON_BYTES
  )
    throw new Error(
      reserveFuture
        ? "This meeting record cannot safely save the next review response and notes. The next request was not sent; saved responses remain. Back up first, then preview Reduce local history in Meeting details, or use the existing memo workflow."
        : "The received response exceeds the local meeting record budget. Export the unsaved response before leaving this page.",
    );
}

export function planAgentMemo(
  meeting: Meeting,
  selection: Selection,
  outputLanguage: MemoOutputLanguage,
): MemoAgentPlan {
  if (!supportsAgentMemo(selection))
    throw new Error("Selective review currently requires OpenAI GPT-6 Luna.");
  if (!meeting.segments.some((source) => source.text.trim()))
    throw new Error("Add transcript text before planning a selective review.");
  if (
    (meeting.memoAgents?.length ?? 0) >= 30 ||
    meeting.memos.length >= 30 ||
    meeting.jobs.length >= MAX_JOBS
  )
    throw new Error(
      "Meeting history cannot retain another bounded review. Back it up before further processing.",
    );
  const plan: MemoAgentPlan = {
    id: id(),
    provider: "openai",
    model: MEMO_AGENT_MODEL,
    createdAt: new Date().toISOString(),
    sourceRevision: meeting.revision,
    outputLanguage,
    snapshot: {
      title: meeting.title,
      date: meeting.date,
      timezone: meeting.timezone,
      languages: meeting.languages,
      kind: meeting.kind,
      glossary: meeting.glossary,
      revision: meeting.revision,
      speakers: structuredClone(meeting.speakers),
      sourceRefs: meeting.segments.map(({ id, revision }) => ({
        id,
        revision,
      })),
    },
    requestLimit: null,
    jobIds: [],
    context: [],
    consulted: [],
    state: "ready",
    failure: null,
    memoId: null,
  };
  assertAgentStorageBudget(
    {
      ...meeting,
      schemaVersion: 2,
      memoAgents: [...(meeting.memoAgents ?? []), plan],
    },
  );
  return plan;
}

export function agentMeeting(meeting: Meeting, plan: MemoAgentPlan): Meeting {
  return {
    ...meeting,
    title: plan.snapshot.title,
    date: plan.snapshot.date,
    timezone: plan.snapshot.timezone,
    languages: plan.snapshot.languages,
    kind: plan.snapshot.kind,
    glossary: plan.snapshot.glossary,
    revision: plan.sourceRevision,
    segments: memoSnapshotSegments(meeting, plan.snapshot),
    speakers: structuredClone(plan.snapshot.speakers),
    jobs: [],
    memos: [],
    runs: [],
    history: [],
    undo: [],
    memoPipelines: [],
    memoAgents: [],
  };
}

export function resumableAgentMemo(
  meeting: Meeting,
  selection: Selection,
): MemoAgentPlan | undefined {
  return [...(meeting.memoAgents ?? [])]
    .reverse()
    .find(
      (plan) =>
        plan.state !== "completed" &&
        plan.sourceRevision === meeting.revision &&
        plan.provider === selection.provider &&
        plan.model === selection.model,
    );
}
