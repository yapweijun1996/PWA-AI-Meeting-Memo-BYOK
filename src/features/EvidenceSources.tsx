import { useState } from "react";
import type { Meeting, MemoItem, Segment } from "../domain/model";
import { translateUi } from "../i18n";
import { useUiLanguage } from "../ui-language";

/** Show a small initial set and page the remainder without changing stored references. */
export function EvidenceSources({ meeting, item, indexes, sourceIndex, onSelect }: {
  meeting: Meeting;
  item: MemoItem;
  indexes: ReadonlyMap<string, number>;
  sourceIndex: ReadonlyMap<string, Segment>;
  onSelect: (segment: Segment, refs?: { id: string; revision: number }[]) => void;
}) {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 15;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(item.sources.length / pageSize) - 1));
  const start = expanded ? currentPage * pageSize : 0;
  const visible = item.sources.slice(start, start + (expanded ? pageSize : 3));
  const groups: Array<{ first: Segment; last: Segment; lastIndex: number; text: string; refs: { id: string; revision: number }[] }> = [];
  let previousEligible = false;
  for (const reference of item.sources) {
    const index = indexes.get(reference.id);
    const segment = index === undefined ? undefined : meeting.segments[index];
    // Only combine exact current revisions in source order with the same speaker and nearby timing.
    if (!segment || segment.revision !== reference.revision || index === undefined) { previousEligible = false; continue; }
    const group = groups.at(-1);
    const last = group?.last;
    const canJoin = previousEligible && !!last && group.lastIndex + 1 === index && last.end !== null && segment.start !== null && segment.start >= last.end && segment.start - last.end <= 1 && last.speakerIds.length === segment.speakerIds.length && last.speakerIds.every((speaker, i) => speaker === segment.speakerIds[i]);
    if (group && canJoin) {
      const needsSpace = group.text && !/[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]$/u.test(group.text) && !/^[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af.,!?;:，。！？；：、）)\]}]/u.test(segment.text);
      group.text += `${needsSpace ? " " : ""}${segment.text}`;
      group.last = segment;
      group.lastIndex = index;
      group.refs.push({ id: segment.id, revision: segment.revision });
    } else groups.push({ first: segment, last: segment, lastIndex: index, text: segment.text, refs: [{ id: segment.id, revision: segment.revision }] });
    previousEligible = true;
  }
  return <div className="source-links" aria-label={t("Source references", "来源引用")}>
    <span>{t("Source", "来源")} · {item.sources.length}</span>
    {groups.slice(0, 2).map(group => <p className="evidence-preview" key={`${group.first.id}:${group.first.revision}`}>
      <button type="button" className="text-button" aria-label={`${t("Open cited fragments in preview", "打开预览中的引用片段")}: ${group.text.slice(0, 160)}`} onClick={() => onSelect(group.first, group.refs)}><span className="evidence-preview-text">{group.text.length > 160 ? `${group.text.slice(0, 160)}…` : group.text}</span></button>
      {group.refs.length > 1 && <span className="small muted"> · {group.refs.length} {t("cited fragments", "个引用片段")}</span>}
    </p>)}
    {visible.map((source, index) => {
      const segment = sourceIndex.get(`${source.id}:${source.revision}`);
      const number = indexes.get(source.id);
      const label = `${t("Passage", "段落")} ${number === undefined ? `${start + index + 1} ${t("(historical)", "（历史）")}` : number + 1} · r${source.revision}`;
      return segment ? <button key={`${source.id}:${source.revision}`} className="source-link" onClick={() => onSelect(segment)}>{label}</button> : <span key={`${source.id}:${source.revision}`} className="source-link" aria-label={`${label}: ${t("Cited revision unavailable", "引用的修订版本不可用")}`}>{label} · {t("unavailable", "不可用")}</span>;
    })}
    {item.sources.length > 3 && !expanded && <button type="button" className="text-button" onClick={() => setExpanded(true)}>{t(`Show all ${item.sources.length} sources`, `查看全部 ${item.sources.length} 条引用`)}</button>}
    {expanded && <>
      <span className="small muted">{start + 1}–{Math.min(start + pageSize, item.sources.length)} / {item.sources.length}</span>
      <button type="button" className="text-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous sources", "上一页引用")}</button>
      <button type="button" className="text-button" disabled={start + pageSize >= item.sources.length} onClick={() => setPage(currentPage + 1)}>{t("Next sources", "下一页引用")}</button>
      <button type="button" className="text-button" onClick={() => { setExpanded(false); setPage(0); }}>{t("Show fewer sources", "收起引用")}</button>
    </>}
  </div>;
}
