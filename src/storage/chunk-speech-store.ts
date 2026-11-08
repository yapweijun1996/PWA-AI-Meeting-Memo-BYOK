import { z } from "zod";
import { SegmentSchema, SpeakerSchema } from "../domain/model";
import type { NormalizedSpeech } from "../providers/api";
import { db } from "./repository";
export type ChunkSpeech = NormalizedSpeech;
const ChunkSpeechSchema = z.object({
  speakers: z.array(SpeakerSchema),
  segments: z.array(SegmentSchema),
  duration: z.number().nonnegative().nullable(),
  requestId: z.string().max(200).nullable(),
}).strict();

export async function putChunkSpeech(meetingId: string, index: number, speech: ChunkSpeech): Promise<void> {
  await (await db()).put("chunkSpeech", ChunkSpeechSchema.parse(speech), [meetingId, index]);
}

export async function getChunkSpeech(meetingId: string, index: number): Promise<ChunkSpeech | undefined> {
  const value = await (await db()).get("chunkSpeech", [meetingId, index]);
  return value === undefined ? undefined : ChunkSpeechSchema.parse(value);
}

export async function listChunkSpeechIndexes(meetingId: string): Promise<number[]> {
  const range = IDBKeyRange.bound([meetingId, 0], [meetingId, Infinity]);
  const keys = await (await db()).getAllKeys("chunkSpeech", range);
  return keys.map((key) => (key as [string, number])[1]).sort((a, b) => a - b);
}

export async function deleteChunkSpeech(meetingId: string): Promise<void> {
  const range = IDBKeyRange.bound([meetingId, 0], [meetingId, Infinity]);
  await (await db()).delete("chunkSpeech", range);
}
