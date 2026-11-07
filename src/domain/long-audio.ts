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
  options?: { partLabel?: (chunkIndex: number, speakerName: string) => string },
): MergedSpeech {
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

    const lowerBound = inputIndex > 0 ? chunk.ownStartSeconds - chunk.leadInSeconds / 2 : null;
    const next = inputs[inputIndex + 1];
    const upperBound = next === undefined ? null : next.chunk.ownStartSeconds - next.chunk.leadInSeconds / 2;
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

  const notes = untimedSegments > 0 ? [`${untimedSegments} untimed segment${untimedSegments === 1 ? "" : "s"} kept in their source chunk order.`] : [];
  return {
    speech: { speakers, segments: output.map((item) => item.segment), duration, requestId: null },
    droppedOverlapSegments,
    untimedSegments,
    notes,
  };
}
