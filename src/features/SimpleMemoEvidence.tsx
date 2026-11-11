import { transcriptTextSeparator } from "../domain/transcript-groups";
import type { Meeting, MemoItem, Segment } from "../domain/model";
import { useUiLanguage } from "../ui-language";
import { translateUi } from "../i18n";

/** Small unranked previews of exact cited revisions; never adds surrounding text as evidence. */
export function SimpleMemoEvidence({ item, meeting, indexes, sourceIndex, onSelect, onReview, disabled }: {
  item: MemoItem;
  meeting: Meeting;
  indexes: ReadonlyMap<string, number>;
  sourceIndex: ReadonlyMap<string, Segment>;
  onSelect: (segment: Segment, refs: { id: string; revision: number }[]) => void;
  onReview: () => void;
  disabled?: boolean;
}) {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const groups: { first: Segment; last: Segment; lastIndex: number | undefined; text: string; refs: { id: string; revision: number }[] }[] = [];
  let previousEligible = false;
  for (const ref of item.sources) {
    const segment = sourceIndex.get(`${ref.id}:${ref.revision}`);
    if (!segment) { previousEligible = false; continue; }
    const index = indexes.get(ref.id);
    const exactCurrent = index !== undefined && meeting.segments[index]?.revision === ref.revision;
    const last = groups.at(-1);
    const canJoin = previousEligible && exactCurrent && last && last.lastIndex !== undefined && index === last.lastIndex + 1 && last.last.end !== null && segment.start !== null && segment.start >= last.last.end && segment.start - last.last.end <= 1 && last.last.speakerIds.length === segment.speakerIds.length && last.last.speakerIds.every((id, i) => id === segment.speakerIds[i]);
    if (last && canJoin) {
      last.text += transcriptTextSeparator(last.text, segment.text) + segment.text;
      last.last = segment;
      last.lastIndex = index;
      last.refs.push(ref);
    } else groups.push({ first: segment, last: segment, lastIndex: exactCurrent ? index : undefined, text: segment.text, refs: [ref] });
    previousEligible = exactCurrent;
  }
  const first = groups[0];
  return <span className="simple-memo-evidence">
    <button type="button" className="text-button memo-see-source" disabled={disabled || !first} aria-label={`${t("View original words", "查看原话")} · ${item.text.slice(0, 35)}`} onClick={event => { event.currentTarget.focus(); if (first) onSelect(first.first, first.refs); }}>{t("View original words", "查看原话")}</button>
    {item.sources.length > (first?.refs.length ?? 0) && <button type="button" className="text-button memo-all-sources" disabled={disabled} onClick={onReview}>{t("All references", "全部引用")}</button>}
  </span>;
}
