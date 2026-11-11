import { z } from "zod";
import { ReferenceVideoSchema, type ReferenceVideo } from "./reference-video";
export const id = () => crypto.randomUUID();
export const localDate = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const key = z.string().uuid();
const transcriptId = z.union([key, z.string().regex(/^part-\d+:[A-Za-z0-9_-]+(?::\d+)?$/).max(100)]);
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
    ownerId: transcriptId.nullable(),
    dueDate: z.string().max(80).nullable(),
    dueOriginal: z.string().max(200).nullable(),
    sources: z
      .array(
        z.object({ id: transcriptId, revision: z.number().int().positive() }).strict(),
      )
      .min(1)
      .max(100),
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
const SnapshotSchema = z
  .object({
    title: z.string().min(1).max(160),
    date: z.string().max(20),
    timezone: z.string().max(80),
    speakers: z.array(SpeakerSchema).max(100),
    segments: z.array(SegmentSchema).max(20000),
    speakerLinks: z.array(SpeakerLinkSchema).max(200).optional(),
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
    pipelineId: key.optional(),
    stepIndex: z.number().int().min(0).max(8).optional(),
    contextual: z.object({
      action: z.enum(["simplify", "rewrite", "shorten"]),
      memoId: key,
      itemId: key,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      originalText: text,
      selectedText: z.string().min(1).max(4000),
      sourceRevision: z.number().int().positive(),
      sources: z.array(z.object({ id: transcriptId, revision: z.number().int().positive() }).strict()).min(1).max(100),
      suggestion: z.string().max(8000).nullable(),
    }).strict().refine(value => value.end > value.start && value.end <= value.originalText.length && value.selectedText.trim().length > 0 && value.originalText.slice(value.start, value.end) === value.selectedText, "Invalid contextual selection." ).optional(),
  })
  .strict();
const PipelineSnapshotSchema = SnapshotSchema.extend({
  revision: z.number().int().positive(),
  languages: z.string().max(100),
  kind: z.enum(["general", "erp"]),
  glossary: z.string().max(2000),
}).strict();
export const MemoPipelineSchema = z
  .object({
    id: key,
    provider: z.enum(["openai", "openrouter"]),
    model: z.string().min(1).max(100),
    createdAt: z.string(),
    sourceRevision: z.number().int().positive(),
    snapshot: PipelineSnapshotSchema,
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
export const MAX_JOBS = 400;
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
}).strict().superRefine((audio, context) => {
  if (audio.chunked && (audio.hash !== audio.chunked.manifestSha256 || audio.duration !== audio.chunked.totalSeconds)) {
    context.addIssue({ code: "custom", message: "Chunked audio metadata does not match its manifest." });
  }
});

export const MeetingSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    memoPipelines: z.array(MemoPipelineSchema).max(30).optional(),
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
export type MemoItem = z.infer<typeof MemoItemSchema>;
export type Job = z.infer<typeof JobSchema>;
export type { ReferenceVideo };
export const ref = (s: { id: string; revision: number }) =>
  `${s.id}:${s.revision}`;
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
  const immutable = new Map<string, string>();
  for (const s of [...m.history, ...m.segments]) {
    const value = JSON.stringify(s);
    if (immutable.has(ref(s)) && immutable.get(ref(s)) !== value)
      throw new Error("Conflicting evidence revisions");
    immutable.set(ref(s), value);
  }
  const refs = new Set([...m.history, ...m.segments].map(ref));
  if (m.memos.some(v => (v.editUndo ?? []).some(entry => entry.before.id !== entry.after.id || !v.items.some(item => item.id === entry.before.id) || [...entry.before.sources, ...entry.after.sources].some(source => !refs.has(ref(source))))))
    throw new Error("Invalid memo edit undo history.");
  if (m.jobs.some(job => job.contextual && job.stage !== "memo")) throw new Error("Contextual jobs require the memo stage.");
  if (m.schemaVersion === 1 && (m.memos.some(v => v.reviewCompletion || v.editUndo || v.restoredFrom) || m.jobs.some(job => job.contextual)))
    throw new Error("Memo review data requires meeting schema version 2.");
  if (
    m.memos.some((v) =>
      [...v.items, ...(v.originalItems || [])].some((i) =>
        i.sources.some((s) => !refs.has(ref(s))),
      ),
    )
  )
    throw new Error("Unresolved memo evidence");
  if (m.schemaVersion === 1 && m.memoPipelines !== undefined)
    throw new Error("Pipeline data requires meeting schema version 2.");
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
    const labels = new Set(pipeline.snapshot.speakers.map((s) => s.id));
    if (
      labels.size !== pipeline.snapshot.speakers.length ||
      pipeline.snapshot.segments.some((s) =>
        s.speakerIds.some((id) => !labels.has(id)),
      )
    )
      throw new Error("Invalid pipeline speaker reference.");
    const captured = new Map(
      pipeline.snapshot.segments.map((s) => [ref(s), s]),
    );
    if (
      pipeline.snapshot.segments.some(
        (s) => immutable.get(ref(s)) !== JSON.stringify(s),
      )
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
            v.id === pipeline.memoId &&
            v.sourceRevision === pipeline.sourceRevision,
        ))
    )
      throw new Error("Invalid completed memo pipeline.");
    if (
      new Set(pipeline.snapshot.segments.map((s) => s.id)).size !==
      pipeline.snapshot.segments.length
    )
      throw new Error("Duplicate pipeline source ID.");
    const core = pipeline.chunks.flat();
    if (
      core.length !== pipeline.snapshot.segments.length ||
      core.some((v, i) => v !== pipeline.snapshot.segments[i].id)
    )
      throw new Error("Invalid pipeline source coverage.");
    for (const result of pipeline.results) {
      if (!result) continue;
      if (JSON.stringify(result).length > 8000)
        throw new Error("Pipeline extraction exceeds its limit.");
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
