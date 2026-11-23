// Meeting-scoped recovery of an originally unattributed turn. A semantic judgment
// may veto the acoustic match. It cannot create one.
import {
  ACOUSTIC_POLICY,
  cosineSimilarity,
  type AcousticSampleWindow,
  type AcousticSourcePart,
} from "../domain/acoustic-speaker";
import { type Segment, type Meeting } from "../domain/model";
import { detectedOverlap, recordingOverlap } from "../domain/overlap-evidence";
import { reviewTurnContinuity } from "../domain/turn-context";
import {
  decodeAcousticWindow,
  isUsableAcousticWindow,
} from "../audio/acoustic-audio";
import {
  getLongAudioChunk,
  type LongAudioManifest,
} from "../storage/long-audio-store";
import type { BrowserSpeakerEmbeddingProvider } from "../audio/speaker-embedding";

import {
  addReference,
  referenceBankScore,
  type TimedTurn as Timed,
  type WindowPosition,
} from "./turn-reference-bank";
const timed = (s: Segment): s is Timed =>
  s.start !== null &&
  s.end !== null &&
  Number.isFinite(s.start) &&
  Number.isFinite(s.end) &&
  s.end > s.start;

// Fixed, uncalibrated abstention policy. Trim both boundaries so a loud
// neighbor cannot supply the target's evidence.
const trim = 0.1;
const minTurn = 0.8;
const maxGap = 0.75;
const maxRivals = 8;
const supportFloor = ACOUSTIC_POLICY.acceptCosine;
const fallbackFloor = 0.93;

function isolatedSegments(segments: readonly Segment[]): Set<string> {
  const ordered = segments.filter(timed).sort((a, b) => a.start - b.start);
  const clean = new Set<string>();
  let previousEnd = -Infinity;
  for (const [i, s] of ordered.entries()) {
    if (s.start >= previousEnd && s.end <= (ordered[i + 1]?.start ?? Infinity))
      clean.add(s.id);
    previousEnd = Math.max(previousEnd, s.end);
  }
  return clean;
}

function isOriginalUnknown(current: Segment, original?: Segment): boolean {
  return (
    !!original &&
    !original.speakerIds.length &&
    !current.speakerIds.length &&
    !current.reviewed &&
    !current.parents.length &&
    current.revision === original.revision &&
    current.text === original.text &&
    current.start === original.start &&
    current.end === original.end
  );
}

interface RecoveryOptions {
  source?: { audio: Meeting["audio"]; verifiedHash: string };
  segments: readonly Segment[];
  originals: readonly Segment[];
  parts: readonly AcousticSourcePart[];
  format: "mp3" | "mp4";
  readPart: (index: number) => Promise<ArrayBuffer>;
  provider: BrowserSpeakerEmbeddingProvider;
  signal?: AbortSignal;
}

/** A result names the supporting passage, so a simultaneous re-key of its
 * anonymous speaker can be applied by the existing revision/undo transaction. */
export async function recoverUnknownTurns(
  options: RecoveryOptions,
): Promise<Map<string, string>> {
  const { segments, originals, provider, signal } = options;
  const accepted = new Map<string, string>();
  if (!originals.length || !segments.some((s) => !s.speakerIds.length))
    return accepted;
  const byId = new Map(originals.map((s) => [s.id, s]));
  const clean = isolatedSegments(segments);
  const overlap = options.source?.audio?.hash === options.source?.verifiedHash
    ? recordingOverlap(options.source?.audio ?? null) : undefined;
  const rawClean = isolatedSegments(originals);
  for (const s of segments) {
    const raw = byId.get(s.id);
    // The working view can hide an overlapping ASR row or reduce a multi-label
    // source to one voice. Neither makes its original audio an isolated sample.
    if (
      !raw ||
      !rawClean.has(s.id) ||
      detectedOverlap(overlap, s.start, s.end) ||
      raw.speakerIds.length > 1 ||
      raw.start !== s.start ||
      raw.end !== s.end
    )
      clean.delete(s.id);
  }
  const byTime = segments
    .map((s, index) => ({ s, index }))
    .filter((entry): entry is { s: Timed; index: number } => timed(entry.s))
    .sort((a, b) => a.s.start - b.s.start);
  let cursor = 0;
  for (const part of options.parts) {
    const partEnd = part.ownStartSeconds + part.ownDurationSeconds;
    const inside = (s: Timed) =>
      s.start >= part.ownStartSeconds && s.end <= partEnd;
    const turns = [];
    const representatives = new Map<string, Timed | null>();
    const bank = new Map<string, Timed[]>();
    while (cursor < byTime.length && byTime[cursor]!.s.start < partEnd) {
      const { s, index } = byTime[cursor++]!;
      if (!inside(s)) continue;
      // A known rival seen only during overlap or in short turns has no clean
      // comparison sample. Leave the proposed assignment unresolved.
      for (const speaker of s.speakerIds) {
        if (!representatives.has(speaker)) representatives.set(speaker, null);
      }
      if (s.speakerIds.length === 1) {
        const speaker = s.speakerIds[0]!;
        const previous = representatives.get(speaker);
        if (
          clean.has(s.id) &&
          s.end - s.start >= ACOUSTIC_POLICY.minSampleSeconds + 2 * trim
        ) {
          addReference(bank, s);
          if (!previous || s.end - s.start > previous.end - previous.start)
            representatives.set(speaker, s);
        }
      }
      if (
        isOriginalUnknown(s, byId.get(s.id)) &&
        clean.has(s.id) &&
        s.end - s.start >= minTurn &&
        s.end - s.start <= ACOUSTIC_POLICY.maxSampleSeconds
      )
        turns.push({ s, index });
    }
    if (!turns.length || representatives.size > maxRivals + 1) continue;
    let bytes: ArrayBuffer | undefined;
    const cache = new Map<string, number[] | null>();
    async function vector(s: Timed, edge: WindowPosition) {
      const lo = s.start + trim,
        hi = s.end - trim;
      const half = edge === "firstHalf" || edge === "lastHalf";
      const length = half
        ? (hi - lo) / 2
        : Math.min(hi - lo, ACOUSTIC_POLICY.maxSampleSeconds);
      const start =
        edge === "left" || edge === "lastHalf"
          ? hi - length
          : edge === "right" || edge === "firstHalf"
            ? lo
            : lo + (hi - lo - length) / 2;
      const key = JSON.stringify([s.id, start, length]);
      if (cache.has(key)) return cache.get(key)!;
      signal?.throwIfAborted();
      bytes ??= await options.readPart(part.index);
      const sample: AcousticSampleWindow = {
        id: key,
        sourceSpeakerId: s.speakerIds[0] ?? "unattributed",
        chunkIndex: part.index,
        startSeconds: start,
        endSeconds: start + length,
        segmentIds: [s.id],
      };
      const pcm = await decodeAcousticWindow(bytes, part, sample, {
        format: options.format,
        signal,
      });
      const result = isUsableAcousticWindow(pcm)
        ? await provider.embed(pcm, 16000, signal)
        : null;
      if (cache.size >= ACOUSTIC_POLICY.maxResidentEmbeddings)
        cache.delete(cache.keys().next().value!);
      cache.set(key, result);
      return result;
    }
    function nearbyAnchor(
      index: number,
      step: -1 | 1,
    ): { anchor?: Timed; observed?: string; blocked?: true } {
      let previous = segments[index] as Timed;
      const target = previous;
      for (let distance = 1; distance <= 3; distance++) {
        const turn = segments[index + step * distance];
        if (!turn || (timed(turn) && !inside(turn))) break;
        if (!timed(turn) || !clean.has(turn.id) || turn.speakerIds.length > 1)
          return { blocked: true };
        const gap =
          step < 0 ? previous.start - turn.end : turn.start - previous.end;
        const span =
          step < 0 ? target.start - turn.end : turn.start - target.end;
        if (gap < 0 || gap > maxGap || span > 6)
          return { observed: turn.speakerIds[0] };
        if (turn.speakerIds.length) {
          const anchor =
            turn.end - turn.start >= ACOUSTIC_POLICY.minSampleSeconds + 2 * trim
              ? turn
              : undefined;
          return { anchor, observed: turn.speakerIds[0] };
        }
        if (!isOriginalUnknown(turn, byId.get(turn.id)))
          return { blocked: true };
        previous = turn;
      }
      return {};
    }
    async function bilateralScore(s: Timed, left: Timed, right: Timed) {
      const candidate = await vector(s, "center");
      if (!candidate) return null;
      const before = await vector(left, "left"),
        after = await vector(right, "right");
      if (!before || !after) return null;
      const floor = Math.min(
        cosineSimilarity(before, after),
        cosineSimilarity(candidate, before),
        cosineSimilarity(candidate, after),
      );
      if (!(floor >= supportFloor)) return null;
      let enoughMargin = true;
      for (const [speaker, rival] of representatives) {
        if (speaker === left.speakerIds[0]) continue;
        const other = rival && (await vector(rival, "center"));
        if (
          !other ||
          !(
            floor - cosineSimilarity(candidate, other) >=
            ACOUSTIC_POLICY.acceptMargin
          )
        ) {
          enoughMargin = false;
          break;
        }
      }
      return enoughMargin ? floor : null;
    }
    for (const { s, index } of turns) {
      signal?.throwIfAborted();
      const left = segments[index - 1],
        right = segments[index + 1];
      const before = nearbyAnchor(index, -1),
        after = nearbyAnchor(index, 1);
      if (
        before.blocked ||
        after.blocked ||
        (before.observed &&
          after.observed &&
          before.observed !== after.observed)
      )
        continue;
      const anchor = before.anchor ?? after.anchor;
      if (!anchor) continue;
      const bilateral =
        before.anchor?.id === left?.id &&
        after.anchor?.id === right?.id &&
        !!before.anchor &&
        !!after.anchor;
      const floor = bilateral
        ? await bilateralScore(s, before.anchor!, after.anchor!)
        : await referenceBankScore(
            s,
            anchor,
            representatives.keys(),
            bank,
            vector,
          );
      if (floor === null) continue;
      const meaning = await reviewTurnContinuity(
        left?.text ?? "",
        s.text,
        right?.text ?? "",
        signal,
      );
      signal?.throwIfAborted();
      if (meaning === "turn_change" || meaning === "uncertain") continue;
      // Without a language model, abstain on very short standalone responses,
      // even when their raw vectors are close to the two neighboring turns.
      const units =
        s.text.replace(/(\p{Script=Han})/gu, " $1 ").match(/[\p{L}\p{N}]+/gu)
          ?.length ?? 0;
      if (
        meaning === "unavailable" &&
        (s.end - s.start <
          (bilateral ? ACOUSTIC_POLICY.minSampleSeconds : 2.2) ||
          units < (bilateral ? 4 : 5) ||
          floor < (bilateral ? fallbackFloor : 0.95))
      )
        continue;
      accepted.set(s.id, anchor.id);
    }
  }
  return accepted;
}

export function recoverChunkUnknownTurns(
  meeting: Pick<Meeting, "id" | "audio">,
  manifest: LongAudioManifest,
  segments: readonly Segment[],
  originals: readonly Segment[],
  provider: BrowserSpeakerEmbeddingProvider,
  signal?: AbortSignal,
) {
  return recoverUnknownTurns({
    source: { audio: meeting.audio, verifiedHash: manifest.manifestSha256 },
    segments,
    originals,
    provider,
    signal,
    parts: manifest.chunks,
    format: manifest.format,
    readPart: async (index) =>
      (await getLongAudioChunk(meeting.id, index)).arrayBuffer(),
  });
}
