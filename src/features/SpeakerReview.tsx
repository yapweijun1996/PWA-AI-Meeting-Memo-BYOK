import { speakerBackground } from "../components/speaker-appearance";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Pause, Play, Plus } from "lucide-react";
import type { Meeting } from "../domain/model";
import { editMeeting, formatTime } from "../domain/operations";
import {
  buildPlaybackCaptions,
  captionsAtTime,
  captionContextAtTime,
  hasValidTimedSegments,
  fragmentsAtTime,
  playbackCaptionWindowStart,
} from "../domain/playback";
import {
  buildSpeakerWindows,
  speakerActivity,
  type SpeakerWindow,
} from "../domain/speaker-review";
import type { SpeakerLink } from "../domain/long-audio";
import type { PlaybackStatus } from "./usePlaybackClock";
import { suggestVideoId } from "../domain/reference-video";
import { Pill } from "../components/ui";

type Translate = (english: string, chinese: string) => string;

function hasUnsavedReferenceVideoDraft() {
  return (
    typeof document !== "undefined" &&
    document.querySelector('.reference-video[data-unsaved-edit="true"]') !== null
  );
}

const WINDOW_HYSTERESIS = 25;

export function SpeakerReview({
  meeting,
  audioAvailable,
  duration,
  position,
  playing,
  playbackStatus,
  locked,
  onCue,
  onSeek,
  onPause,
  onChange,
  onMerge,
  onMergeGroups,
  onSelectMerge,
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
  onSeek: (position: number) => void;
  onPause: () => void;
  onChange: (fn: (meeting: Meeting) => Meeting) => Promise<void>;
  onMerge: (speakerId: string) => void;
  onMergeGroups: (groups: string[][]) => Promise<void>;
  onSelectMerge: (speakerIds: string[]) => void;
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
  const pendingSpeakerFocus = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const [modeNotice, setModeNotice] = useState("");
  const [mergeNotice, setMergeNotice] = useState("");
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

  function requestMode(nextMode: "playback" | "naming"): boolean {
    if (nextMode === mode) {
      if (!hasUnsavedReferenceVideoDraft()) setModeNotice("");
      return true;
    }
    if (hasUnsavedReferenceVideoDraft()) {
      setModeNotice(referenceDraftNotice);
      return false;
    }
    modeTouched.current = true;
    setModeNotice("");
    setMode(nextMode);
    return true;
  }

  function openSpeakerEditor(speakerId: string) {
    pendingSpeakerFocus.current = speakerId || null;
    if (!requestMode("naming")) {
      pendingSpeakerFocus.current = null;
    }
  }

  useEffect(() => {
    if (mode !== "naming" || !pendingSpeakerFocus.current) return;
    const targetId = pendingSpeakerFocus.current;
    pendingSpeakerFocus.current = null;
    const input = document.querySelector<HTMLInputElement>(
      `input[data-speaker-input-id="${CSS.escape(targetId)}"]`,
    );
    if (input) {
      input.scrollIntoView({ block: "nearest" });
      input.focus();
      input.select();
    }
  }, [mode]);

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

  const visibleLinks = (meeting.speakerLinks ?? []).filter((link) =>
    meeting.speakers.some((speaker) => speaker.id === link.fromSpeakerId)
      && meeting.speakers.some((speaker) => speaker.id === link.toSpeakerId),
  );
  const linkGroups = connectedLinkGroups(visibleLinks);
  const visibleSelected = selectedSpeakers.filter((speakerId) => meeting.speakers.some((speaker) => speaker.id === speakerId));
  async function mergeSuggested(groups: string[][]) {
    try {
      await onMergeGroups(groups);
      setMergeNotice(t("Speakers merged. Use Undo to restore them.", "说话人已合并。使用“撤销”可还原。"));
      setSelectedSpeakers([]);
    } catch {
      setMergeNotice(t("Could not merge these speakers.", "无法合并这些说话人。"));
    }
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
          {mode === "playback" ? (
            <p className="small muted">
              {meeting.speakers.length > 0
                ? meeting.speakers.some((speaker) => !speaker.confirmed)
                  ? t(
                      "Click any speaker card below to edit their name, or select a transcript row to jump audio.",
                      "点击下方任意说话人卡片可直接编辑姓名，或点击右侧转录行跳转播放。",
                    )
                  : t(
                      "All speaker names confirmed · select any transcript row to jump audio.",
                      "全部说话人姓名已确认 · 点击右侧任意转录行可跳转播放。",
                    )
                : t("No speaker labels yet.", "还没有说话人标签。")}
              {activity.hasUntimed &&
                ` · ${t("Some passages have no time", "部分段落没有时间")}`}
            </p>
          ) : (
            <>
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
            </>
          )}
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
      {linkGroups.length > 0 && (
        <section className="notice sand speaker-link-panel" aria-labelledby="speaker-links-title">
          <h3 id="speaker-links-title">{t("Suggested same-speaker links from overlapping audio", "重叠音频中的同一说话人建议链接")}</h3>
          <p>{t("Suggestions are based on matching words in overlapping audio, not voice identity. Merging can be undone with Undo.", "这些建议基于重叠音频中的匹配词语，并非声音身份识别。合并后可使用“撤销”还原。")}</p>
          <button className="button primary compact" disabled={locked} onClick={() => void mergeSuggested(linkGroups.map((group) => group.ids))}>
            {t("Merge all suggested groups", "合并所有建议组")}
          </button>
          {linkGroups.map((group) => (
            <article key={group.ids.join("|")} className="speaker-link-group">
              <p>{group.ids.map((speakerId) => meeting.speakers.find((speaker) => speaker.id === speakerId)?.name ?? speakerId).join(" → ")}</p>
              {group.links.map((link) => (
                <p className="small muted" key={`${link.fromSpeakerId}:${link.toSpeakerId}`}>
                  {t(`${link.sharedWords} matching words across the part overlap`, `分段重叠处有 ${link.sharedWords} 个匹配词`)}
                </p>
              ))}
              <button className="button secondary compact" disabled={locked} onClick={() => void mergeSuggested([group.ids])}>{t("Merge this group", "合并此组")}</button>
              <button className="text-button" disabled={locked} onClick={() => {
                const keys = new Set(group.links.map((link) => `${link.fromSpeakerId}\u0000${link.toSpeakerId}`));
                void onChange((current) => editMeeting(current, (draft) => {
                  draft.speakerLinks = draft.speakerLinks?.filter((link) => !keys.has(`${link.fromSpeakerId}\u0000${link.toSpeakerId}`));
                }));
              }}>{t("Not the same", "不是同一人")}</button>
            </article>
          ))}
        </section>
      )}
      {mergeNotice && <p role="status" aria-live="polite">{mergeNotice}</p>}
      {mode === "playback" ? (
        <PlaybackMode
          meeting={meeting}
          position={position}
          playing={activelyPlaying}
          playbackStatus={playbackStatus}
          audioAvailable={audioAvailable}
          duration={duration}
          locked={locked}
          onSeek={onSeek}
          onPause={onPause}
          onSelectSpeaker={openSpeakerEditor}
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
      {visibleSelected.length >= 2 && (
        <div className="speaker-selection-bar">
          <span>{t(`${visibleSelected.length} selected`, `已选择 ${visibleSelected.length} 位`)}</span>
          <button className="button primary compact" disabled={locked} onClick={() => onSelectMerge(visibleSelected)}>
            {t("Merge selected", "合并所选")}
          </button>
        </div>
      )}
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
                  <label>
                    <input
                      type="checkbox"
                      aria-label={t(`Select ${speaker.name}`, `选择${speaker.name}`)}
                      checked={visibleSelected.includes(speaker.id)}
                      disabled={locked}
                      onChange={(event) => setSelectedSpeakers((current) => event.target.checked
                        ? [...current, speaker.id]
                        : current.filter((id) => id !== speaker.id))}
                    />
                    {t("Select", "选择")}
                  </label>
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
                    data-speaker-input-id={speaker.id}
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

function connectedLinkGroups(links: SpeakerLink[]): { ids: string[]; links: SpeakerLink[] }[] {
  const remaining = new Set(links);
  const groups: { ids: string[]; links: SpeakerLink[] }[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as SpeakerLink;
    const component = new Set<string>([first.fromSpeakerId, first.toSpeakerId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const link of remaining) {
        if (component.has(link.fromSpeakerId) || component.has(link.toSpeakerId)) {
          const size = component.size;
          component.add(link.fromSpeakerId);
          component.add(link.toSpeakerId);
          changed ||= component.size !== size;
        }
      }
    }
    const componentLinks = links.filter((link) => component.has(link.fromSpeakerId) && component.has(link.toSpeakerId));
    for (const link of componentLinks) remaining.delete(link);
    const ids: string[] = [];
    for (const link of componentLinks) {
      if (!ids.includes(link.fromSpeakerId)) ids.push(link.fromSpeakerId);
      if (!ids.includes(link.toSpeakerId)) ids.push(link.toSpeakerId);
    }
    groups.push({ ids, links: componentLinks });
  }
  return groups;
}

function PlaybackMode({
  meeting,
  position,
  playing,
  playbackStatus,
  audioAvailable,
  duration,
  locked,
  onSeek,
  onPause,
  onSelectSpeaker,
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
  locked: boolean;
  onSeek: (position: number) => void;
  onPause: () => void;
  onSelectSpeaker: (speakerId: string) => void;
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
  const context = useMemo(
    () => captionContextAtTime(captions, position),
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
  const lastProgrammaticTop = useRef(0);
  const automaticStart = playbackCaptionWindowStart(captions, position, 80);
  // The rendered window only moves once the playhead is well away from where it was placed, so rows are not
  // swapped on every caption.
  const [stickyStart, setStickyStart] = useState(automaticStart);
  const windowStart = Math.abs(automaticStart - stickyStart) > WINDOW_HYSTERESIS ? automaticStart : stickyStart;
  if (windowStart !== stickyStart) setStickyStart(windowStart);
  const start = followPlayback ? windowStart : Math.min(pageStart, Math.max(0, captions.length - 80));
  const activeCaptionId = current[0]?.id ?? null;
  const visible = captions.slice(start, start + 80);
  const activeIds = new Set(
    (playing ? activity.activeSpeakerIds : []).filter(Boolean),
  );
  const currentIds = new Set(activity.activeSpeakerIds);
  const betweenWords = context.length > 0;
  const [untimedStart, setUntimedStart] = useState(0);
  const untimed = useMemo(() => meeting.segments.filter((segment) =>
    !hasValidTimedSegments([segment])), [meeting.segments]);
  const nextCaption = useMemo(
    () => captions.find((caption) => caption.start > position + 0.05) ?? null,
    [captions, position],
  );
  const jumpTarget = nextCaption ?? captions[0] ?? null;
  const hasVideoSaved = Boolean(meeting.referenceVideo?.youtubeId);
  const hasVideoSuggestion =
    !hasVideoSaved && Boolean(suggestVideoId(meeting.audio?.name));
  const statusLabel =
    playbackStatus === "buffering"
      ? t("Buffering", "缓冲中")
      : playbackStatus === "ended"
        ? t("Ended", "已结束")
        : playbackStatus === "error"
          ? t("Playback error", "播放出错")
          : playbackStatus === "playing"
            ? t("Playing", "播放中")
            : t("Paused", "已暂停");

  function suspendFollowFromUser() {
    if (!followPlayback) return;
    setPageStart(start);
    setFollowPlayback(false);
  }

  useEffect(() => {
    if (!followPlayback || activeCaptionId === null) return;
    const container = list.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      `[data-caption-id="${CSS.escape(activeCaptionId)}"]`,
    );
    if (!target) return;
    programmaticScroll.current = true;
    const listBox = container.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    // Scroll only when the active row leaves the middle band, and then put it in the middle, so a normal
    // caption change does not move the list at all.
    const bandTop = listBox.top + listBox.height * 0.2;
    const bandBottom = listBox.bottom - listBox.height * 0.2;
    if (targetBox.top < bandTop || targetBox.bottom > bandBottom) {
      const delta = targetBox.top + targetBox.height / 2 - (listBox.top + listBox.height / 2);
      container.scrollTop += delta;
    }
    lastProgrammaticTop.current = container.scrollTop;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        programmaticScroll.current = false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeCaptionId, followPlayback, start]);

  return (
    <div className="playback-mode">
      <div className="playback-left-stack">
        <section className="playback-stage" aria-label={t("Live playback", "实时播放")}>
          <div className="playback-stage-heading">
            <h3>{t("Speaker & captions", "说话人与字幕")}</h3>
            <span
              className={`playback-state${playing ? " is-playing" : ""}`}
              data-playback-status={playbackStatus}
            >
              <span role="status">{statusLabel}</span>
              <span aria-hidden="true"> · </span>
              <span>{formatTime(position)}</span>
            </span>
          </div>
          {!current.length && (
            <div className="playback-gap small muted">
              <span>{betweenWords
                ? t("Between words · context only", "词间停顿 · 仅作上下文")
                : t("No attributed speaker at this timestamp.", "此时间点没有已归属的说话人。")}</span>
              {audioAvailable && jumpTarget && (
                <button type="button" className="text-button" onClick={() => onSeek(jumpTarget.start)}>
                  {nextCaption ? t("Next speech", "下一段发言") : t("First speech", "首段发言")} · {formatTime(jumpTarget.start)}
                </button>
              )}
            </div>
          )}
          <div className="live-caption-head">
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

          {meeting.speakers.length > 0 && (
            <div className="playback-roster">
              <div className="playback-roster-head">
                <span className="small muted">{t("Speakers in this meeting", "本场会议说话人")}</span>
                <button
                  type="button"
                  className="text-button playback-edit-link"
                  disabled={locked}
                  onClick={() => onSelectSpeaker(meeting.speakers.find((s) => !s.confirmed)?.id ?? meeting.speakers[0].id)}
                >
                  {t("Edit & confirm names →", "编辑并确认姓名 →")}
                </button>
              </div>
              <div className="playback-active-speakers">
                {meeting.speakers.map((speaker, index) => {
                  const isActive = activeIds.has(speaker.id);
                  const atPosition = currentIds.has(speaker.id);
                  return (
                    <button
                      type="button"
                      key={speaker.id}
                      disabled={locked}
                      title={t("Edit speaker name and listen to samples", "编辑此说话人姓名并试听样本")}
                      onClick={() => onSelectSpeaker(speaker.id)}
                      className={`playback-speaker${isActive ? " is-active" : ""}${atPosition && !isActive ? " is-at-position" : ""}`}
                      data-speaker-active={isActive ? "true" : "false"}
                      data-speaker-hero={atPosition ? "true" : "false"}
                    >
                      <span
                        className="speaker-avatar large"
                        style={{
                          background: speakerBackground(index),
                        }}
                        aria-hidden="true"
                      >
                        {/^Speaker \d+$/.test(speaker.name) ? `S${index + 1}` : speaker.name.slice(0, 1)}
                      </span>
                      <strong>{speaker.name}</strong>
                      {isActive && <span className="chat-wave" aria-hidden="true">·|·|·</span>}
                      <span className="small muted">
                        {isActive
                          ? t("Speaking", "正在说话")
                          : atPosition
                            ? (playbackStatus === "paused" || playbackStatus === "idle"
                              ? t("Paused here", "暂停于此") : statusLabel)
                            : t("Idle", "空闲")}
                      </span>
                      <span className="speaker-number" aria-hidden="true">
                        S{index + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {playing ? (
            <div className="playback-stage-footer">
              <button className="button secondary compact" onClick={onPause}>
                <Pause size={14} /> {t("Pause", "暂停")}
              </button>
            </div>
          ) : null}
        </section>
        {referenceVideo && (
          <details className="playback-reference">
            <summary>
              <span>{t("Reference video", "参考视频")}</span>
              {(hasVideoSaved || hasVideoSuggestion) && (
                <span className="playback-reference-badge">
                  {hasVideoSaved
                    ? t("Linked", "已关联")
                    : t("Video ID suggested", "检测到视频建议")}
                </span>
              )}
            </summary>
            {referenceVideo}
          </details>
        )}
      </div>
      <section className="playback-transcript-panel" aria-label={t("Playback transcript", "播放转录")}>
        <div className="playback-transcript-head">
          <div>
            <h3 className="chat-divider">{t("Meeting transcript", "会议转录")}</h3>
            <p className="small muted">
              {captions.length} {t("timed caption groups", "个有时间字幕组")} · {t("source timing preserved", "保留源时间")}
            </p>
          </div>
          <span className={`playback-follow-chip${followPlayback ? " is-following" : ""}`} role="status">
            {followPlayback ? t("Following playback", "正在跟随播放") : t("Follow paused", "已暂停跟随")}
          </span>
          {!followPlayback && (
            <button
              className="button secondary compact"
              onClick={() => {
                setFollowPlayback(true);
                setStickyStart(automaticStart);
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
          onScroll={(event) => {
            if (programmaticScroll.current || !followPlayback) return;
            if (Math.abs(event.currentTarget.scrollTop - lastProgrammaticTop.current) < 2) return;
            suspendFollowFromUser();
          }}
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX >= box.right - 20) suspendFollowFromUser();
          }}
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
                onClick={() => onSeek(caption.start)}
                disabled={!audioAvailable}
              >
                <span className="chat-speaker-name">{names}</span>
                {active && playing && <span className="chat-wave" aria-hidden="true">·|·|·</span>}
                <span className="chat-avatars" aria-hidden="true">
                  {caption.speakerIds.length ? caption.speakerIds.map((id) => {
                    const index = meeting.speakers.findIndex((speaker) => speaker.id === id);
                    return <span key={id} className="speaker-avatar" style={{ background: speakerBackground(Math.max(0, index)) }}>S{index + 1 || "?"}</span>;
                  }) : <span className="speaker-avatar">?</span>}
                </span>
                <span className="playback-caption-time">{formatTime(caption.start)}</span>
                <span className={`chat-text caption-${captionSize}`}>
                  {caption.fragments.map((fragment, index) => (
                    <span key={fragment.id} data-fragment-id={fragment.id}
                      data-fragment-active={fragmentsAtTime([fragment], position).length ? "true" : "false"}>
                      {index > 0 ? " " : ""}{fragment.text}
                    </span>
                  ))}
                </span>
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

      {untimed.length > 0 && (
        <details className="playback-untimed">
          <summary>{t("Timing unavailable", "时间信息不可用")} · {untimed.length}</summary>
          <p className="small muted">{t("These passages cannot be synchronized or used to seek.", "这些片段无法同步或跳转播放。")}</p>
          {untimed.slice(untimedStart, untimedStart + 80).map((segment) => <p key={segment.id}>{segment.text}</p>)}
          <button className="text-button" disabled={untimedStart === 0} onClick={() => setUntimedStart(Math.max(0, untimedStart - 80))}>{t("Load earlier", "加载更早内容")}</button>
          <button className="text-button" disabled={untimedStart + 80 >= untimed.length} onClick={() => setUntimedStart(untimedStart + 80)}>{t("Load later", "加载更晚内容")}</button>
        </details>
      )}
      {duration <= 0 && (
        <p className="notice sand">{t("Recording duration is unavailable; playback timing may be limited.", "录音时长不可用，播放时间可能受限。")}</p>
      )}
    </div>
  );
}
