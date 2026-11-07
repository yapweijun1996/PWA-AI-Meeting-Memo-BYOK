import type { Mp3Chunk } from "../audio/mp3-split";
import type { normalizeSpeech } from "../providers/api";

type NormalizedSpeech = ReturnType<typeof normalizeSpeech>;
type SpeechSegment = NormalizedSpeech["segments"][number];

export interface ChunkSpeechInput {
  chunk: Pick<Mp3Chunk, "index" | "ownStartSeconds" | "ownDurationSeconds" | "leadInSeconds">;
  speech: NormalizedSpeech;
}

export interface MergedSpeech {
  speech: NormalizedSpeech;
  droppedOverlapSegments: number;
  untimedSegments: number;
  notes: string[];
  boundaries: { chunkIndex: number; time: number; snappedToPause: boolean; pauseSeconds: number | null }[];
}

interface Boundary {
  chunkIndex: number;
  time: number;
  snappedToPause: boolean;
  pauseSeconds: number | null;
}

interface MappedSegment {
  chunkIndex: number;
  originalIndex: number;
  segment: SpeechSegment;
}

interface OutputSegment {
  chunkIndex: number;
  segment: SpeechSegment;
}

const INVALID_INPUT = "Chunk speech inputs must be sorted and contiguous.";

export function mergeChunkSpeech(
  inputs: ChunkSpeechInput[],
  options?: { partLabel?: (chunkIndex: number, speakerName: string) => string; minPauseSeconds?: number },
): MergedSpeech {
  const minPauseSeconds = options?.minPauseSeconds ?? 0.25;
  if (!Number.isFinite(minPauseSeconds) || minPauseSeconds < 0.05 || minPauseSeconds > 2) {
    throw new RangeError("minPauseSeconds must be between 0.05 and 2 seconds.");
  }
  for (let index = 1; index < inputs.length; index += 1) {
    const previous = inputs[index - 1];
    const current = inputs[index];
    if (
      previous === undefined
      || current === undefined
      || current.chunk.index !== previous.chunk.index + 1
      || Math.abs(current.chunk.ownStartSeconds - (previous.chunk.ownStartSeconds + previous.chunk.ownDurationSeconds)) > 1e-9
    ) {
      throw new RangeError(INVALID_INPUT);
    }
  }

  const boundaries: Boundary[] = [];
  for (let index = 1; index < inputs.length; index += 1) {
    const previous = inputs[index - 1];
    const current = inputs[index];
    if (previous === undefined || current === undefined) continue;
    const overlap = current.chunk.leadInSeconds;
    const midpoint = current.chunk.ownStartSeconds - overlap / 2;
    let selected: { time: number; pauseSeconds: number } | undefined;
    if (overlap >= 2) {
      const absolute = current.speech.segments
        .filter((segment) => segment.start !== null)
        .map((segment) => ({
          start: current.chunk.ownStartSeconds - overlap + (segment.start as number),
          end: current.chunk.ownStartSeconds - overlap + (segment.end ?? segment.start as number),
        }))
        .sort((left, right) => left.start - right.start);
      const windowStart = midpoint - overlap / 4;
      const windowEnd = midpoint + overlap / 4;
      for (let candidateIndex = 0; candidateIndex + 1 < absolute.length; candidateIndex += 1) {
        const left = absolute[candidateIndex];
        const right = absolute[candidateIndex + 1];
        if (left === undefined || right === undefined) continue;
        const pauseSeconds = right.start - left.end;
        const time = (left.end + right.start) / 2;
        if (pauseSeconds < minPauseSeconds || time < windowStart || time > windowEnd) continue;
        const crossedByPrevious = previous.speech.segments.some((segment) => {
          if (segment.start === null) return false;
          const start = previous.chunk.ownStartSeconds - previous.chunk.leadInSeconds + segment.start;
          const end = previous.chunk.ownStartSeconds - previous.chunk.leadInSeconds + (segment.end ?? segment.start);
          return start < time && time < end;
        });
        if (crossedByPrevious) continue;
        if (selected === undefined || pauseSeconds > selected.pauseSeconds
          || (pauseSeconds === selected.pauseSeconds && Math.abs(time - midpoint) < Math.abs(selected.time - midpoint))) {
          selected = { time, pauseSeconds };
        }
      }
    }
    boundaries.push({
      chunkIndex: current.chunk.index,
      time: selected?.time ?? midpoint,
      snappedToPause: selected !== undefined,
      pauseSeconds: selected?.pauseSeconds ?? null,
    });
  }

  let droppedOverlapSegments = 0;
  let untimedSegments = 0;
  let duration: number | null = null;
  const speakers: NormalizedSpeech["speakers"] = [];
  const selectedByChunk: MappedSegment[][] = [];
  const displayNames = new Set<string>();

  for (const [inputIndex, input] of inputs.entries()) {
    const { chunk, speech } = input;
    const speakerIds = new Map<string, string>();
    for (const [speakerIndex, speaker] of speech.speakers.entries()) {
      const id = `part-${chunk.index}:${speaker.id}`;
      speakerIds.set(speaker.id, id);
      const partSuffix = ` (part ${chunk.index + 1})`;
      const baseName = options?.partLabel?.(chunk.index, speaker.name)
        ?? `${speaker.name.slice(0, 80 - partSuffix.length)}${partSuffix}`;
      let name = baseName.slice(0, 80);
      let suffix = 2;
      while (displayNames.has(name)) {
        const disambiguator = ` ${suffix}`;
        name = `${baseName.slice(0, 80 - disambiguator.length)}${disambiguator}`;
        suffix += 1;
      }
      displayNames.add(name);
      speakers.push({
        ...speaker,
        id,
        name,
        sourceLabels: speaker.sourceLabels.map((label, labelIndex) => {
          const prefix = `part-${chunk.index}:${speakerIndex}:${labelIndex}:`;
          return `${prefix}${label.slice(0, Math.max(0, 160 - prefix.length))}`;
        }),
      });
    }

    const lowerBound = boundaries[inputIndex - 1]?.time ?? null;
    const next = boundaries[inputIndex];
    const upperBound = next?.time ?? null;
    const selected: MappedSegment[] = [];
    for (const [originalIndex, original] of speech.segments.entries()) {
      const absoluteStart = original.start === null ? null : chunk.ownStartSeconds - chunk.leadInSeconds + original.start;
      const absoluteEnd = original.end === null ? null : chunk.ownStartSeconds - chunk.leadInSeconds + original.end;
      if (absoluteStart !== null && ((lowerBound !== null && absoluteStart < lowerBound) || (upperBound !== null && absoluteStart >= upperBound))) {
        droppedOverlapSegments += 1;
        continue;
      }
      if (absoluteStart === null) untimedSegments += 1;
      if (absoluteStart !== null && absoluteEnd !== null && (duration === null || absoluteEnd > duration)) duration = absoluteEnd;
      selected.push({
        chunkIndex: chunk.index,
        originalIndex,
        segment: {
          ...original,
          start: absoluteStart,
          end: absoluteEnd,
          speakerIds: original.speakerIds.map((id) => speakerIds.get(id) ?? `part-${chunk.index}:${id}`),
        },
      });
    }
    selectedByChunk.push(selected);
  }

  const timed: MappedSegment[] = [];
  const untimedByChunkIndex = new Map<number, MappedSegment[]>();
  for (const selected of selectedByChunk) {
    const untimed: MappedSegment[] = [];
    for (const item of selected) {
      if (item.segment.start === null) untimed.push(item);
      else timed.push(item);
    }
    const chunkIndex = untimed[0]?.chunkIndex;
    if (chunkIndex !== undefined && untimed.length > 0) untimedByChunkIndex.set(chunkIndex, untimed);
  }
  timed.sort((left, right) => (left.segment.start ?? 0) - (right.segment.start ?? 0)
    || left.chunkIndex - right.chunkIndex
    || left.originalIndex - right.originalIndex);

  const segmentIds = new Set<string>();
  const segmentIdsByChunk = new Map<number, Map<string, string>>();
  const allocatedIds = new Map<MappedSegment, string>();
  const allocateId = (item: MappedSegment): string => {
    const base = `part-${item.chunkIndex}:${item.segment.id}`;
    let id = base;
    let suffix = 2;
    while (segmentIds.has(id)) {
      id = `${base}:${suffix}`;
      suffix += 1;
    }
    segmentIds.add(id);
    allocatedIds.set(item, id);
    let byOriginal = segmentIdsByChunk.get(item.chunkIndex);
    if (byOriginal === undefined) {
      byOriginal = new Map<string, string>();
      segmentIdsByChunk.set(item.chunkIndex, byOriginal);
    }
    if (!byOriginal.has(item.segment.id)) byOriginal.set(item.segment.id, id);
    return id;
  };
  for (const item of timed) allocateId(item);
  for (const group of untimedByChunkIndex.values()) for (const item of group) allocateId(item);

  const toOutput = (item: MappedSegment): OutputSegment => {
    const mappedParents = segmentIdsByChunk.get(item.chunkIndex);
    const parentValues = item.segment.parents.map((parent) => mappedParents?.get(parent) ?? parent);
    return {
      chunkIndex: item.chunkIndex,
      segment: {
        ...item.segment,
        id: allocatedIds.get(item) ?? `part-${item.chunkIndex}:${item.segment.id}`,
        parents: parentValues,
      },
    };
  };
  const lastTimedPosition = new Map<number, number>();
  for (let index = 0; index < timed.length; index += 1) {
    const item = timed[index];
    if (item !== undefined) lastTimedPosition.set(item.chunkIndex, index);
  }
  const output: OutputSegment[] = [];
  for (let index = 0; index < timed.length; index += 1) {
    const item = timed[index];
    if (item === undefined) continue;
    output.push(toOutput(item));
    if (lastTimedPosition.get(item.chunkIndex) === index) {
      const untimed = untimedByChunkIndex.get(item.chunkIndex);
      if (untimed !== undefined) output.push(...untimed.map(toOutput));
    }
  }
  for (const input of inputs) {
    const untimed = untimedByChunkIndex.get(input.chunk.index);
    if (!lastTimedPosition.has(input.chunk.index) && untimed !== undefined) output.push(...untimed.map(toOutput));
  }

  const fallbackCount = boundaries.filter((boundary) => !boundary.snappedToPause
    && (inputs.find((input) => input.chunk.index === boundary.chunkIndex)?.chunk.leadInSeconds ?? 0) >= 2).length;
  const notes = [
    ...(untimedSegments > 0 ? [`${untimedSegments} untimed segment${untimedSegments === 1 ? "" : "s"} kept in their source chunk order.`] : []),
    ...(fallbackCount > 0 ? [`${fallbackCount} of ${boundaries.length} chunk boundaries had no shared pause and used the midpoint; a word near those boundaries may be duplicated or missing.`] : []),
  ];
  return {
    speech: { speakers, segments: output.map((item) => item.segment), duration, requestId: null },
    droppedOverlapSegments,
    untimedSegments,
    notes,
    boundaries,
  };
}
