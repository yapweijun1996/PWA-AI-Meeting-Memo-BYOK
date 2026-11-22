import type { Message } from "@earendil-works/pi-ai";

const MAX_RANGE_GROUPS = 128;

function ranges(indexes: Set<number>): string {
  const groups: [number, number][] = [];
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const last = groups.at(-1);
    if (last && last[1] + 1 === index) last[1] = index;
    else groups.push([index, index]);
  }
  const shown = groups.length <= MAX_RANGE_GROUPS
    ? groups
    : [...groups.slice(0, MAX_RANGE_GROUPS / 2), null, ...groups.slice(-MAX_RANGE_GROUPS / 2)];
  return shown.map(group => !group ? "…" : group[0] === group[1] ? String(group[0]) : group.join("–")).join(", ") || "none";
}

type PassageCoverage = { spans: [start: number, end: number][]; terminalEnd?: number };

function isFullyRead({ spans, terminalEnd }: PassageCoverage): boolean {
  if (terminalEnd === undefined) return false;
  let covered = 0;
  for (const [start, end] of spans.sort(([left], [right]) => left - right)) {
    if (start > covered) return false;
    covered = Math.max(covered, end);
    if (covered >= terminalEnd) return true;
  }
  return false;
}

function contextIndex(omitted: readonly Message[]): string {
  const passages = new Map<number, PassageCoverage>();
  for (const message of omitted) {
    if (message.role !== "toolResult" || message.isError || message.toolName !== "read_transcript_range") continue;
    const result = message.content[0];
    if (result?.type !== "text") continue;
    // Successful outputs came from the bounded, checkpointed local lookup.
    const { excerpts } = JSON.parse(result.text) as {
      excerpts: { index: number; text: string; textOffset: number; complete: boolean }[];
    };
    for (const excerpt of excerpts) {
      if (!excerpt.text.length) continue;
      const coverage: PassageCoverage = passages.get(excerpt.index) ?? { spans: [] };
      const end = excerpt.textOffset + excerpt.text.length;
      coverage.spans.push([excerpt.textOffset, end]);
      if (excerpt.complete) coverage.terminalEnd = end;
      passages.set(excerpt.index, coverage);
    }
  }
  const full = new Set<number>();
  const partial = new Set<number>();
  for (const [index, coverage] of passages) {
    (isFullyRead(coverage) ? full : partial).add(index);
  }
  return [
    "Local context index: earlier conversation turns were omitted to fit the request. This index is navigation, not citation evidence. Read exact source text again only when needed, and prioritize evidence you have not yet gathered. Keep following the initial selective review contract.",
    `Previously read passage indexes (zero-based): ${ranges(full)}. Partially read: ${ranges(partial)}. An ellipsis means some indexes are omitted from this index.`,
  ].join("\n");
}

/** Remove whole assistant/tool turns so the SDK can serialize intact protocol sequences. */
function* projectAgentContexts(messages: readonly Message[]): Generator<Message[]> {
  const initialIndex = messages.findIndex(message => message.role !== "system");
  const initial = messages[initialIndex];
  if (initial?.role !== "user") return;
  const rounds = messages.flatMap((message, index) => message.role === "assistant" ? [index] : []);
  if (!rounds.length) return;
  for (const retained of [8, 2, 1, 0].filter(count => count < rounds.length)) {
    // Keep corrective user messages even when the turns around them are removed.
    const cutoff = retained ? rounds[rounds.length - retained] : messages.length;
    const omitted = messages.slice(initialIndex + 1, cutoff);
    const instructions = omitted.filter(message => message.role === "user" || message.role === "system");
    const suffix = messages.slice(cutoff);
    const index: Message = {
      role: "user",
      content: contextIndex(omitted),
      timestamp: initial.timestamp,
    };
    yield [...messages.slice(0, initialIndex + 1), index, ...instructions, ...suffix];
  }
}

export async function streamAgentContext<T>(
  messages: Message[],
  tryStream: (candidate: Message[]) => Promise<{ result: T; overBudget: boolean }>,
): Promise<T> {
  let attempt = await tryStream(messages);
  if (attempt.overBudget) {
    for (const candidate of projectAgentContexts(messages)) {
      attempt = await tryStream(candidate);
      if (!attempt.overBudget) break;
    }
  }
  return attempt.result;
}
