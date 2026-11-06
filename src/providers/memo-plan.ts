import { id, type Meeting, type MemoItem } from "../domain/model";
import { buildMemoInput, MemoInputError, type MemoInput } from "./memo-input";

export type MemoPipeline = NonNullable<Meeting["memoPipelines"]>[number];
export type Extraction = NonNullable<MemoPipeline["results"][number]>;

export function pipelineMeeting(m: Meeting, p: MemoPipeline): Meeting {
  return {
    ...m,
    ...structuredClone(p.snapshot),
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
    snapshot: {
      title: m.title,
      date: m.date,
      timezone: m.timezone,
      languages: m.languages,
      kind: m.kind,
      glossary: m.glossary,
      revision: m.revision,
      speakers: structuredClone(m.speakers),
      segments: structuredClone(m.segments),
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
    m.jobs.length + p.chunks.length + 1 > 100 ||
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
    10 * 1024 * 1024
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
  const result = { items, quotes: [...quotes.values()] };
  if (JSON.stringify(result).length > 8000)
    throw new Error(
      "Extraction exceeds 8,000 characters. Results were not truncated; review the paid attempt.",
    );
  return result;
}

export function synthesisInput(p: MemoPipeline): MemoInput {
  if (p.results.some((r) => !r))
    throw new Error("Complete every extraction before synthesis.");
  const facts = p.results.flatMap((r) => r!.items);
  if (new Set(facts.map((f) => f.id)).size !== facts.length)
    throw new Error("Duplicate extraction identity.");
  const input = JSON.stringify({
    meeting: {
      title: p.snapshot.title,
      date: p.snapshot.date,
      timezone: p.snapshot.timezone,
      languages: p.snapshot.languages,
      type: p.snapshot.kind,
      glossary: p.snapshot.glossary,
    },
    speakers: p.snapshot.speakers.map(({ id, name, confirmed }) => ({
      id,
      name,
      confirmed,
    })),
    facts: p.results.map((result) => ({
      items: result!.items.map(
        ({ id, type, text, ownerId, dueDate, dueOriginal, sources }) => ({
          id,
          type,
          text,
          ownerId,
          dueDate,
          dueOriginal,
          sources,
        }),
      ),
      quotes: result!.quotes,
    })),
  });
  if (input.length > 80000)
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
