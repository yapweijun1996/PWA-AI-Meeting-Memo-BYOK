import type { Meeting, Segment } from "../domain/model";
import { translateUi } from "../i18n";
import { useUiLanguage } from "../ui-language";

export function formatEvidenceTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const whole = Math.floor(milliseconds / 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const sec = whole % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

/** Surrounding material is current transcript context, even when separately cited elsewhere. */
export function EvidenceContext({ meeting, evidence, citedRefs = [] }: { meeting: Meeting; evidence: Segment; citedRefs?: { id: string; revision: number }[] }) {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const index = meeting.segments.findIndex(segment => segment.id === evidence.id);
  if (index < 0) return <p className="small muted">{t("Current transcript context is unavailable for this historical passage.", "此历史段落的当前转录上下文不可用。")}</p>;
  const current = meeting.segments[index];
  const exactCitations = new Set([`${evidence.id}:${evidence.revision}`, ...citedRefs.map(ref => `${ref.id}:${ref.revision}`)]);
  const canJoin = (left: Segment, right: Segment) => left.start !== null && left.end !== null && right.start !== null && right.end !== null && right.start >= left.end && right.start - left.end <= 1 && left.speakerIds.length === right.speakerIds.length && left.speakerIds.every((speaker, i) => speaker === right.speakerIds[i]);
  let first = index, last = index;
  while (first > 0 && index - first < 12 && canJoin(meeting.segments[first - 1], meeting.segments[first])) first--;
  // Group previews contain at most 100 exact cited revisions in chronological source order.
  while (last + 1 < meeting.segments.length && exactCitations.has(`${meeting.segments[last + 1].id}:${meeting.segments[last + 1].revision}`) && canJoin(meeting.segments[last], meeting.segments[last + 1])) last++;
  const lastCited = last;
  while (last + 1 < meeting.segments.length && last - lastCited < 12 && canJoin(meeting.segments[last], meeting.segments[last + 1])) last++;
  const nearby = meeting.segments.slice(first, last + 1);
  const isCurrent = current.revision === evidence.revision;
  return <div className="evidence-context">
    <p className="small muted">{t("Current transcript context for this passage; surrounding text may be cited separately elsewhere.", "以下是此段落的当前转录上下文；周边文字可能另有单独引用。")}</p>
    {!isCurrent && <p className="small muted">{t("The current passage differs from the saved cited revision shown above.", "当前段落与上方保存的引用版本不同。")}</p>}
    <p className="evidence-context-text">{nearby.map((segment, offset) => {
      const previous = nearby[offset - 1];
      const gap = previous && !/[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]$/u.test(previous.text) && !/^[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af.,!?;:，。！？；：、）)\]}]/u.test(segment.text) ? " " : "";
      return <span key={segment.id}>{gap}{exactCitations.has(`${segment.id}:${segment.revision}`) ? <mark>{segment.text}</mark> : segment.text}</span>;
    })}</p>
    {isCurrent && <p className="small muted">{t("Highlighted text contains the cited passage or selected cited group; other text is shown here as context.", "高亮文字是引用段落或选中的引用组；其余文字在此仅作为上下文显示。")}</p>}
  </div>;
}
