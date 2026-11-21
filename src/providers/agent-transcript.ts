import { type Segment, ref } from "../domain/model";
import {
  AgentRangeArguments,
  AgentSearchArguments,
  MEMO_AGENT_TOOL_BYTES,
} from "../domain/memo-agent-contract";

const encoder = new TextEncoder();
const SEARCH_SEGMENTS = 1000;
const SEARCH_CHARACTERS = 200000;
type SourceRef = { id: string; revision: number };
export type AgentLookup = { text: string; consulted: SourceRef[] };

const bytes = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).byteLength;
const fold = (value: string) => value.normalize("NFKC").toLowerCase();

function boundary(text: string, offset: number) {
  if (
    offset > 0 &&
    offset < text.length &&
    /[\uDC00-\uDFFF]/.test(text[offset]) &&
    /[\uD800-\uDBFF]/.test(text[offset - 1])
  )
    return offset - 1;
  return offset;
}

/** Each search scans a bounded window; nextIndex means unsearched input, not more matches. */
export function searchAgentTranscript(
  sources: readonly Segment[],
  input: unknown,
): AgentLookup {
  const { query, startIndex, limit } = AgentSearchArguments.parse(input);
  if (startIndex > sources.length)
    throw new Error("Search starts beyond the saved transcript.");
  const matches: {
    index: number;
    id: string;
    revision: number;
    excerpt: string;
  }[] = [];
  let index = startIndex,
    characters = 0;
  const needle = fold(query);
  // Later nonmatches can grow both counters, and the terminal null uses four bytes.
  const endIndex = Math.min(sources.length, startIndex + SEARCH_SEGMENTS);
  const largestCursor = endIndex === sources.length && endIndex < 1000 ? null : endIndex;
  while (
    index < sources.length &&
    index - startIndex < SEARCH_SEGMENTS &&
    characters < SEARCH_CHARACTERS
  ) {
    const source = sources[index];
    if (characters + source.text.length > SEARCH_CHARACTERS) break;
    characters += source.text.length;
    if (fold(source.text).includes(needle)) {
      const candidate = {
        index,
        id: source.id,
        revision: source.revision,
        excerpt: source.text.slice(
          0,
          boundary(source.text, Math.min(180, source.text.length)),
        ),
      };
      if (
        bytes({
          matches: [...matches, candidate],
          nextIndex: largestCursor,
          scanned: endIndex - startIndex,
        }) > MEMO_AGENT_TOOL_BYTES
      )
        break;
      matches.push(candidate);
    }
    index += 1;
    if (matches.length === limit) break;
  }
  return {
    text: JSON.stringify({
      matches,
      nextIndex: index < sources.length ? index : null,
      scanned: index - startIndex,
    }),
    consulted: [],
  };
}

/** Exact revision-bound excerpts; only returned, nonempty text counts as consulted evidence. */
export function readAgentTranscript(
  sources: readonly Segment[],
  input: unknown,
): AgentLookup {
  const { startIndex, count, textOffset } = AgentRangeArguments.parse(input);
  if (startIndex > sources.length)
    throw new Error("Range starts beyond the saved transcript.");
  if (
    startIndex < sources.length &&
    textOffset > sources[startIndex].text.length
  )
    throw new Error("Text offset is outside the source passage.");
  const excerpts: {
    index: number;
    id: string;
    revision: number;
    start: number | null;
    end: number | null;
    speakerIds: string[];
    text: string;
    textOffset: number;
    complete: boolean;
  }[] = [];
  const consulted: SourceRef[] = [];
  let index = startIndex,
    offset = textOffset;
  let next: { startIndex: number; textOffset: number } | null =
    index < sources.length ? { startIndex: index, textOffset: offset } : null;
  for (; index < sources.length && index < startIndex + count; index++) {
    const source = sources[index];
    offset = boundary(source.text, index === startIndex ? offset : 0);
    const make = (length: number) => {
      const end = boundary(
        source.text,
        Math.min(source.text.length, offset + length),
      );
      const complete = end === source.text.length;
      const cursor = complete
        ? index + 1 < sources.length
          ? { startIndex: index + 1, textOffset: 0 }
          : null
        : { startIndex: index, textOffset: end };
      const excerpt = {
        index,
        id: source.id,
        revision: source.revision,
        start: source.start,
        end: source.end,
        speakerIds: [...source.speakerIds],
        text: source.text.slice(offset, end),
        textOffset: offset,
        complete,
      };
      return { excerpt, cursor };
    };
    const remaining = source.text.length - offset;
    const full = make(remaining);
    let low = 0,
      high = remaining - 1,
      fitting =
        bytes({ excerpts: [...excerpts, full.excerpt], next: full.cursor }) <=
        MEMO_AGENT_TOOL_BYTES
          ? remaining
          : -1;
    if (fitting === remaining) high = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = make(middle);
      if (
        bytes({
          excerpts: [...excerpts, candidate.excerpt],
          next: candidate.cursor,
        }) <= MEMO_AGENT_TOOL_BYTES
      ) {
        fitting = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (
      fitting < 0 ||
      (make(fitting).excerpt.text.length === 0 && offset < source.text.length)
    ) {
      if (!excerpts.length)
        throw new Error(
          "Source metadata cannot fit a bounded transcript lookup.",
        );
      next = { startIndex: index, textOffset: offset };
      break;
    }
    const { excerpt, cursor } = make(fitting);
    excerpts.push(excerpt);
    next = cursor;
    if (excerpt.text.length)
      consulted.push({ id: source.id, revision: source.revision });
    if (!excerpt.complete) break;
  }
  const text = JSON.stringify({ excerpts, next });
  if (encoder.encode(text).byteLength > MEMO_AGENT_TOOL_BYTES)
    throw new Error("Transcript lookup exceeded its local budget.");
  return { text, consulted };
}

export function mergeConsulted(
  previous: readonly SourceRef[],
  incoming: readonly SourceRef[],
): SourceRef[] {
  return [
    ...new Map(
      [...previous, ...incoming].map((source) => [ref(source), source]),
    ).values(),
  ];
}
