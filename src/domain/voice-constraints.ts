import { acousticSourceKey, type AcousticEmbeddingRecord, type VoiceConstraints } from "./acoustic-speaker";
import type { Meeting } from "./model";
import { cleanSampleOwner } from "./voice-suggestions";

/**
 * Turn a person's review into constraints on provider labels for automatic
 * voice matching.
 *
 * A label belongs to a speaker only when every saved sample of that label lies
 * in passages currently attributed to that one speaker; a label a person split
 * between speakers yields no constraint. Then:
 * - labels of one confirmed speaker must share a voice;
 * - labels of two different confirmed speakers must not;
 * - labels of two speakers a person marked "not the same" must not.
 * Unconfirmed groupings are not constraints: they may come from an earlier
 * automatic run.
 */
export function buildVoiceConstraints(
  meeting: Pick<Meeting, "speakers" | "segments" | "voiceDecisions">,
  embeddings: readonly AcousticEmbeddingRecord[],
): VoiceConstraints {
  const ownersOfLabel = new Map<string, Set<string | null>>();
  for (const embedding of embeddings) {
    const key = acousticSourceKey(embedding.chunkIndex, embedding.sourceSpeakerId);
    const owner = cleanSampleOwner(meeting.segments, embedding.sample.startSeconds, embedding.sample.endSeconds);
    ownersOfLabel.set(key, (ownersOfLabel.get(key) ?? new Set()).add(owner));
  }
  const labelsOf = new Map<string, string[]>();
  for (const [key, owners] of ownersOfLabel) {
    const [owner] = [...owners];
    if (owners.size !== 1 || !owner) continue;
    labelsOf.set(owner, [...(labelsOf.get(owner) ?? []), key]);
  }
  const confirmed = meeting.speakers.filter((speaker) => speaker.confirmed && labelsOf.has(speaker.id));
  const mustLink = confirmed.map((speaker) => labelsOf.get(speaker.id)!).filter((labels) => labels.length > 1);
  const cannotLink: [string, string][] = [];
  const seen = new Set<string>();
  const separate = (first: string, second: string) => {
    if (first === second) return;
    for (const left of labelsOf.get(first) ?? []) {
      for (const right of labelsOf.get(second) ?? []) {
        const id = [left, right].sort().join("\u0000");
        if (left === right || seen.has(id)) continue;
        seen.add(id);
        cannotLink.push([left, right]);
      }
    }
  };
  confirmed.forEach((first, index) => confirmed.slice(index + 1).forEach((second) => separate(first.id, second.id)));
  for (const decision of meeting.voiceDecisions ?? []) separate(decision.firstSpeakerId, decision.secondSpeakerId);
  return { mustLink, cannotLink };
}
