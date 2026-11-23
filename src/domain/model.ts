import { MEMO_TEMPLATES } from "./memo-templates";
import { MEMO_OUTPUT_LANGUAGES } from "./memo-language";
import { z } from "zod";
import {AgentContextItemSchema, MEMO_AGENT_LEGACY_REQUEST_LIMIT, MEMO_AGENT_MAX_REQUESTS, MEMO_AGENT_MAX_TOOLS_PER_RESPONSE, MEMO_AGENT_RECORD_BYTES} from "./memo-agent-contract";
import { AgentRouteSchema, resolveAgentRoute } from "./memo-agent-route";
import { ReferenceVideoSchema, type ReferenceVideo } from "./reference-video";
import { OverlapEvidenceSchema } from "./overlap-evidence";
// A synthesis can cite up to five extraction facts, each with up to 100 sources.
export const MAX_MEMO_ITEM_SOURCES = 500;
export const MAX_JOBS = 400;
export const MAX_MEMO_DUE_QUOTE_CHARS = 200;
export const id = () => crypto.randomUUID();
export const localDate = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const key = z.string().uuid();
const uuidPattern = z.regexes.uuid();
const chunkIdPattern = /^part-\d+:[A-Za-z0-9_-]+(?::\d+)?$/;
const transcriptId = z.string().max(100).refine(value =>
  value.startsWith("part-") ? chunkIdPattern.test(value) : uuidPattern.test(value),
);
const text = z.string().max(20000);
const time = z.number().finite().nonnegative().nullable();
export const SegmentSchema = z
  .object({
    id: transcriptId,
    revision: z.number().int().positive(),
    start: time,
    end: time,
    speakerIds: z.array(transcriptId).max(10),
    originalText: text,
    text,
    reviewed: z.boolean(),
    parents: z.array(z.string().max(100)).max(20),
  })
  .strict()
  .refine(
    (s) =>
      (s.start === null && s.end === null) ||
      (s.start !== null && s.end !== null && s.end > s.start),
    "Invalid time range",
  );
export const SpeakerSchema = z
  .object({
    id: transcriptId,
    name: z.string().min(1).max(80),
    confirmed: z.boolean(),
    sourceLabels: z.array(z.string().max(160)).max(100),
  })
  .strict();
export const MemoItemSchema = z
  .object({
    id: key,
    type: z.enum([
      "summary",
      "discussion",
      "decision",
      "action",
      "question",
      "risk",
    ]),
    text,
    clientText: z.string().max(2000).optional(),
    factStatus: z.enum(["proposed","confirmed","pending"]).optional(),
    ownerId: transcriptId.nullable(),
    dueDate: z.string().max(80).nullable(),
    dueOriginal: z.string().max(MAX_MEMO_DUE_QUOTE_CHARS).nullable(),
    sources: z
      .array(
        z.object({ id: transcriptId, revision: z.number().int().positive() }).strict(),
      )
      .min(1)
      .max(MAX_MEMO_ITEM_SOURCES),
    review: z.enum(["pending", "accepted", "rejected", "edited"]),
    reviewedRevision: z.number().int().positive().nullable().optional(),
  })
  .strict();
const SpeakerLinkSchema = z.object({
  fromSpeakerId: z.string().min(1).max(100),
  toSpeakerId: z.string().min(1).max(100),
  sharedWords: z.number().int().min(1),
  share: z.number().finite().min(0).max(1),
}).strict();
/**
 * A person's judgement, made by listening, that two current speakers are
 * different people. Review metadata, not transcript content: it constrains
 * automatic voice matching and hides the pair from voice hints. A confirmed
 * speaker already states "these passages are one person", so only "different"
 * needs a record.
 */
const VoiceDecisionSchema = z.object({
  firstSpeakerId: z.string().min(1).max(160),
  secondSpeakerId: z.string().min(1).max(160),
  decision: z.literal("different"),
  decidedAt: z.string().max(40),
}).strict();
const SnapshotSchema = z
  .object({
    title: z.string().min(1).max(160),
    date: z.string().max(20),
    timezone: z.string().max(80),
    speakers: z.array(SpeakerSchema).max(100),
    segments: z.array(SegmentSchema).max(20000),
    speakerLinks: z.array(SpeakerLinkSchema).max(200).optional(),
    voiceDecisions: z.array(VoiceDecisionSchema).max(500).optional(),
  })
  .strict();
export const JobSchema = z
  .object({
    id: key,
    stage: z.enum(["speech", "memo"]),
    state: z.enum([
      "in_flight",
      "completed",
      "outcome_unknown",
      "failed_before_send",
      "failed",
    ]),
    billing: z.enum([
      "not_submitted",
      "possibly_charged",
      "provider_reported",
      "unknown",
    ]),
    createdAt: z.string(),
    updatedAt: z.string(),
    requestId: z.string().max(200).nullable(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        seconds: z.number().nonnegative().nullable(),
        cachedInputTokens: z.number().int().nonnegative().nullable().optional(),
        cacheWriteTokens: z.number().int().nonnegative().nullable().optional(),
        totalTokens: z.number().int().nonnegative().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    estimateUsd: z.number().nonnegative().nullable().optional(),
    estimateDetails: z
      .object({
        rate: z.number().finite().nonnegative(),
        seconds: z.number().finite().nonnegative(),
        source: z.string().min(1).max(300),
        date: z.iso.date(),
      })
      .strict()
      .nullable()
      .optional(),
    provider: z.enum(["openai", "openrouter"]).optional(),
    model: z.string().min(1).max(100).optional(),
    upstreamProvider: z.string().min(1).max(80).optional(),
    reportedCostUsd: z.number().finite().nonnegative().nullable().optional(),
    message: z.string().max(1000),
    inputRevision: z.number().int().positive(),
    chunk: z
      .object({
        index: z.number().int().nonnegative(),
        total: z.number().int().positive(),
      })
      .strict()
      .optional(),
    outputLanguage: z.enum(MEMO_OUTPUT_LANGUAGES).optional(),
    pipelineId: key.optional(),
    agentId: key.optional(),
    memoResponse: z.string().optional(),
    assistantRecord: z.string().max(MEMO_AGENT_RECORD_BYTES).optional(),
    stepIndex: z.number().int().min(0).max(MAX_JOBS - 1).optional(),
    contextual: z.object({
      action: z.enum(["simplify", "rewrite", "shorten"]),
      memoId: key,
      itemId: key,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      originalText: text,
      selectedText: z.string().min(1).max(4000),
      sourceRevision: z.number().int().positive(),
      sources: z.array(z.object({ id: transcriptId, revision: z.number().int().positive() }).strict()).min(1).max(MAX_MEMO_ITEM_SOURCES),
      suggestion: z.string().max(8000).nullable(),
    }).strict().refine(value => value.end > value.start && value.end <= value.originalText.length && value.selectedText.trim().length > 0 && value.originalText.slice(value.start, value.end) === value.selectedText, "Invalid contextual selection." ).optional(),
  })
  .strict()
  .refine(job => job.agentId !== undefined || job.stepIndex === undefined || job.stepIndex <= 8, "Only agent jobs may exceed pipeline step 8.");
const PipelineSnapshotSchema = SnapshotSchema.extend({
  revision: z.number().int().positive(),
  languages: z.string().max(100),
  kind: z.enum(["general", "erp"]),
  glossary: z.string().max(2000),
}).strict();
const ReferencedPipelineSnapshotSchema = PipelineSnapshotSchema.omit({segments: true}).extend({
  sourceRefs: z.array(z.object({id: transcriptId, revision: z.number().int().positive()}).strict()).min(1).max(20000),
}).strict();
export const MemoAgentPlanSchema = z.object({
  id: key, provider: z.enum(["openai", "openrouter"]), model: z.string().min(1).max(100),
  template: z.enum(MEMO_TEMPLATES).optional(),
  route: AgentRouteSchema.optional(),
  createdAt: z.iso.datetime(), sourceRevision: z.number().int().positive(),
  outputLanguage: z.enum(MEMO_OUTPUT_LANGUAGES), snapshot: ReferencedPipelineSnapshotSchema,
  requestLimit: z.union([z.literal(MEMO_AGENT_LEGACY_REQUEST_LIMIT), z.literal(MEMO_AGENT_MAX_REQUESTS)]).nullable(), jobIds: z.array(key).max(MAX_JOBS),
  context: z.array(AgentContextItemSchema).max(MAX_JOBS * (2 + MEMO_AGENT_MAX_TOOLS_PER_RESPONSE)),
  consulted: z.array(z.object({id: transcriptId, revision: z.number().int().positive()}).strict()).max(20000),
  state: z.enum(["ready", "running", "paused", "blocked", "completed"]),
  failure: z.object({kind: z.enum(["request", "limit", "result", "storage"]), message: z.string().max(500)}).strict().nullable(),
  memoId: key.nullable(),
}).strict();
export const MemoPipelineSchema = z
  .object({
    id: key,
    provider: z.enum(["openai", "openrouter"]),
    model: z.string().min(1).max(100),
    createdAt: z.string(),
    sourceRevision: z.number().int().positive(),
    outputLanguage: z.enum(MEMO_OUTPUT_LANGUAGES).optional(),
    template: z.enum(MEMO_TEMPLATES).optional(),
    snapshot: z.union([PipelineSnapshotSchema, ReferencedPipelineSnapshotSchema]),
    state: z.enum(["ready", "running", "paused", "blocked", "completed"]),
    chunks: z.array(z.array(transcriptId).min(1).max(20000)).min(1).max(8),
    results: z
      .array(
        z
          .object({
            items: z.array(MemoItemSchema).min(1).max(100),
            quotes: z
              .array(
                z
                  .object({
                    id: transcriptId,
                    revision: z.number().int().positive(),
                    text: z.string().max(20000),
                  })
                  .strict(),
              )
              .max(10000),
          })
          .strict()
          .nullable(),
      )
      .max(8),
    memoId: key.nullable(),
  })
  .strict();
/**
 * Largest meeting record, as JSON, that the app will create or restore. One source of
 * truth for the memo plan, contextual suggestions, memo review writes and backup import.
 * IndexedDB itself can hold far more; the limit exists because a meeting is saved,
 * exported and restored as one JSON document held in memory. A JavaScript string tops
 * out near 512 MiB in Chromium and a backup is read whole, so this stays well below that.
 * Raised from 10/12 MiB on 2026-11-16: a 60-minute word-level transcript (12,584 passages)
 * reaches about 14 MiB once it has a provider run, an undo copy, a history copy and a memo plan.
 */
export const MAX_MEETING_JSON_BYTES = 64 * 1024 * 1024;
const ChunkedAudioSchema = z.object({
  format: z.enum(["mp3", "mp4"]),
  chunkCount: z.number().int().min(1).max(2000),
  totalSeconds: z.number().finite().positive(),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const AudioSchema = z.object({
  name: z.string().max(255),
  type: z.string().max(100),
  size: z.number().int().positive().max(4 * 1024 * 1024 * 1024),
  duration: z.number().nonnegative().nullable(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  present: z.boolean(),
  chunked: ChunkedAudioSchema.optional(),
  overlapEvidence: OverlapEvidenceSchema.optional(),
}).strict().superRefine((audio, context) => {
  const evidence = audio.overlapEvidence;
  if (evidence && (audio.hash !== evidence.audioSha256 || audio.duration === null ||
      (evidence.intervals.at(-1)?.end ?? Infinity) > audio.duration))
    context.addIssue({ code: "custom", message: "Overlap evidence must match the source recording and its duration." });
  if (audio.chunked && (audio.hash !== audio.chunked.manifestSha256 || audio.duration !== audio.chunked.totalSeconds)) {
    context.addIssue({ code: "custom", message: "Chunked audio metadata does not match its manifest." });
  }
});

export const MeetingSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    memoPipelines: z.array(MemoPipelineSchema).max(30).optional(),
    memoAgents: z.array(MemoAgentPlanSchema).max(30).optional(),
    version: z.number().int().nonnegative(),
    id: key,
    title: z.string().min(1).max(160),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(80),
    languages: z.string().max(100),
    attendees: z.array(z.string().max(80)).max(30),
    glossary: z.string().max(2000),
    kind: z.enum(["general", "erp"]),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: z.number().int().positive(),
    synthetic: z.boolean(),
    referenceVideo: ReferenceVideoSchema.nullable().optional(),
    speakerLinks: z.array(SpeakerLinkSchema).max(200).optional(),
    voiceDecisions: z.array(VoiceDecisionSchema).max(500).optional(),
    speakers: z.array(SpeakerSchema).max(100),
    segments: z.array(SegmentSchema).max(20000),
    history: z.array(SegmentSchema).max(100000),
    undo: z.array(SnapshotSchema).max(20),
    memos: z
      .array(
        z
          .object({
            id: key,
            createdAt: z.string(),
            sourceRevision: z.number().int().positive(),
            model: z.string().max(100),
            items: z.array(MemoItemSchema).max(500),
            template: z.enum(MEMO_TEMPLATES).optional(),
            externalCopy: z.string().max(20000).optional(),
            originalItems: z.array(MemoItemSchema).max(500).optional(),
            restoredFrom: key.optional(),
            reviewCompletion: z.object({
              kind: z.enum(["all", "priority"]),
              itemIds: z.array(key).min(1).max(500),
              sourceRevision: z.number().int().positive(),
              completedAt: z.string().max(80),
              fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
              reviewed: z.number().int().nonnegative().max(500),
              pending: z.number().int().nonnegative().max(500),
            }).strict().optional(),
            editUndo: z.array(z.object({ before: MemoItemSchema, after: MemoItemSchema }).strict()).max(10).optional(),
          })
          .strict(),
      )
      .max(30),
    jobs: z.array(JobSchema).max(MAX_JOBS),
    audio: AudioSchema.nullable(),
    runs: z
      .array(
        z
          .object({
            id: key,
            provider: z.string().max(80),
            model: z.string().max(100),
            createdAt: z.string(),
            speakers: z.array(SpeakerSchema).max(100).default([]),
            originalSegments: z.array(SegmentSchema).max(20000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type Meeting = z.infer<typeof MeetingSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type VoiceDecision = z.infer<typeof VoiceDecisionSchema>;
export type MemoItem = z.infer<typeof MemoItemSchema>;
export type Job = z.infer<typeof JobSchema>;
export type MemoAgentPlan = z.infer<typeof MemoAgentPlanSchema>;
export type { ReferenceVideo };
export const ref = (s: { id: string; revision: number }) =>
  `${s.id}:${s.revision}`;
export function serializeSegmentEvidence({ reviewed: _reviewed, ...evidence }: Segment): string {
  return JSON.stringify(evidence);
}
/** Resolve saved plan references against immutable current/history revisions, including legacy copies. */
export function pipelineSourceSegments(m: Meeting, pipeline: NonNullable<Meeting["memoPipelines"]>[number]): Segment[] {
  return memoSnapshotSegments(m, pipeline.snapshot);
}
export function memoSnapshotSegments(m: Meeting, snapshot: z.infer<typeof PipelineSnapshotSchema> | z.infer<typeof ReferencedPipelineSnapshotSchema>): Segment[] {
  if ("segments" in snapshot) return snapshot.segments;
  const evidence = new Map([...m.history, ...m.segments].map(source => [ref(source), source]));
  return resolveSnapshotReferences(evidence, snapshot.sourceRefs);
}
function resolveSnapshotReferences(evidence: ReadonlyMap<string, Segment>, sourceRefs: { id: string; revision: number }[]): Segment[] {
  return sourceRefs.map(source => {
    const segment = evidence.get(ref(source));
    if (!segment) throw new Error("Pipeline sources do not match meeting evidence.");
    return segment;
  });
}

/** Out-of-order history remains restorable for inspection, but cannot authorize replay. */
export function agentContextOrderWarning(plan: MemoAgentPlan): string | undefined {
  const steps = new Map(plan.jobIds.map((jobId, index) => [jobId, index]));
  let previous = -1;
  for (const item of plan.context) {
    if (item.kind !== "assistant") continue;
    const step = steps.get(item.jobId);
    if (step === undefined || step <= previous)
      return "The saved assistant history conflicts with the recorded provider attempt order. Its responses can still be exported.";
    previous = step;
  }
}

export function validateMeeting(value: unknown): Meeting {
  const parsed = MeetingSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Meeting data is invalid or uses an unsupported format. Check the title, date, time ranges, and import file.",
    );
  const m = parsed.data;
  new Intl.DateTimeFormat("en", { timeZone: m.timezone }).format();
  if (new Date(`${m.date}T12:00:00Z`).toISOString().slice(0, 10) !== m.date)
    throw new Error("Invalid meeting date");
  const speakerIds = new Set(m.speakers.map((s) => s.id));
  if (
    speakerIds.size !== m.speakers.length ||
    new Set(m.segments.map((s) => s.id)).size !== m.segments.length
  )
    throw new Error("Duplicate record ID");
  if (m.segments.some((s) => s.speakerIds.some((x) => !speakerIds.has(x))))
    throw new Error("Unknown speaker reference");
  const evidence = new Map<string, Segment>();
  for (const source of [...m.history, ...m.segments]) {
    const revisionKey = ref(source);
    const previous = evidence.get(revisionKey);
    if (previous && serializeSegmentEvidence(previous) !== serializeSegmentEvidence(source))
      throw new Error("Conflicting evidence revisions");
    evidence.set(revisionKey, source);
  }
  if (m.memos.some(v => (v.editUndo ?? []).some(entry => entry.before.id !== entry.after.id || !v.items.some(item => item.id === entry.before.id) || [...entry.before.sources, ...entry.after.sources].some(source => !evidence.has(ref(source))))))
    throw new Error("Invalid memo edit undo history.");
  if (m.jobs.some(job => job.contextual && job.stage !== "memo")) throw new Error("Contextual jobs require the memo stage.");
  if (m.schemaVersion === 1 && (m.memos.some(v => v.reviewCompletion || v.editUndo || v.restoredFrom) || m.jobs.some(job => job.contextual)))
    throw new Error("Memo review data requires meeting schema version 2.");
  if (
    m.memos.some((v) =>
      [...v.items, ...(v.originalItems || [])].some((i) =>
        i.sources.some((s) => !evidence.has(ref(s))),
      ),
    )
  )
    throw new Error("Unresolved memo evidence");
  if (m.schemaVersion === 1 && m.memoPipelines !== undefined)
    throw new Error("Pipeline data requires meeting schema version 2.");
  if (m.schemaVersion === 1 && m.memoAgents !== undefined)
    throw new Error("Agent memo data requires meeting schema version 2.");
  const agents = new Map((m.memoAgents ?? []).map(plan => [plan.id, plan]));
  if (agents.size !== (m.memoAgents?.length ?? 0)) throw new Error("Duplicate memo agent identity.");
  for (const job of m.jobs) {
    if (job.assistantRecord !== undefined && !job.agentId) throw new Error("Unresolved agent response.");
    if (job.agentId && (job.stage !== "memo" || job.pipelineId || job.contextual || !agents.has(job.agentId))) throw new Error("Unresolved memo agent job.");
  }
  for (const plan of agents.values()) {
    resolveAgentRoute(plan);
    new Intl.DateTimeFormat("en", {timeZone: plan.snapshot.timezone}).format();
    if (plan.sourceRevision !== plan.snapshot.revision || !/^\d{4}-\d{2}-\d{2}$/.test(plan.snapshot.date) || new Date(`${plan.snapshot.date}T12:00:00Z`).toISOString().slice(0,10) !== plan.snapshot.date)
      throw new Error("Invalid agent source snapshot.");
    const sources = resolveSnapshotReferences(evidence, plan.snapshot.sourceRefs);
    const sourceRefs = new Set(sources.map(ref));
    const labels = new Set(plan.snapshot.speakers.map(speaker => speaker.id));
    if (labels.size !== plan.snapshot.speakers.length || new Set(sources.map(source => source.id)).size !== sources.length || sources.some(source => source.speakerIds.some(id => !labels.has(id))))
      throw new Error("Invalid agent source references.");
    if (new Set(plan.consulted.map(ref)).size !== plan.consulted.length || plan.consulted.some(source => !sourceRefs.has(ref(source))))
      throw new Error("Invalid consulted source references.");
    if (new Set(plan.jobIds).size !== plan.jobIds.length) throw new Error("Duplicate agent job reference.");
    for (const [index, jobId] of plan.jobIds.entries()) {
      const jobs = m.jobs.filter(job => job.id === jobId);
      if (jobs.length !== 1 || jobs[0].agentId !== plan.id || jobs[0].stepIndex !== index || jobs[0].provider !== plan.provider || jobs[0].model !== plan.model || jobs[0].inputRevision !== plan.sourceRevision || jobs[0].outputLanguage !== plan.outputLanguage)
        throw new Error("Invalid agent job checkpoint.");
    }
    if (m.jobs.some(job => job.agentId === plan.id && !plan.jobIds.includes(job.id))) throw new Error("Unreferenced agent job.");
    const assistantIds = plan.context.filter(item => item.kind === "assistant").map(item => item.jobId);
    if (new Set(assistantIds).size !== assistantIds.length || assistantIds.some(jobId => !plan.jobIds.includes(jobId) || !m.jobs.some(job => job.id === jobId && job.state === "completed" && job.assistantRecord !== undefined)))
      throw new Error("Unresolved agent context.");
    if (plan.state === "completed" && (!plan.memoId || !m.memos.some(memo => memo.id === plan.memoId && memo.template === plan.template && memo.sourceRevision === plan.sourceRevision)))
      throw new Error("Invalid completed agent memo.");
  }
  if (
    new Set((m.memoPipelines ?? []).map((p) => p.id)).size !==
    (m.memoPipelines?.length ?? 0)
  )
    throw new Error("Duplicate pipeline identity.");
  for (const pipeline of m.memoPipelines ?? []) {
    new Intl.DateTimeFormat("en", {
      timeZone: pipeline.snapshot.timezone,
    }).format();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(pipeline.snapshot.date) ||
      new Date(`${pipeline.snapshot.date}T12:00:00Z`)
        .toISOString()
        .slice(0, 10) !== pipeline.snapshot.date
    )
      throw new Error("Invalid pipeline meeting date.");
    const snapshotSegments = "segments" in pipeline.snapshot
      ? pipeline.snapshot.segments
      : resolveSnapshotReferences(evidence, pipeline.snapshot.sourceRefs);
    const labels = new Set(pipeline.snapshot.speakers.map((s) => s.id));
    if (
      labels.size !== pipeline.snapshot.speakers.length ||
      snapshotSegments.some((s) =>
        s.speakerIds.some((id) => !labels.has(id)),
      )
    )
      throw new Error("Invalid pipeline speaker reference.");
    const captured = new Map(
      snapshotSegments.map((s) => [ref(s), s]),
    );
    if (
      "segments" in pipeline.snapshot && snapshotSegments.some(source => {
        const original = evidence.get(ref(source));
        return !original || serializeSegmentEvidence(original) !== serializeSegmentEvidence(source);
      })
    )
      throw new Error("Pipeline sources do not match meeting evidence.");
    if (
      pipeline.sourceRevision !== pipeline.snapshot.revision ||
      pipeline.results.length !== pipeline.chunks.length
    )
      throw new Error("Invalid memo pipeline checkpoint.");
    if (
      pipeline.state === "completed" &&
      (!pipeline.memoId ||
        pipeline.results.some((r) => !r) ||
        !m.memos.some(
          (v) =>
            v.id === pipeline.memoId && v.template === pipeline.template &&
            v.sourceRevision === pipeline.sourceRevision,
        ))
    )
      throw new Error("Invalid completed memo pipeline.");
    if (
      new Set(snapshotSegments.map((s) => s.id)).size !==
      snapshotSegments.length
    )
      throw new Error("Duplicate pipeline source ID.");
    const core = pipeline.chunks.flat();
    if (
      core.length !== snapshotSegments.length ||
      core.some((v, i) => v !== snapshotSegments[i].id)
    )
      throw new Error("Invalid pipeline source coverage.");
    for (const result of pipeline.results) {
      if (!result) continue;
      for (const item of result.items)
        if (item.sources.some((s) => !captured.has(ref(s))))
          throw new Error("Invalid extraction source.");
      for (const quote of result.quotes)
        if (captured.get(ref(quote))?.text !== quote.text)
          throw new Error("Invalid extraction quote.");
    }
  }
  return { ...m, schemaVersion: 2 };
}
export function createMeeting(
  values: Partial<
    Pick<
      Meeting,
      | "title"
      | "date"
      | "timezone"
      | "languages"
      | "attendees"
      | "glossary"
      | "kind"
    >
  > = {},
): Meeting {
  const now = new Date().toISOString();
  return validateMeeting({
    schemaVersion: 1,
    version: 0,
    id: id(),
    title: "Untitled meeting",
    date: localDate(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    languages: "Chinese, English",
    attendees: [],
    glossary: "",
    kind: "general",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    synthetic: false,
    referenceVideo: null,
    speakers: [],
    segments: [],
    history: [],
    undo: [],
    memos: [],
    jobs: [],
    audio: null,
    runs: [],
    ...values,
  });
}
export function segment(
  text: string,
  speakerIds: string[] = [],
  start: number | null = null,
  end: number | null = null,
): Segment {
  return {
    id: id(),
    revision: 1,
    start,
    end,
    speakerIds,
    text,
    originalText: text,
    reviewed: false,
    parents: [],
  };
}
export function importTranscript(input: string): {
  speakers: Speaker[];
  segments: Segment[];
} {
  if (input.length > 2_000_000)
    throw new Error("Transcript is too large (2 MB text limit).");
  const names = new Map<string, string>();
  const segments: Segment[] = [];
  for (const line of input
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const match = line.match(/^([^:\n]{1,60}):\s+(.+)$/);
    if (match) {
      const name = match[1];
      if (!names.has(name)) names.set(name, id());
      segments.push(segment(match[2], [names.get(name)!]));
    } else segments.push(segment(line));
  }
  if (!segments.length) throw new Error("Add at least one transcript line.");
  return {
    speakers: [...names].map(([name, id]) => ({
      id,
      name,
      confirmed: false,
      sourceLabels: ["text-import"],
    })),
    segments,
  };
}
export function sampleMeeting(): Meeting {
  const m = createMeeting({
    title: "ERP workflow discovery",
    kind: "erp",
    attendees: ["Jamie", "Alex"],
  });
  const data = importTranscript(
    "Jamie: The warehouse team currently checks stock in a spreadsheet before confirming an order.\nAlex: We should compare that with the inventory reservation flow before changing the process.\nJamie: I will document the current steps and bring them to our next review.\nAlex: We still need finance to confirm when the invoice should be created.\nJamie: Agreed. No change to invoice timing until finance confirms the rule.",
  );
  return { ...m, ...data, synthetic: true };
}
