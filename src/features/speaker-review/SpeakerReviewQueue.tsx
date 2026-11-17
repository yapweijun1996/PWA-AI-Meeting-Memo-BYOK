import type { Ref } from "react";
import { Button, Field } from "../../components/controls";
import { SpeakerAvatar } from "../../components/SpeakerAvatar";
import type { Speaker } from "../../domain/model";
import { formatTime } from "../../domain/operations";

type Filter = "unconfirmed" | "confirmed" | "all";
type Sort = "duration" | "fragments";
type Props = {
  speakers: readonly Speaker[];
  unconfirmedCount: number;
  selectedId?: string;
  selectedIds: readonly string[];
  stats: ReadonlyMap<string, { count: number; timed: number }>;
  avatars: Readonly<Record<string, string>>;
  search: string;
  filter: Filter;
  sort: Sort;
  locked: boolean;
  listRef: Ref<HTMLDivElement>;
  onSearch: (value: string) => void;
  onFilter: (value: Filter) => void;
  onSort: (value: Sort) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string, selected: boolean) => void;
  onMergeSelected: () => void;
  t: (english: string, chinese: string) => string;
};

/** The queue presents existing attribution; selection never confirms identity. */
export function SpeakerReviewQueue({ speakers, unconfirmedCount, selectedId, selectedIds, stats, avatars, search, filter, sort, locked, listRef, onSearch, onFilter, onSort, onSelect, onToggle, onMergeSelected, t }: Props) {
  return <section className="speaker-review-queue" aria-label={t("Speaker review queue", "说话人审核队列")}>
    <h3>{t("Speaker review queue", "说话人审核队列")}</h3>
    <p className="small muted">{t(`${unconfirmedCount} unconfirmed`, `${unconfirmedCount} 位未确认`)}</p>
    <input aria-label={t("Search speakers", "搜索说话人")} placeholder={t("Search name or ID", "搜索姓名或 ID")} value={search} onChange={event => onSearch(event.target.value)} />
    <div className="speaker-review-filters" role="group" aria-label={t("Filter speakers", "筛选说话人")}>
      {(["unconfirmed", "confirmed", "all"] as const).map(item => <Button key={item} className={`button compact ${filter === item ? "primary" : "secondary"}`} aria-pressed={filter === item} onClick={() => onFilter(item)}>{item === "unconfirmed" ? t("Unconfirmed", "未确认") : item === "confirmed" ? t("Confirmed", "已确认") : t("All", "全部")}</Button>)}
    </div>
    <Field className="small" label={t("Sort by", "排序")}>
      <select aria-label={t("Sort speakers", "说话人排序")} value={sort} onChange={event => onSort(event.target.value as Sort)}><option value="duration">{t("Timed duration", "有时间记录的时长")}</option><option value="fragments">{t("Fragment count", "片段数量")}</option></select>
    </Field>
    <div className="speaker-queue-list" ref={listRef}>
      {speakers.map(speaker => <div className={`speaker-queue-item${selectedId === speaker.id ? " is-selected" : ""}`} key={speaker.id}>
        <label className="speaker-queue-check"><input type="checkbox" aria-label={t(`Select ${speaker.name}`, `选择${speaker.name}`)} checked={selectedIds.includes(speaker.id)} disabled={locked} onChange={event => onToggle(speaker.id, event.target.checked)} /></label>
        <SpeakerAvatar id={speaker.id} image={avatars[speaker.id]} />
        <Button className="speaker-queue-select" aria-pressed={selectedId === speaker.id} onClick={() => onSelect(speaker.id)}>
          <strong>{speaker.name}</strong>
          <span className="small muted">{speaker.confirmed ? t("Confirmed", "已确认") : t("Unconfirmed", "未确认")}</span>
          <span className="small muted">{formatTime(stats.get(speaker.id)?.timed ?? 0)} · {stats.get(speaker.id)?.count ?? 0} {t("fragments", "片段")}</span>
        </Button>
      </div>)}
      {!speakers.length && <p className="small muted">{t("No speakers match this filter.", "没有符合筛选条件的说话人。")}</p>}
    </div>
    {selectedIds.length >= 2 && <Button className="button primary compact" disabled={locked} onClick={onMergeSelected}>{t(`Merge selected (${selectedIds.length})`, `合并所选 (${selectedIds.length})`)}</Button>}
  </section>;
}
