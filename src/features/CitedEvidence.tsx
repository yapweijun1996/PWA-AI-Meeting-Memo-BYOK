import { translateUi } from "../i18n";
import { useState } from "react";
import type { Meeting, MemoItem, Segment } from "../domain/model";
import { formatTime, speakerName } from "../domain/operations";
import { useUiLanguage } from "../ui-language";

export function CitedEvidence({ meeting, item, sourceIndex, onSelect }: {
  meeting: Meeting;
  item: MemoItem;
  sourceIndex: ReadonlyMap<string, Segment>;
  onSelect: (segment: Segment) => void;
}) {
  const language = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(item.sources.length / pageSize) - 1));
  const start = currentPage * pageSize;
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  return (
    <details className="cited-evidence" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("Read cited passages together", "一起查看引用段落")} ({item.sources.length})</summary>
      {open && <div>
        <p className="small muted">{t("Check every claim, number and qualifier against these cited revisions. A valid citation does not prove the note is supported. Passages follow citation order, which may differ from meeting order.", "请逐项对照这些引用版本，核查每个陈述、数字和限定条件。引用有效不代表笔记内容有证据支持。段落按引用顺序排列，可能与会议顺序不同。")}</p>
        <p className="cited-evidence-text">
          {item.sources.slice(start, start + pageSize).map((source) => {
            const segment = sourceIndex.get(`${source.id}:${source.revision}`);
            if (!segment) return <span key={`${source.id}:${source.revision}`}>[{t("Cited revision unavailable", "引用的修订版本不可用")} · r{source.revision}] </span>;
            const name = segment.speakerIds.length ? speakerName(meeting, segment.speakerIds) : t("Unknown speaker", "未知说话人");
            const time = segment.start === null ? t("Time unknown", "时间未知") : `${formatTime(segment.start)} – ${formatTime(segment.end!)}`;
            return <span key={`${source.id}:${source.revision}`}><button type="button" aria-label={`${name} · ${time} · r${source.revision}: ${segment.text}`} onClick={() => onSelect(segment)}>{segment.text}</button>{" "}</span>;
          })}
        </p>
        {item.sources.length > pageSize && <div className="evidence-pages">
          <span className="small muted">{start + 1}–{Math.min(start + pageSize, item.sources.length)} / {item.sources.length}</span>
          <button type="button" className="text-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous passages", "上一页段落")}</button>
          <button type="button" className="text-button" disabled={start + pageSize >= item.sources.length} onClick={() => setPage(currentPage + 1)}>{t("Next passages", "下一页段落")}</button>
        </div>}
      </div>}
    </details>
  );
}
