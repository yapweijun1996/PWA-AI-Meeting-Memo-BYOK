import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Pause, Play, Plus } from "lucide-react";
import type { Meeting } from "../domain/model";
import { editMeeting, formatTime } from "../domain/operations";
import {
  buildSpeakerWindows,
  speakerActivity,
  type SpeakerWindow,
} from "../domain/speaker-review";
import { Pill } from "../components/ui";

type Translate = (english: string, chinese: string) => string;

export function SpeakerReview({
  meeting,
  audioAvailable,
  duration,
  position,
  playing,
  locked,
  onCue,
  onPause,
  onChange,
  onMerge,
  onAdd,
  t,
  referenceVideo,
}: {
  meeting: Meeting;
  audioAvailable: boolean;
  duration: number;
  position: number;
  playing: boolean;
  locked: boolean;
  onCue: (start: number, end: number) => void;
  onPause: () => void;
  onChange: (fn: (meeting: Meeting) => Meeting) => Promise<void>;
  onMerge: (speakerId: string) => void;
  onAdd: () => void;
  t: Translate;
  referenceVideo?: ReactNode;
}) {
  const [windowSeconds, setWindowSeconds] = useState(20);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const savedNames = useRef<Record<string, string>>({});
  const activity = useMemo(
    () => speakerActivity(meeting.segments, position),
    [meeting.segments, position],
  );

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const speaker of meeting.speakers) {
        const previousSaved = savedNames.current[speaker.id];
        const draft = next[speaker.id];
        const dirty =
          draft !== undefined &&
          previousSaved !== undefined &&
          draft !== previousSaved;
        if (!dirty) next[speaker.id] = speaker.name;
        savedNames.current[speaker.id] = speaker.name;
      }
      for (const key of Object.keys(next))
        if (!meeting.speakers.some((speaker) => speaker.id === key))
          delete next[key];
      return next;
    });
  }, [meeting.speakers]);

  const windowsBySpeaker = useMemo(() => {
    const windows = new Map<string, SpeakerWindow[]>();
    for (const speaker of meeting.speakers)
      windows.set(
        speaker.id,
        buildSpeakerWindows(
          meeting.segments,
          speaker.id,
          windowSeconds,
          duration || meeting.audio?.duration,
        ),
      );
    return windows;
  }, [meeting.segments, meeting.speakers, windowSeconds, duration, meeting.audio?.duration]);

  async function saveSpeaker(
    speakerId: string,
    action: "save" | "confirm" | "toggle",
  ) {
    const speaker = meeting.speakers.find((item) => item.id === speakerId);
    if (!speaker) return;
    const name = (drafts[speakerId] ?? speaker.name).trim().slice(0, 80);
    if (!name) return;
    const nameChanged = name !== speaker.name;
    if (action === "save" && !nameChanged) {
      setDrafts((current) => ({ ...current, [speakerId]: name }));
      setSaveErrors((current) => ({ ...current, [speakerId]: "" }));
      return;
    }
    const confirmed =
      action === "confirm"
        ? true
        : action === "toggle"
          ? false
          : nameChanged
            ? false
            : speaker.confirmed;
    setSaveErrors((current) => ({ ...current, [speakerId]: "" }));
    try {
      await onChange((current) =>
        editMeeting(current, (draft) => {
          const item = draft.speakers.find((candidate) => candidate.id === speakerId);
          if (!item) return;
          item.name = name;
          item.confirmed = confirmed;
        }),
      );
      // Normalize only after the CAS-backed save succeeds. A failed save keeps
      // the user's exact draft visible so it can be retried safely.
      setDrafts((current) => ({ ...current, [speakerId]: name }));
    } catch {
      setSaveErrors((current) => ({
        ...current,
        [speakerId]: t(
          "Could not save this speaker. Your draft is still here; retry after resolving the local save error.",
          "无法保存此说话人。草稿仍保留在此处；解决本地保存错误后再试。",
        ),
      }));
    }
  }

  function sampleText(window: SpeakerWindow) {
    if (!window.segments.length)
      return t("No transcript text in this range.", "此时间范围内没有转录文字。");
    const paragraphs: string[] = [];
    for (const segment of window.segments) {
      const labels = segment.speakerIds.length
        ? segment.speakerIds
            .map(
              (id) =>
                meeting.speakers.find((speaker) => speaker.id === id)?.name ??
                t("Unknown speaker", "未知说话人"),
            )
            .join(" + ")
        : t("Unknown speaker", "未知说话人");
      const previous = paragraphs.at(-1);
      const prefix = `${labels}: `;
      if (previous?.startsWith(prefix))
        paragraphs[paragraphs.length - 1] = `${previous} ${segment.text}`;
      else paragraphs.push(`${prefix}${segment.text}`);
    }
    return paragraphs.join(" ");
  }

  return (
    <>
      <div className="speaker-review-toolbar">
        <div>
          <p className="small muted">
            {activity.activeSpeakerIds.length
              ? t(
                  `Speaking now: ${activity.activeSpeakerIds
                    .map(
                      (id) =>
                        meeting.speakers.find((speaker) => speaker.id === id)?.name ??
                        "Unknown",
                    )
                    .join(" + ")}`,
                  `当前发言：${activity.activeSpeakerIds
                    .map(
                      (id) =>
                        meeting.speakers.find((speaker) => speaker.id === id)?.name ??
                        "未知说话人",
                    )
                    .join(" + ")}`,
                )
              : activity.hasGap
                ? t("No attributed speaker at this position", "此位置没有已归属的说话人")
                : t("Speaker timing is unavailable", "说话人时间不可用")}
          </p>
          <p className="small muted" aria-live="polite">
            {playing
              ? t("Playing local recording", "正在播放本地录音")
              : t("Playback paused", "播放已暂停")}{" "}
            · {formatTime(position)}
            {activity.hasUntimed &&
              ` · ${t("Some passages have no time", "部分段落没有时间")}`}
          </p>
        </div>
        <div className="speaker-review-controls">
          <label className="small muted">
            {t("Sample length", "样本长度")}
            <select
              aria-label={t("Sample length", "样本长度")}
              value={windowSeconds}
              onChange={(event) => setWindowSeconds(Number(event.target.value))}
              disabled={locked}
            >
              <option value="10">10s</option>
              <option value="20">20s</option>
              <option value="30">30s</option>
            </select>
          </label>
          {playing ? (
            <button className="button secondary compact" onClick={onPause}>
              <Pause size={14} /> {t("Pause", "暂停")}
            </button>
          ) : null}
          <button
            className="button secondary compact"
            disabled={locked}
            onClick={onAdd}
          >
            <Plus size={14} /> {t("Add speaker", "添加说话人")}
          </button>
        </div>
      </div>
      <div className="speaker-stage" aria-label={t("Speaker stage", "说话人舞台")}>
        {meeting.speakers.map((speaker) => {
          const active = activity.activeSpeakerIds.includes(speaker.id);
          return (
            <div
              key={speaker.id}
              className={`speaker-stage-card${active ? " is-active" : ""}`}
              data-speaker-active={active ? "true" : "false"}
            >
              <span className="speaker-avatar large" aria-hidden="true">
                {speaker.name.slice(0, 1)}
              </span>
              <div>
                <strong>{speaker.name}</strong>
                <span className="small muted">
                  {active
                    ? t("Speaking", "正在说话")
                    : speaker.confirmed
                      ? t("Identity confirmed", "姓名已确认")
                      : t("Unconfirmed", "未确认")}
                </span>
              </div>
              {active && <span className="speaker-wave" aria-hidden="true">● ● ●</span>}
            </div>
          );
        })}
        {!meeting.speakers.length && (
          <p className="small muted">{t("No speaker labels yet.", "还没有说话人标签。")}</p>
        )}
      </div>
      <div className="speaker-listening-layout">
        <div className="speaker-review-cards">
          {meeting.speakers.length ? (
            <div className="speaker-grid speaker-review-grid">
          {meeting.speakers.map((speaker, index) => {
            const windows = windowsBySpeaker.get(speaker.id) ?? [];
            const turns = meeting.segments.filter((segment) =>
              segment.speakerIds.includes(speaker.id),
            );
            const timed = turns.reduce(
              (sum, segment) =>
                sum +
                (segment.start !== null && segment.end !== null
                  ? segment.end - segment.start
                  : 0),
              0,
            );
            const draft = drafts[speaker.id] ?? speaker.name;
            return (
              <article key={speaker.id} className="speaker-card speaker-review-card">
                <div className="speaker-card-top">
                  <span className="speaker-avatar large" aria-hidden="true">
                    {speaker.name.slice(0, 1)}
                  </span>
                  <Pill tone={speaker.confirmed ? "green" : "sand"}>
                    {speaker.confirmed
                      ? t("Confirmed", "已确认")
                      : t("Needs a name", "需要确认姓名")}
                  </Pill>
                </div>
                <label>
                  {t("Display name", "显示名称")}
                  <input
                    aria-label={t(`Name for speaker ${index + 1}`, `第 ${index + 1} 位说话人的姓名`)}
                    value={draft}
                    maxLength={80}
                    disabled={locked}
                    data-unsaved-edit={draft !== speaker.name ? "true" : "false"}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [speaker.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                {saveErrors[speaker.id] && (
                  <p className="notice danger" role="alert">
                    {saveErrors[speaker.id]}
                  </p>
                )}
                <p className="small muted">
                  {turns.length} {t("passages", "段转录")} · {timed
                    ? `${formatTime(timed)} ${t("timed speech", "有时间记录的发言")}`
                    : t("Timing unavailable", "没有时间记录")}
                </p>
                <div className="speaker-samples">
                  {windows.length ? (
                    windows.map((window, sampleIndex) => (
                      <div className="speaker-sample" key={`${speaker.id}:${window.start}`}>
                        <button
                          className="button secondary compact"
                          disabled={!audioAvailable || locked}
                          onClick={() => onCue(window.start, window.end)}
                        >
                          <Play size={12} /> {t("Sample", "样本")} {sampleIndex + 1}
                        </button>
                        <span className="speaker-sample-range">
                          {formatTime(window.start)} – {formatTime(window.end)}
                        </span>
                        <p>{sampleText(window)}</p>
                        <span className="small muted">
                          {t("Range includes surrounding context; it may contain other voices.", "范围包含前后语境，可能包含其他声音。")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="small muted">
                      {t("No timed sample available.", "没有可播放的有时间样本。")}
                    </span>
                  )}
                </div>
                <div className="speaker-card-actions">
                  <button
                    className="button secondary compact"
                    disabled={locked || !draft.trim() || draft === speaker.name}
                    data-unsaved-edit={draft !== speaker.name ? "true" : "false"}
                    onClick={() => void saveSpeaker(speaker.id, "save")}
                  >
                    {t("Save name", "保存姓名")}
                  </button>
                  <button
                    className="button primary compact"
                    disabled={locked || !draft.trim()}
                    onClick={() =>
                      void saveSpeaker(
                        speaker.id,
                        speaker.confirmed ? "toggle" : "confirm",
                      )
                    }
                  >
                    <Check size={15} />
                    {speaker.confirmed
                      ? t("Leave unconfirmed", "取消姓名确认")
                      : t("Confirm name", "确认姓名")}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => onMerge(speaker.id)}
                    disabled={locked || meeting.speakers.length < 2}
                  >
                    {t("Merge…", "合并…")}
                  </button>
                </div>
              </article>
            );
          })}
            </div>
          ) : null}
        </div>
        {referenceVideo && (
          <aside className="speaker-review-video">{referenceVideo}</aside>
        )}
      </div>
    </>
  );
}
