import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Pause, Play, Plus } from "lucide-react";
import type { Meeting } from "../domain/model";
import { editMeeting, formatTime } from "../domain/operations";
import {
  buildPlaybackCaptions,
  captionsAtTime,
  hasValidTimedSegments,
  playbackCaptionWindowStart,
} from "../domain/playback";
import {
  buildSpeakerWindows,
  speakerActivity,
  type SpeakerWindow,
} from "../domain/speaker-review";
import type { PlaybackStatus } from "./usePlaybackClock";
import { Pill } from "../components/ui";

type Translate = (english: string, chinese: string) => string;

function hasUnsavedReferenceVideoDraft() {
  return (
    typeof document !== "undefined" &&
    document.querySelector('.reference-video[data-unsaved-edit="true"]') !== null
  );
}

export function SpeakerReview({
  meeting,
  audioAvailable,
  duration,
  position,
  playing,
  playbackStatus,
  locked,
  onCue,
  onPause,
  onChange,
  onMerge,
  onAdd,
  t: translate,
  onPlaybackRangeChange,
  referenceVideo,
}: {
  meeting: Meeting;
  audioAvailable: boolean;
  duration: number;
  position: number;
  playing: boolean;
  playbackStatus: PlaybackStatus;
  locked: boolean;
  onCue: (start: number, end: number) => void;
  onPause: () => void;
  onChange: (fn: (meeting: Meeting) => Meeting) => Promise<void>;
  onMerge: (speakerId: string) => void;
  onAdd: () => void;
  t: Translate;
  onPlaybackRangeChange?: (range: { start: number; end: number } | null) => void;
  referenceVideo?: ReactNode;
}) {
  const [windowSeconds, setWindowSeconds] = useState(20);
  const canPlayback = audioAvailable && hasValidTimedSegments(meeting.segments);
  const [mode, setMode] = useState<"playback" | "naming">(
    canPlayback && !meeting.synthetic ? "playback" : "naming",
  );
  const modeTouched = useRef(false);
  const [modeNotice, setModeNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const savedNames = useRef<Record<string, string>>({});
  const activity = useMemo(
    () => speakerActivity(meeting.segments, position),
    [meeting.segments, position],
  );
  const activelyPlaying = playing && playbackStatus === "playing";
  const playbackLabel =
    playbackStatus === "buffering"
      ? translate("Buffering local recording", "正在缓冲本地录音")
      : playbackStatus === "ended"
        ? translate("Playback ended", "播放已结束")
        : playbackStatus === "error"
          ? translate("Playback error", "播放出错")
          : activelyPlaying
            ? translate("Playing local recording", "正在播放本地录音")
            : translate("Playback paused", "播放已暂停");
  const t = (english: string, chinese: string) =>
    english === "Playing local recording" || english === "Playback paused"
      ? playbackLabel
      : translate(english, chinese);
  const referenceDraftNotice = translate(
    "Save or reset your video reference draft before switching modes.",
    "切换模式前，请保存或重置视频参考草稿。",
  );

  useEffect(() => {
    if (!canPlayback && mode === "playback") {
      if (hasUnsavedReferenceVideoDraft()) {
        setModeNotice(referenceDraftNotice);
        return;
      }
      setModeNotice("");
      setMode("naming");
    } else if (canPlayback && !meeting.synthetic && !modeTouched.current) {
      if (hasUnsavedReferenceVideoDraft()) {
        setModeNotice(referenceDraftNotice);
        return;
      }
      setModeNotice("");
      setMode("playback");
    }
  }, [canPlayback, meeting.synthetic, mode, referenceDraftNotice]);

  function requestMode(nextMode: "playback" | "naming") {
    if (nextMode === mode) {
      if (!hasUnsavedReferenceVideoDraft()) setModeNotice("");
      return;
    }
    if (hasUnsavedReferenceVideoDraft()) {
      setModeNotice(referenceDraftNotice);
      return;
    }
    modeTouched.current = true;
    setModeNotice("");
    setMode(nextMode);
  }

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

  const hasUnsavedDraft = meeting.speakers.some(
    (speaker) => (drafts[speaker.id] ?? speaker.name) !== speaker.name,
  );

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
      <span
        className="speaker-review-dirty-sentinel"
        data-unsaved-edit={hasUnsavedDraft ? "true" : undefined}
        aria-hidden="true"
      />
      <div className="speaker-review-toolbar">
        <div>
          <p className="small muted">
            {activity.activeSpeakerIds.length
              ? t(
                  `${activelyPlaying ? "Speaking now" : "At playback position"}: ${activity.activeSpeakerIds
                    .map(
                      (id) =>
                        meeting.speakers.find((speaker) => speaker.id === id)?.name ??
                        "Unknown",
                    )
                    .join(" + ")}`,
                  `${activelyPlaying ? "当前发言" : "当前播放位置"}：${activity.activeSpeakerIds
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
          <p className="small muted">
            {activelyPlaying
              ? t("Playing local recording", "正在播放本地录音")
              : t("Playback paused", "播放已暂停")}{" "}
            · {formatTime(position)}
            {activity.hasUntimed &&
              ` · ${t("Some passages have no time", "部分段落没有时间")}`}
          </p>
        </div>
        <div className="speaker-review-controls">
          <div className="speaker-mode-switch" role="group" aria-label={t("Speaker review mode", "说话人审阅模式")}>
            <button
              className={`button compact ${mode === "playback" ? "primary" : "secondary"}`}
              aria-pressed={mode === "playback"}
              disabled={!canPlayback}
              onClick={() => requestMode("playback")}
            >
              {t("Playback mode", "播放模式")}
            </button>
            <button
              className={`button compact ${mode === "naming" ? "primary" : "secondary"}`}
              aria-pressed={mode === "naming"}
              onClick={() => requestMode("naming")}
            >
              {t("Edit speakers", "编辑说话人")}
            </button>
          </div>
          {mode === "naming" && (
            <>
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
            </>
          )}
        </div>
      </div>
      {modeNotice && <p className="notice sand" role="alert">{modeNotice}</p>}
      {mode === "playback" ? (
        <PlaybackMode
          meeting={meeting}
          position={position}
          playing={activelyPlaying}
          playbackStatus={playbackStatus}
          audioAvailable={audioAvailable}
          duration={duration}
          onCue={onCue}
          onPause={onPause}
          onPlaybackRangeChange={onPlaybackRangeChange}
          t={t}
          referenceVideo={referenceVideo}
        />
      ) : <>
      <div className="speaker-stage" aria-label={t("Speaker stage", "说话人舞台")}>
        {meeting.speakers.map((speaker) => {
          const active = activelyPlaying && activity.activeSpeakerIds.includes(speaker.id);
          const atPosition = activity.activeSpeakerIds.includes(speaker.id);
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
                    : atPosition
                      ? t("At playback position", "当前播放位置")
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
                  {turns.length} {t("transcript fragments", "段转录片段")} · {timed
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
      </>}
    </>
  );
}

function PlaybackMode({
  meeting,
  position,
  playing,
  playbackStatus,
  audioAvailable,
  duration,
  onCue,
  onPause,
  onPlaybackRangeChange,
  t,
  referenceVideo,
}: {
  meeting: Meeting;
  position: number;
  playing: boolean;
  playbackStatus: PlaybackStatus;
  audioAvailable: boolean;
  duration: number;
  onCue: (start: number, end: number) => void;
  onPause: () => void;
  onPlaybackRangeChange?: (range: { start: number; end: number } | null) => void;
  t: Translate;
  referenceVideo?: ReactNode;
}) {
  const captions = useMemo(
    () => buildPlaybackCaptions(meeting.segments),
    [meeting.segments],
  );
  const current = useMemo(
    () => captionsAtTime(captions, position),
    [captions, position],
  );
  const activity = useMemo(
    () => speakerActivity(meeting.segments, position),
    [meeting.segments, position],
  );
  useEffect(() => {
    if (!onPlaybackRangeChange) return;
    if (!current.length) {
      onPlaybackRangeChange(null);
      return;
    }
    const intervals = current.flatMap((caption) => caption.sourceIntervals);
    const start = Math.min(...intervals.map((interval) => interval.start));
    const end = Math.max(...intervals.map((interval) => interval.end));
    onPlaybackRangeChange({ start, end });
  }, [current, onPlaybackRangeChange]);
  const [followPlayback, setFollowPlayback] = useState(true);
  const [captionSize, setCaptionSize] = useState<"normal" | "large" | "xlarge">("normal");
  const [pageStart, setPageStart] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const programmaticScroll = useRef(false);
  const automaticStart = playbackCaptionWindowStart(captions, position, 80);
  const start = followPlayback ? automaticStart : Math.min(pageStart, Math.max(0, captions.length - 80));
  const visible = captions.slice(start, start + 80);
  const activeIds = new Set(
    (playing ? activity.activeSpeakerIds : []).filter(Boolean),
  );
  const currentIds = new Set(activity.activeSpeakerIds);
  const heroSpeakers = meeting.speakers.filter((speaker) =>
    (playing ? activeIds : currentIds).has(speaker.id),
  );
  const captionText = current.length
    ? current
        .map((caption) => {
          const names = caption.speakerIds.length
            ? caption.speakerIds
                .map(
                  (id) =>
                    meeting.speakers.find((speaker) => speaker.id === id)?.name ??
                    t("Unknown speaker", "未知说话人"),
                )
                .join(" + ")
            : t("Unknown speaker", "未知说话人");
          return `${names}: ${caption.text}`;
        })
        .join(" ")
    : t("No attributed speaker at this position.", "此位置没有已归属的说话人。");

  function suspendFollowFromUser() {
    if (!followPlayback) return;
    setPageStart(automaticStart);
    setFollowPlayback(false);
  }

  useEffect(() => {
    if (!followPlayback) return;
    const container = list.current;
    if (!container) return;
    programmaticScroll.current = true;
    const target = current.length
      ? container.querySelector<HTMLElement>(
          `[data-caption-id="${CSS.escape(current[0].id)}"]`,
        )
      : null;
    if (target) {
      const listBox = container.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      if (targetBox.top < listBox.top)
        container.scrollTop -= listBox.top - targetBox.top;
      else if (targetBox.bottom > listBox.bottom)
        container.scrollTop += targetBox.bottom - listBox.bottom;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        programmaticScroll.current = false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [current, followPlayback, start]);

  return (
    <div className="playback-mode">
      <section className="playback-stage" aria-label={t("Live playback", "实时播放")}>
        <div className="playback-stage-heading">
          <div>
            <p className="eyebrow">{t("PLAYBACK MODE", "播放模式")}</p>
            <h3>{playing ? t("Now speaking", "当前发言") : t("Paused position", "暂停位置")}</h3>
          </div>
          <span className={`playback-state${playing ? " is-playing" : ""}`}>
            {playing ? t("Playing", "播放中") : t("Paused", "已暂停")} · {formatTime(position)}
          </span>
        </div>
        <p className="small muted playback-status-label" role="status" data-playback-status={playbackStatus}>
          {playbackStatus === "buffering"
            ? t("Buffering", "缓冲中")
            : playbackStatus === "ended"
              ? t("Ended", "已结束")
              : playbackStatus === "error"
                ? t("Playback error", "播放出错")
                : playbackStatus === "playing"
                  ? t("Playing", "播放中")
                  : t("Paused", "已暂停")}
        </p>
        <div className={`playback-hero${heroSpeakers.length ? "" : " is-empty"}`} aria-live="polite">
          {heroSpeakers.length ? (
            heroSpeakers.map((speaker) => {
              const speakerIndex = meeting.speakers.findIndex((item) => item.id === speaker.id);
              return (
                <div className="playback-hero-speaker" key={speaker.id} data-speaker-hero="true">
                  <span
                    className="speaker-avatar hero"
                    style={{
                      background: ["#e7efda", "#ede7f4", "#faeed9", "#e3edef", "#f3e8d6"][speakerIndex % 5],
                    }}
                    aria-hidden="true"
                  >
                    {speaker.name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{speaker.name}</strong>
                    <span className="small muted">
                      {playing ? t("Speaking", "正在说话") : t("At position", "当前位置")}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="playback-hero-empty">
              {t("No speaker at this position", "此位置没有说话人")}
            </div>
          )}
        </div>
        <div className="playback-active-speakers">
          {meeting.speakers.map((speaker, index) => {
            const isActive = activeIds.has(speaker.id);
            const atPosition = currentIds.has(speaker.id);
            return (
              <div
                key={speaker.id}
                className={`playback-speaker${isActive ? " is-active" : ""}${atPosition && !isActive ? " is-at-position" : ""}`}
                data-speaker-active={isActive ? "true" : "false"}
              >
                <span
                  className="speaker-avatar large"
                  style={{
                    background: ["#e7efda", "#ede7f4", "#faeed9", "#e3edef", "#f3e8d6"][index % 5],
                  }}
                  aria-hidden="true"
                >
                  {speaker.name.slice(0, 1)}
                </span>
                <strong>{speaker.name}</strong>
                <span className="small muted">
                  {isActive
                    ? t("Speaking", "正在说话")
                    : atPosition
                      ? t("At position", "当前位置")
                      : speaker.confirmed
                        ? t("Confirmed", "已确认")
                        : t("Unconfirmed", "未确认")}
                </span>
                <span className="speaker-number" aria-label={`${t("Speaker", "说话人")} ${index + 1}`}>
                  S{index + 1}
                </span>
              </div>
            );
          })}
        </div>
        <div className="live-caption" role="region" aria-label={t("Live captions", "实时字幕")}>
          <div className="live-caption-head">
            <span className="small muted">{t("Live captions", "实时字幕")}</span>
            <label className="small muted">
              {t("Caption size", "字幕大小")}
              <select
                aria-label={t("Caption size", "字幕大小")}
                value={captionSize}
                onChange={(event) =>
                  setCaptionSize(event.target.value as "normal" | "large" | "xlarge")
                }
              >
                <option value="normal">{t("Normal", "标准")}</option>
                <option value="large">{t("Large", "大")}</option>
                <option value="xlarge">{t("Extra large", "特大")}</option>
              </select>
            </label>
          </div>
          <p className={`caption-${captionSize}`}>{captionText}</p>
        </div>
        {playing ? (
          <button className="button secondary compact" onClick={onPause}>
            <Pause size={14} /> {t("Pause", "暂停")}
          </button>
        ) : null}
      </section>
      <section className="playback-transcript-panel" aria-label={t("Playback transcript", "播放转录")}>
        <div className="playback-transcript-head">
          <div>
            <h3>{t("Transcript", "转录")}</h3>
            <p className="small muted">
              {captions.length} {t("timed caption groups", "个有时间字幕组")} · {t("source timing preserved", "保留源时间")}
            </p>
          </div>
          {!followPlayback && (
            <button
              className="button secondary compact"
              onClick={() => {
                setFollowPlayback(true);
                setPageStart(automaticStart);
              }}
            >
              {t("Follow playback", "跟随播放")}
            </button>
          )}
        </div>
        <div
          className="playback-transcript-list"
          ref={list}
          onWheel={suspendFollowFromUser}
          onTouchMove={suspendFollowFromUser}
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key))
              suspendFollowFromUser();
          }}
          tabIndex={0}
          role="list"
          aria-label={t("Timed captions", "有时间字幕")}
        >
          {visible.map((caption) => {
            const active = current.includes(caption);
            const names = caption.speakerIds.length
              ? caption.speakerIds
                  .map(
                    (id) =>
                      meeting.speakers.find((speaker) => speaker.id === id)?.name ??
                      t("Unknown speaker", "未知说话人"),
                  )
                  .join(" + ")
              : t("Unknown speaker", "未知说话人");
            return (
              <div key={caption.id} role="listitem" className="playback-caption-list-item">
                <button
                  type="button"
                data-caption-id={caption.id}
                className={`playback-caption-row${active ? " is-active" : ""}`}
                onClick={() => onCue(caption.start, caption.end)}
                disabled={!audioAvailable}
              >
                <span className="playback-caption-time">{formatTime(caption.start)} · {names}</span>
                <span>{caption.text}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="playback-transcript-paging">
          <button
            className="text-button"
            disabled={start === 0}
            onClick={() => {
              setFollowPlayback(false);
              setPageStart(Math.max(0, start - 60));
            }}
          >
            {t("Load earlier", "加载更早内容")}
          </button>
          <span className="small muted">{Math.min(start + 1, captions.length)}–{Math.min(start + visible.length, captions.length)} / {captions.length}</span>
          <button
            className="text-button"
            disabled={start + visible.length >= captions.length}
            onClick={() => {
              setFollowPlayback(false);
              setPageStart(Math.min(Math.max(0, captions.length - 80), start + 60));
            }}
          >
            {t("Load later", "加载更晚内容")}
          </button>
        </div>
      </section>
      {referenceVideo && (
        <details className="playback-reference">
          <summary>{t("Reference video", "参考视频")}</summary>
          {referenceVideo}
        </details>
      )}
      {duration <= 0 && (
        <p className="notice sand">{t("Recording duration is unavailable; playback timing may be limited.", "录音时长不可用，播放时间可能受限。")}</p>
      )}
    </div>
  );
}
