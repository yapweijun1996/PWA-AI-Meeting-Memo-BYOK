import { cosineSimilarity } from "../domain/acoustic-speaker";
import type { Segment } from "../domain/model";

export type TimedTurn = Segment & { start: number; end: number };
export type WindowPosition =
  "left" | "right" | "center" | "firstHalf" | "lastHalf";
export type TurnVector = (
  turn: TimedTurn,
  position: WindowPosition,
) => Promise<number[] | null>;

/** Select separated, non-overlapping turns before scoring any masked target. */
export function addReference(bank: Map<string, TimedTurn[]>, turn: TimedTurn) {
  const speaker = turn.speakerIds[0]!;
  const existing = bank.get(speaker) ?? [];
  if (existing.length >= 3 || existing.some((s) => turn.start - s.end < 1.5))
    return;
  existing.push(turn);
  bank.set(speaker, existing);
}

/** The same speaker must win for both disjoint halves of the target against
 * every known rival. The nearby turn and the independent bank must agree. */
export async function referenceBankScore(
  target: TimedTurn,
  anchor: TimedTurn,
  speakers: Iterable<string>,
  bank: ReadonlyMap<string, readonly TimedTurn[]>,
  vector: TurnVector,
): Promise<number | null> {
  if (target.end - target.start < 1.8) return null;
  const candidates = [...speakers];
  if (
    candidates.length < 2 ||
    candidates.some((s) => (bank.get(s)?.length ?? 0) < 2)
  )
    return null;
  const first = await vector(target, "firstHalf");
  const last = await vector(target, "lastHalf");
  const near = await vector(anchor, "center");
  if (!first || !last || !near) return null;
  let win = Math.min(
    cosineSimilarity(first, last),
    cosineSimilarity(first, near),
    cosineSimilarity(last, near),
  );
  if (!(win >= 0.9)) return null;
  let rival = -1;
  for (const speaker of candidates) {
    const seen: number[][] = [];
    for (const turn of bank.get(speaker)!) {
      const reference = await vector(turn, "center");
      if (
        !reference ||
        seen.some((v) => !(cosineSimilarity(v, reference) >= 0.86))
      )
        return null;
      seen.push(reference);
      const a = cosineSimilarity(first, reference),
        b = cosineSimilarity(last, reference);
      if (speaker === anchor.speakerIds[0]) win = Math.min(win, a, b);
      else rival = Math.max(rival, a, b);
    }
  }
  return win >= 0.9 && win - rival >= 0.1 ? win : null;
}
