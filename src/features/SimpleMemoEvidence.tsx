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
  return <details className="simple-memo-evidence">
    <summary>{t("View original words", "查看原话")}</summary>
    <p className="small muted">{t("Cited excerpts in citation order, not ranked by relevance. A citation does not prove the note.", "以下按引用顺序展示，不代表相关性排序；有引用不等于笔记已获证实。")}</p>
    {groups.slice(0, 3).map(group => <button type="button" className="simple-evidence-preview" key={`${group.first.id}:${group.first.revision}`} onClick={event => { event.currentTarget.focus(); onSelect(group.first, group.refs); }}>{group.text.length > 180 ? `${group.text.slice(0, 180)}…` : group.text}</button>)}
    {!groups.length && <p className="small muted">{t("Cited revisions are unavailable.", "引用版本不可用。")}</p>}
    <button type="button" className="text-button" disabled={disabled} onClick={onReview}>{t("View all references in Evidence Review", "在证据审阅中查看全部引用")}</button>
  </details>;
}
