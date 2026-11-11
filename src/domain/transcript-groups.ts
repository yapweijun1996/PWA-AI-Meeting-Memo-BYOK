import type { Segment } from "./model";

export type TranscriptGroup = { segments: Segment[]; text: string };

export function transcriptTextSeparator(left: string, right: string): string {
  if (!left || !right) return "";
  const noSpace = /[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]$/u.test(left) ||
    /^[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af.,!?;:，。！？；：、）)\]}]/u.test(right) ||
    /[(\x5b{（]$/u.test(left);
  return noSpace ? "" : " ";
}

/** Read-only groups in source order. Never infer timing for untimed fragments. */
export function groupTranscript(segments: Segment[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  for (const segment of segments) {
    const group = groups.at(-1);
    const previous = group?.segments.at(-1);
    const text = group ? group.text + transcriptTextSeparator(group.text, segment.text) + segment.text : segment.text;
    const canJoin = previous && group && previous.start !== null && previous.end !== null &&
      segment.start !== null && segment.end !== null && segment.start >= previous.end &&
      segment.start - previous.end <= 1 &&
      previous.speakerIds.length === segment.speakerIds.length &&
      previous.speakerIds.every((id, index) => id === segment.speakerIds[index]) &&
      !/[.!?。！？]["'”’）)]*\s*$/u.test(group.text) && text.length <= 240 &&
      group.segments.length < 80;
    if (canJoin) {
      group.segments.push(segment);
      group.text = text;
    } else {
      groups.push({ segments: [segment], text: segment.text });
    }
  }
  return groups;
}
