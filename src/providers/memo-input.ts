import type { Meeting } from "../domain/model";

export const MEMO_INPUT_MAX_CHARS = 80_000;
export const MEMO_GROUP_MAX_SEGMENTS = 20;
export const MEMO_INPUT_ERROR_MESSAGE =
  "Memo input needs text and must fit the 80,000-character limit. Use a shorter meeting or selected transcript.";

export type MemoSourceRef = Readonly<{
  id: string;
  revision: number;
}>;

export type MemoInputGroup = Readonly<{
  id: string;
  text: string | readonly string[];
  speakers: readonly (string | number)[];
}>;

export type MemoInputAliases = Readonly<
  Record<string, readonly MemoSourceRef[]>
>;

export type MemoInput = Readonly<{
  input: string;
  groups: readonly MemoInputGroup[];
  aliases: MemoInputAliases;
  characters: number;
  compact: boolean;
  maxCitations: 5 | 100;
}>;

export class MemoInputError extends Error {
  constructor(message = MEMO_INPUT_ERROR_MESSAGE) {
    super(message);
    this.name = "MemoInputError";
  }
}

function sameSpeakers(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((speaker, i) => speaker === right[i])
  );
}

function rejectInput() {
  throw new MemoInputError();
}

/**
 * Build the one bounded representation used by memo generation.
 *
 * Consecutive segments are compacted only when their ordered speaker sets are
 * identical. Each compact group retains a bounded, immutable source map so a
 * model citation can be expanded back to the original segment revisions.
 */
export function buildMemoInput(m: Meeting): MemoInput {
  if (!m.segments.length) rejectInput();

  // Text is preserved in full, so a raw text total above the serialized limit
  // cannot produce an input within the limit. Stop before allocating groups for
  // pathological meeting data.
  let rawTextLength = 0;
  let hasText = false;
  for (const source of m.segments) {
    rawTextLength += source.text.length;
    hasText ||= source.text.trim().length > 0;
    if (rawTextLength > MEMO_INPUT_MAX_CHARS) rejectInput();
  }
  if (!hasText) rejectInput();

  const meeting = {
    meeting: {
      title: m.title,
      languages: m.languages,
      date: m.date,
      timezone: m.timezone,
      type: m.kind,
      glossary: m.glossary,
    },
    speakers: m.speakers.map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
      confirmed: speaker.confirmed,
    })),
  };
  const originalGroups: MemoInputGroup[] = m.segments.map((source) => ({
    id: source.id,
    text: source.text,
    speakers: [...source.speakerIds],
  }));
  const originalInput = JSON.stringify({
    ...meeting,
    segments: originalGroups,
  });
  if (originalInput.length <= MEMO_INPUT_MAX_CHARS)
    return {
      input: originalInput,
      groups: Object.freeze(
        originalGroups.map((group) =>
          Object.freeze({
            ...group,
            speakers: Object.freeze([...group.speakers]),
          }),
        ),
      ),
      aliases: Object.freeze({}),
      characters: originalInput.length,
      compact: false,
      maxCitations: 100,
    };

  type WorkingGroup = {
    speakers: string[];
    texts: string[];
    sources: MemoSourceRef[];
  };
  const working: WorkingGroup[] = [];
  let current: WorkingGroup | undefined;
  const flush = () => {
    if (current) working.push(current);
    current = undefined;
  };

  for (const source of m.segments) {
    if (
      !current ||
      current.sources.length >= MEMO_GROUP_MAX_SEGMENTS ||
      !sameSpeakers(current.speakers, source.speakerIds)
    ) {
      flush();
      current = {
        speakers: [...source.speakerIds],
        texts: [],
        sources: [],
      };
    }
    current.texts.push(source.text);
    current.sources.push({ id: source.id, revision: source.revision });
  }
  flush();

  const groups: MemoInputGroup[] = working.map((group, index) => ({
    id: `g${index}`,
    text: Object.freeze([...group.texts]),
    speakers: group.speakers.map((speaker) => {
      const index = m.speakers.findIndex((candidate) => candidate.id === speaker);
      return index < 0 ? speaker : index;
    }),
  }));
  const aliases = Object.fromEntries(
    working.map((group, index) => [
      `g${index}`,
      group.sources.map((source) => ({
        id: source.id,
        revision: source.revision,
      })),
    ]),
  ) as Record<string, readonly MemoSourceRef[]>;

  const input = JSON.stringify({
    ...meeting,
    segments: groups,
  });
  if (input.length > MEMO_INPUT_MAX_CHARS) rejectInput();

  return {
    input,
    groups: Object.freeze(
      groups.map((group) =>
        Object.freeze({
          ...group,
          speakers: Object.freeze([...group.speakers]),
        }),
      ),
    ),
    aliases: Object.freeze(
      Object.fromEntries(
        Object.entries(aliases).map(([key, refs]) => [
          key,
          Object.freeze(refs.map((source) => Object.freeze({ ...source }))),
        ]),
      ),
    ),
    characters: input.length,
    compact: true,
    maxCitations: 5,
  };
}
