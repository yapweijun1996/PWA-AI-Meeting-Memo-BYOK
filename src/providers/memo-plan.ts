import { memoSpeakerLabel, type MemoTemplate } from "../domain/memo-templates";
import { getMemoOutputLanguage, type Selection } from "./credentials";
import { id, pipelineSourceSegments, MAX_JOBS, MAX_MEETING_JSON_BYTES, MAX_MEMO_ITEM_SOURCES, type Meeting, type MemoItem } from "../domain/model";
import { buildMemoInput, MEMO_INPUT_MAX_CHARS, MemoInputError, type MemoInput } from "./memo-input";

export type MemoPipeline = NonNullable<Meeting["memoPipelines"]>[number];
export type Extraction = NonNullable<MemoPipeline["results"][number]>;

export function needsMemoBillingReview(
  meeting: Meeting,
  confirmation: { selection: Selection; agentPlan?: { id: string }; plan?: { id: string } | null },
): boolean {
  const { agentPlan, plan, selection } = confirmation;
  return meeting.jobs.some(job => {
    if (agentPlan) return job.agentId === agentPlan.id && job.state !== "completed";
    if (plan) return job.pipelineId === plan.id && job.state !== "completed";
    return job.stage === "memo" && !job.agentId && !job.pipelineId && !job.contextual &&
      (job.state === "outcome_unknown" || job.state === "in_flight") && job.inputRevision === meeting.revision &&
      (job.provider === undefined || job.provider === selection.provider) &&
      (job.model === undefined || job.model === selection.model);
  });
}

export function pipelineMeeting(m: Meeting, p: MemoPipeline): Meeting {
  return {
    ...m,
    title: p.snapshot.title,
    date: p.snapshot.date,
    timezone: p.snapshot.timezone,
    revision: p.snapshot.revision,
    languages: p.snapshot.languages,
    kind: p.snapshot.kind,
    glossary: p.snapshot.glossary,
    speakers: structuredClone(p.snapshot.speakers),
    segments: structuredClone(pipelineSourceSegments(m, p)),
    jobs: [],
    memos: [],
    runs: [],
    history: [],
    undo: [],
    memoPipelines: [],
  };
}

/** Planning is local and never authorizes a request. Each original has one core owner. */
export function planMemo(
  m: Meeting,
  provider: "openai" | "openrouter",
  model: string,
  template?: MemoTemplate,
): MemoPipeline | null {
  try {
    buildMemoInput(m);
    return null;
  } catch (error) {
    if (!(error instanceof MemoInputError)) throw error;
  }
  if (!m.segments.some((s) => s.text.trim()))
    throw new Error("Memo input needs text.");
  const p: MemoPipeline = {
    id: id(),
    provider,
    model,
    createdAt: new Date().toISOString(),
    sourceRevision: m.revision,
    template,
    outputLanguage: getMemoOutputLanguage(),
    snapshot: {
      title: m.title,
      date: m.date,
      timezone: m.timezone,
      languages: m.languages,
      kind: m.kind,
      glossary: m.glossary,
      revision: m.revision,
      speakers: structuredClone(m.speakers),
      sourceRefs: m.segments.map(({id, revision}) => ({id, revision})),
    },
    state: "ready",
    chunks: [],
    results: [],
    memoId: null,
  };
  const frozen = pipelineMeeting(m, p);
  let offset = 0;
  while (offset < m.segments.length) {
    let end = offset;
    // Source text and JSON escaping are monotonic; binary search avoids quadratic packing.
    let lo = offset + 1,
      hi = m.segments.length;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      try {
        buildMemoInput({
          ...frozen,
          segments: frozen.segments.slice(Math.max(0, offset - 1), mid),
        });
        end = mid;
        lo = mid + 1;
      } catch (error) {
        if (!(error instanceof MemoInputError)) throw error;
        hi = mid - 1;
      }
    }
    if (end === offset)
      throw new Error("A source passage cannot fit a bounded memo request.");
    p.chunks.push(m.segments.slice(offset, end).map((s) => s.id));
    if (p.chunks.length > 8)
      throw new Error(
        "This meeting needs more than eight extraction requests. No request was sent.",
      );
    offset = end;
  }
  p.results = p.chunks.map(() => null);
  if (
    m.jobs.length + p.chunks.length + 1 > MAX_JOBS ||
    (m.memoPipelines?.length ?? 0) >= 30 ||
    m.memos.length >= 30
  )
    throw new Error(
      "Meeting history has no capacity for the complete memo plan. Back up the meeting first.",
    );
  if (
    new TextEncoder().encode(
      JSON.stringify({ ...m, memoPipelines: [...(m.memoPipelines ?? []), p] }),
    ).byteLength >
    MAX_MEETING_JSON_BYTES
  )
    throw new Error(
      "The memo checkpoint would exceed the safe backup budget. No request was sent.",
    );
  return p;
}

export function extractionInput(
  m: Meeting,
  p: MemoPipeline,
  index: number,
): Meeting {
  const frozen = pipelineMeeting(m, p);
  const ids = new Set(p.chunks[index]);
  const first = frozen.segments.findIndex((s) => s.id === p.chunks[index][0]);
  if (first > 0) ids.add(frozen.segments[first - 1].id);
  return { ...frozen, segments: frozen.segments.filter((s) => ids.has(s.id)) };
}

export function captureExtraction(m: Meeting, items: MemoItem[]): Extraction {
  const sources = new Map(m.segments.map((s) => [s.id, s]));
  const quotes = new Map<string, Extraction["quotes"][number]>();
  for (const item of items)
    for (const ref of item.sources) {
      const source = sources.get(ref.id);
      if (!source || source.revision !== ref.revision)
        throw new Error("Extraction source is invalid.");
      // Full cited fragments are exact evidence, never model-invented quotations.
      quotes.set(ref.id, { ...ref, text: source.text });
    }
  return { items, quotes: [...quotes.values()] };
}

export function synthesisInput(p: MemoPipeline): MemoInput {
  if (p.results.some((r) => !r))
    throw new Error("Complete every extraction before synthesis.");
  const facts = p.results.flatMap((r) => r!.items);
  if (new Set(facts.map((f) => f.id)).size !== facts.length)
    throw new Error("Duplicate extraction identity.");
  // Avoid a paid synthesis that could exceed the supported expanded-citation limit.
  const largestFive = facts.map(fact => fact.sources.length).sort((a, b) => b - a).slice(0, 5);
  if (largestFive.reduce((total, count) => total + count, 0) > MAX_MEMO_ITEM_SOURCES) {
    const distinct = new Set<string>();
    for (const fact of facts) {
      for (const source of fact.sources) {
        distinct.add(`${source.id}:${source.revision}`);
        if (distinct.size > MAX_MEMO_ITEM_SOURCES)
          throw new Error("Saved extraction citations could exceed 500 source passages in one note. No synthesis request was sent. Back up the meeting; saved extraction steps remain in the backup.");
      }
    }
  }
  const input = JSON.stringify({
    meeting: {
      title: p.snapshot.title,
      date: p.snapshot.date,
      timezone: p.snapshot.timezone,
      languages: p.snapshot.languages,
      type: p.snapshot.kind,
      glossary: p.snapshot.glossary,
    },
    speakers: p.snapshot.speakers.map((speaker,index) => ({
      id: speaker.id,
      name: memoSpeakerLabel(speaker,index),
      confirmed: speaker.confirmed,
    })),
    facts: p.results.map((result) => {
      const quotes = new Map(
        result!.quotes.map((q) => [`${q.id}:${q.revision}`, q.text]),
      );
      return {
        items: result!.items.map(
          ({ id, type, text, factStatus, ownerId, dueDate, dueOriginal, sources }) => ({
            id,
            type,
            text, factStatus,
            ownerId,
            dueDate,
            dueOriginal,
            quote: sources.map((source) => {
              const quote = quotes.get(`${source.id}:${source.revision}`);
              if (quote === undefined)
                throw new Error("Extraction quote is missing.");
              return quote;
            }),
          }),
        ),
      };
    }),
  });
  if (input.length > MEMO_INPUT_MAX_CHARS)
    throw new Error(
      "Synthesis input exceeds 80,000 characters. No synthesis request was sent.",
    );
  return {
    input,
    groups: [],
    aliases: Object.fromEntries(facts.map((f) => [f.id, f.sources])),
    characters: input.length,
    compact: true,
    maxCitations: 5,
  };
}

/** A prompt budget, never a reason to discard a valid paid response. */
export function extractionInstructions(p: MemoPipeline): string {
  const budget = Math.floor((MEMO_INPUT_MAX_CHARS - 6000) / p.chunks.length);
  return ` Extract evidence-grounded candidate facts for a later synthesis step. Preserve numbers, dates, conditions, disagreements and brief replies. Return at most 100 facts. Keep the serialized candidate facts and their exact cited fragment strings within ${budget} characters in total; prefer focused citations and concise claims. This is a planning target, not permission to truncate quotations or invent evidence. These candidates remain subject to human review.`;
}
