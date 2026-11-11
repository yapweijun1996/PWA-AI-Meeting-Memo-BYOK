import "./SpeakerPlayback.css";
import { showToast } from "../components/ToastLayer";
import { SpeakerAvatar, useSpeakerAvatars } from "../components/SpeakerAvatar";
import { prepareAvatar, setSpeakerAvatar, trackAvatarWrite } from "../storage/speaker-avatars";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Pause, Play, Plus } from "lucide-react";
import type { Meeting } from "../domain/model";
import { editMeeting, formatTime } from "../domain/operations";
import { transcriptTextSeparator } from "../domain/transcript-groups";
import {
  buildPlaybackCaptions,
  captionsAtTime,
  captionContextAtTime,
  hasValidTimedSegments,
  fragmentsAtTime,
  NEXT_CAPTION_LOOKAHEAD,
  playbackBoundaries,
  playbackCaptionWindowStart,
  snapToPlaybackInterval,
} from "../domain/playback";
import {
  buildSpeakerWindows,
  speakerActivity,
  type SpeakerWindow,
} from "../domain/speaker-review";
import type { SpeakerLink } from "../domain/long-audio";
import type { PlaybackClockStore, PlaybackStatus } from "./usePlaybackClock";
import { suggestVideoId } from "../domain/reference-video";
import { ImmersivePlayback } from "./ImmersivePlayback";

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
  clock,
  playing,
  playbackStatus,
  locked,
  onCue,
  onSeek,
  onPause,
  onTogglePlayback,
  onChangeRate,
  playbackRate,
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
  /** Coarse playhead (about 4 Hz) for toolbar text and the naming-mode stage. */
  position: number;
  /** Exact playhead; PlaybackMode subscribes to it and only renders on caption/speaker boundaries. */
  clock: PlaybackClockStore;
  playing: boolean;
  playbackStatus: PlaybackStatus;
  locked: boolean;
  onCue: (start: number, end: number) => void;
  onSeek: (position: number) => void;
  onPause: () => void;
  onTogglePlayback: () => Promise<void>;
  onChangeRate: (rate: number) => void;
  playbackRate: number;
  onChange: (fn: (meeting: Meeting) => Meeting) => Promise<void>;
  onMerge: (speakerId: string) => void;
  onMergeGroups: (groups: string[][]) => Promise<void>;
  onSelectMerge: (speakerIds: string[]) => void;
  onAdd: () => void;
  t: Translate;
  onPlaybackRangeChange?: (range: { start: number; end: number } | null) => void;
  referenceVideo?: ReactNode;
}) {
  const { avatars, unavailable: avatarsUnavailable } = useSpeakerAvatars(meeting.id);
  const [avatarError, setAvatarError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
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
  const [selectedId, setSelectedId] = useState(meeting.speakers.find((speaker) => !speaker.confirmed)?.id ?? meeting.speakers[0]?.id ?? "");
  const [filter, setFilter] = useState<"unconfirmed" | "confirmed" | "all">("unconfirmed");
  const [speakerSearch, setSpeakerSearch] = useState("");
  const [sort, setSort] = useState<"duration" | "fragments">("duration");
  const [compareId, setCompareId] = useState("");
  const [sampleFocus, setSampleFocus] = useState<{ speakerId: string; start: number } | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);
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
    } else if (speakerId) {
      setFilter("all");
      setSelectedId(speakerId);
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
  }, [mode, selectedId]);

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

  const speakerStats = useMemo(() => {
    const stats = new Map(meeting.speakers.map((speaker) => [speaker.id, { count: 0, timed: 0 }]));
    for (const segment of meeting.segments) {
      for (const id of segment.speakerIds) {
        const item = stats.get(id);
        if (!item) continue;
        item.count += 1;
        if (segment.start !== null && segment.end !== null) item.timed += Math.max(0, segment.end - segment.start);
      }
    }
    return stats;
  }, [meeting.segments, meeting.speakers]);
  const filteredSpeakers = meeting.speakers.filter((speaker) =>
    (filter === "all" || (filter === "confirmed" ? speaker.confirmed : !speaker.confirmed)) &&
    `${speaker.name} ${speaker.id}`.toLocaleLowerCase().includes(speakerSearch.trim().toLocaleLowerCase()),
  ).sort((a, b) => {
    const first = speakerStats.get(a.id);
    const second = speakerStats.get(b.id);
    return sort === "duration" ? (second?.timed ?? 0) - (first?.timed ?? 0) : (second?.count ?? 0) - (first?.count ?? 0);
  });
  const selectedSpeaker = meeting.speakers.find((speaker) => speaker.id === selectedId) ?? meeting.speakers.find((speaker) => !speaker.confirmed) ?? filteredSpeakers[0] ?? meeting.speakers[0];
  const compareSpeaker = meeting.speakers.find((speaker) => speaker.id === compareId && speaker.id !== selectedSpeaker?.id);
  useEffect(() => {
    const list = queueRef.current;
    const selected = list?.querySelector<HTMLElement>(".speaker-queue-item.is-selected");
    if (!list || !selected) return;
    const top = selected.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + selected.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + selected.offsetHeight - list.clientHeight;
  }, [selectedSpeaker?.id, filter, sort, mode]);
  const windowsBySpeaker = useMemo(() => {
    const windows = new Map<string, SpeakerWindow[]>();
    for (const speaker of [selectedSpeaker, compareSpeaker]) {
      if (speaker) windows.set(speaker.id, buildSpeakerWindows(meeting.segments, speaker.id, windowSeconds, duration || meeting.audio?.duration));
    }
    return windows;
  }, [meeting.segments, selectedSpeaker, compareSpeaker, windowSeconds, duration, meeting.audio?.duration]);

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
      if (action === "confirm") {
        const next = meeting.speakers.find((item) => item.id !== speakerId && !item.confirmed);
        if (next) { setFilter("unconfirmed"); setSpeakerSearch(""); setSelectedId(next.id); }
      }
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
        data-unsaved-edit={hasUnsavedDraft || avatarBusy ? "true" : undefined}
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
          {audioAvailable && <ImmersivePlayback meeting={meeting} clock={clock} position={position} duration={duration}
            rate={playbackRate} playing={playing} status={playbackStatus} onSeek={onSeek}
            onTogglePlayback={onTogglePlayback} onChangeRate={onChangeRate} onEditSpeakers={() => { requestMode("naming"); }} t={translate} />}
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
      {avatarsUnavailable && <p className="notice sand" role="status">{t("Profile images are unavailable on this device.", "\u6b64\u8bbe\u5907\u65e0\u6cd5\u8bfb\u53d6\u5934\u50cf\u3002")}</p>}
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
          avatars={avatars}
          clock={clock}
          playing={activelyPlaying}
          playbackStatus={playbackStatus}
          audioAvailable={audioAvailable}
          duration={duration}
          locked={locked}
          onSeek={onSeek}
          onSelectSpeaker={openSpeakerEditor}
          onPlaybackRangeChange={onPlaybackRangeChange}
          t={t}
          referenceVideo={referenceVideo}
        />
      ) : <>
      <div className="speaker-review-progress">
        <strong>{t("Speaker review", "说话人审核")}</strong>
        <progress max={Math.max(1, meeting.speakers.length)} value={meeting.speakers.filter((speaker) => speaker.confirmed).length} aria-label={t("Confirmed speaker names", "已确认的说话人姓名")} />
      </div>
      <div className="speaker-review-workspace">
        <section className="speaker-review-queue" aria-label={t("Speaker review queue", "说话人审核队列")}>
          <h3>{t("Speaker review queue", "说话人审核队列")}</h3>
          <p className="small muted">{t(`${meeting.speakers.filter((speaker) => !speaker.confirmed).length} unconfirmed`, `${meeting.speakers.filter((speaker) => !speaker.confirmed).length} 位未确认`)}</p>
          <input aria-label={t("Search speakers", "搜索说话人")} placeholder={t("Search name or ID", "搜索姓名或 ID")} value={speakerSearch} onChange={(event) => setSpeakerSearch(event.target.value)} />
          <div className="speaker-review-filters" role="group" aria-label={t("Filter speakers", "筛选说话人")}>
            {(["unconfirmed", "confirmed", "all"] as const).map((item) => <button key={item} className={`button compact ${filter === item ? "primary" : "secondary"}`} aria-pressed={filter === item} onClick={() => { setFilter(item); const next = meeting.speakers.find((speaker) => item === "all" || (item === "confirmed" ? speaker.confirmed : !speaker.confirmed)); if (next) setSelectedId(next.id); }}>{item === "unconfirmed" ? t("Unconfirmed", "未确认") : item === "confirmed" ? t("Confirmed", "已确认") : t("All", "全部")}</button>)}
          </div>
          <label className="small">{t("Sort by", "排序")}
            <select aria-label={t("Sort speakers", "说话人排序")} value={sort} onChange={(event) => setSort(event.target.value as "duration" | "fragments")}><option value="duration">{t("Timed duration", "有时间记录的时长")}</option><option value="fragments">{t("Fragment count", "片段数量")}</option></select>
          </label>
          <div className="speaker-queue-list" ref={queueRef}>
            {filteredSpeakers.map((speaker) => <div className={`speaker-queue-item${selectedSpeaker?.id === speaker.id ? " is-selected" : ""}`} key={speaker.id}>
              <label className="speaker-queue-check"><input type="checkbox" aria-label={t(`Select ${speaker.name}`, `\u9009\u62e9${speaker.name}`)} checked={visibleSelected.includes(speaker.id)} disabled={locked} onChange={(event) => setSelectedSpeakers((current) => event.target.checked ? [...current, speaker.id] : current.filter((id) => id !== speaker.id))} /></label>
              <SpeakerAvatar id={speaker.id} image={avatars[speaker.id]} />
              <button className="speaker-queue-select" aria-pressed={selectedSpeaker?.id === speaker.id} onClick={() => setSelectedId(speaker.id)}>
                <strong>{speaker.name}</strong><span className="small muted">ID: {speaker.id}</span><span className="small muted">{formatTime(speakerStats.get(speaker.id)?.timed ?? 0)} · {speakerStats.get(speaker.id)?.count ?? 0} {t("fragments", "片段")}</span>
              </button>
            </div>)}
            {!filteredSpeakers.length && <p className="small muted">{t("No speakers match this filter.", "没有符合筛选条件的说话人。")}</p>}
          </div>
          {visibleSelected.length >= 2 && <button className="button primary compact" disabled={locked} onClick={() => onSelectMerge(visibleSelected)}>{t(`Merge selected (${visibleSelected.length})`, `\u5408\u5e76\u6240\u9009 (${visibleSelected.length})`)}</button>}
        </section>
        {selectedSpeaker && (() => {
          const speaker = selectedSpeaker;
          const index = meeting.speakers.findIndex((item) => item.id === speaker.id);
          const draft = drafts[speaker.id] ?? speaker.name;
          const stats = speakerStats.get(speaker.id);
          const sampleList = (item: typeof speaker) => (windowsBySpeaker.get(item.id) ?? []).map((window, sampleIndex) => <article className="speaker-sample" key={`${item.id}:${window.start}`}>
            <button className="button secondary compact" disabled={!audioAvailable || locked} onClick={() => { setSampleFocus({ speakerId: item.id, start: window.start }); onCue(window.start, window.end); }}><Play size={12} /> {t("Sample", "\u6837\u672c")} {sampleIndex + 1}</button>
            <span className="speaker-sample-range">{formatTime(window.start)} - {formatTime(window.end)}</span>
          </article>);
          const selectedWindows = windowsBySpeaker.get(speaker.id) ?? [];
          const comparedWindows = compareSpeaker ? windowsBySpeaker.get(compareSpeaker.id) ?? [] : [];
          const focusedWindow = sampleFocus?.speakerId === speaker.id
            ? selectedWindows.find((window) => window.start === sampleFocus?.start)
            : sampleFocus?.speakerId === compareSpeaker?.id
              ? comparedWindows.find((window) => window.start === sampleFocus?.start)
              : undefined;
          const transcriptWindow = focusedWindow ?? selectedWindows[0];
          const groups: { key: string; segments: SpeakerWindow["segments"] }[] = [];
          for (const segment of transcriptWindow?.segments ?? []) {
            const key = segment.speakerIds.join("|");
            const previous = groups.at(-1);
            if (previous?.key === key) previous.segments.push(segment);
            else groups.push({ key, segments: [segment] });
          }

          return <>
            <section className="speaker-voice-review" aria-label={t("Voice review", "声音审核")}>
              <h3>{t("Voice review", "声音审核")} · {speaker.name}</h3>
              <p className="small muted">{t("Listen to samples and compare voices manually. Range includes surrounding context; it may contain other voices.", "试听样本并人工比较声音。样本包含前后语境，可能有其他说话人。")}</p>
              <div className="speaker-samples">{sampleList(speaker)}{!windowsBySpeaker.get(speaker.id)?.length && <p className="small muted">{t("No timed sample available.", "没有可播放的有时间样本。")}</p>}</div>
              <label>{t("Compare with", "比较对象")}<select aria-label={t("Compare with speaker", "比较的说话人")} value={compareSpeaker?.id ?? ""} onChange={(event) => setCompareId(event.target.value)}><option value="">{t("Choose another speaker", "选择另一位说话人")}</option>{meeting.speakers.filter((item) => item.id !== speaker.id).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>
              {compareSpeaker && <div className="speaker-comparison"><h4>{compareSpeaker.name} · {compareSpeaker.id}</h4>{sampleList(compareSpeaker)}{!windowsBySpeaker.get(compareSpeaker.id)?.length && <p>{t("No timed sample available.", "没有可播放的有时间样本。")}</p>}</div>}
              {transcriptWindow && <section className="speaker-sample-transcript" tabIndex={0} aria-label={t("Related transcript", "\u76f8\u5173\u8f6c\u5f55")}>
                <h4>{t("Related transcript", "\u76f8\u5173\u8f6c\u5f55")} - {formatTime(transcriptWindow.start)} - {formatTime(transcriptWindow.end)}</h4>
                {groups.map((group, groupIndex) => <p key={`${group.key}:${groupIndex}`}><span className="speaker-sample-meta">{group.segments[0].start !== null ? formatTime(group.segments[0].start) : "-"} - {group.segments[0].speakerIds.map((id) => meeting.speakers.find((candidate) => candidate.id === id)?.name ?? id).join(" + ") || t("Unknown speaker", "\u672a\u77e5\u8bf4\u8bdd\u4eba")}</span><br />{group.segments.map((segment, index) => <span key={segment.id} className={segment.start !== null && segment.end !== null && position >= segment.start && position < segment.end ? "is-current" : undefined}>{index > 0 && !/^[\u3000-\u9fff]/.test(segment.text) ? " " : ""}{segment.text}</span>)}</p>)}
              </section>}
            </section>
            <section className="speaker-identity speaker-review-card" aria-label={t("Speaker identity", "说话人身份")}>
              <h3>{t("Speaker identity", "说话人身份")}</h3><strong>{speaker.name}</strong><p className="small muted">ID: {speaker.id} · {speaker.confirmed ? t("Confirmed", "已确认") : t("Unconfirmed", "未确认")}</p>
              <div className="speaker-profile-image"><SpeakerAvatar id={speaker.id} image={avatars[speaker.id]} className="speaker-avatar large" />
                <label className="button secondary compact">{t("Change avatar", "\u66f4\u6362\u5934\u50cf")}<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label={t("Upload speaker avatar", "\u4e0a\u4f20\u8bf4\u8bdd\u4eba\u5934\u50cf")} disabled={locked || avatarBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { setAvatarBusy(true); void trackAvatarWrite(prepareAvatar(file).then((image) => setSpeakerAvatar(meeting.id, speaker.id, image))).then(() => { setAvatarError(""); showToast(t("Speaker avatar saved locally.", "\u8bf4\u8bdd\u4eba\u5934\u50cf\u5df2\u4fdd\u5b58\u5230\u672c\u5730\u3002")); }).catch(() => setAvatarError(t("Could not save the avatar. Choose a JPEG, PNG, or WebP image under 5 MB.", "\u65e0\u6cd5\u4fdd\u5b58\u5934\u50cf\uff0c\u8bf7\u9009\u62e9 5 MB \u4ee5\u4e0b\u7684 JPEG\u3001PNG \u6216 WebP \u56fe\u7247\u3002"))).finally(() => setAvatarBusy(false)); } }} /></label>
                {avatars[speaker.id] && <button type="button" className="text-button" disabled={locked || avatarBusy} onClick={() => { setAvatarBusy(true); void trackAvatarWrite(setSpeakerAvatar(meeting.id, speaker.id, null)).then(() => setAvatarError("")).catch(() => setAvatarError(t("Could not remove the avatar.", "\u65e0\u6cd5\u5220\u9664\u5934\u50cf\u3002"))).finally(() => setAvatarBusy(false)); }}>{t("Use default", "\u4f7f\u7528\u9ed8\u8ba4\u5934\u50cf")}</button>}
              </div>{avatarError && <p className="notice danger" role="alert">{avatarError}</p>}

              <label>{t("Display name", "显示名称")}<input aria-label={t(`Name for speaker ${index + 1}`, `\u7b2c ${index + 1} \u4f4d\u8bf4\u8bdd\u4eba\u7684\u59d3\u540d`)} data-speaker-input-id={speaker.id} value={draft} maxLength={80} disabled={locked} data-unsaved-edit={draft !== speaker.name ? "true" : "false"} onChange={(event) => setDrafts((current) => ({ ...current, [speaker.id]: event.target.value }))} /></label>
              {saveErrors[speaker.id] && <p className="notice danger" role="alert">{saveErrors[speaker.id]}</p>}
              <p className="small muted">{stats?.count ?? 0} {t("transcript fragments", "段转录片段")} · {formatTime(stats?.timed ?? 0)} {t("timed intervals", "有时间记录的片段时长")}</p>
              <p className="small muted">{t("Overlapping intervals may be counted more than once.", "重叠片段可能重复计入时长。")}</p>
              <div className="speaker-card-actions"><button className="button secondary compact" disabled={locked || !draft.trim() || draft === speaker.name} data-unsaved-edit={draft !== speaker.name ? "true" : "false"} onClick={() => void saveSpeaker(speaker.id, "save")}>{t("Save name", "保存姓名")}</button>
                <button className="button primary compact" disabled={locked || !draft.trim()} onClick={() => void saveSpeaker(speaker.id, speaker.confirmed ? "toggle" : "confirm")}><Check size={15} />{speaker.confirmed ? t("Leave unconfirmed", "取消姓名确认") : t("Confirm name", "确认姓名")}</button>
                <button className="text-button" onClick={() => onMerge(speaker.id)} disabled={locked || meeting.speakers.length < 2}>{t("Merge\u2026", "\u5408\u5e76\u2026")}</button></div>
            </section>
          </>;
        })()}
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

/** Whole-second time label; re-renders once a second instead of with every playhead sample. */
function ClockTime({ clock }: { clock: PlaybackClockStore }) {
  const seconds = useSyncExternalStore(
    clock.subscribe,
    () => Math.floor(clock.getPosition()),
    () => 0,
  );
  return <span>{formatTime(seconds)}</span>;
}

function PlaybackMode({
  meeting,
  avatars,
  clock,
  playing,
  playbackStatus,
  audioAvailable,
  duration,
  locked,
  onSeek,
  onSelectSpeaker,
  onPlaybackRangeChange,
  t,
  referenceVideo,
}: {
  meeting: Meeting;
  avatars: Record<string, string>;
  clock: PlaybackClockStore;
  playing: boolean;
  playbackStatus: PlaybackStatus;
  audioAvailable: boolean;
  duration: number;
  locked: boolean;
  onSeek: (position: number) => void;
  onSelectSpeaker: (speakerId: string) => void;
  onPlaybackRangeChange?: (range: { start: number; end: number } | null) => void;
  t: Translate;
  referenceVideo?: ReactNode;
}) {
  const captions = useMemo(
    () => buildPlaybackCaptions(meeting.segments),
    [meeting.segments],
  );
  // Everything below depends on the playhead only through these boundaries, so subscribe to a
  // representative time of the current boundary interval instead of the raw frame-rate position.
  const boundaries = useMemo(
    () => playbackBoundaries(meeting.segments, captions),
    [meeting.segments, captions],
  );
  const position = useSyncExternalStore(
    clock.subscribe,
    () => snapToPlaybackInterval(boundaries, clock.getPosition()),
    () => snapToPlaybackInterval(boundaries, 0),
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
  // Consecutive captions from the same speaker share one header instead of repeating it on every row.
  const turns = useMemo(() => {
    const result: Array<{ speakerIds: string[]; captions: typeof visible }> = [];
    for (const caption of visible) {
      const last = result[result.length - 1];
      if (last && last.speakerIds.join("|") === caption.speakerIds.join("|")) last.captions.push(caption);
      else result.push({ speakerIds: caption.speakerIds, captions: [caption] });
    }
    return result;
  }, [captions, start]);
  const activeIds = new Set(
    (playing ? activity.activeSpeakerIds : []).filter(Boolean),
  );
  // Identity follows the visible caption, not instantaneous word activity.
  // The context contains only bounded gaps inside the same caption; it never
  // carries the last speaker into an unrelated silence or unknown passage.
  const displayedCaptions = current.length ? current : context;
  const currentIds = new Set(displayedCaptions.flatMap((caption) => caption.speakerIds));
  const showGap = displayedCaptions.length === 0;
  const captionSpeakerName = (id: string) => meeting.speakers.find((speaker) => speaker.id === id)?.name ?? t("Unknown speaker", "未知说话人");
  const [untimedStart, setUntimedStart] = useState(0);
  const untimed = useMemo(() => meeting.segments.filter((segment) =>
    !hasValidTimedSegments([segment])), [meeting.segments]);
  const nextCaption = useMemo(
    () => captions.find((caption) => caption.start > position + NEXT_CAPTION_LOOKAHEAD) ?? null,
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
              <ClockTime clock={clock} />
            </span>
          </div>
          <div className="playback-current-speakers" role="region" aria-label={t("Attribution at playback position", "播放位置的说话人归属")} tabIndex={displayedCaptions.length ? 0 : -1}>
            {[...currentIds].map((id) => {
              const speaker = meeting.speakers.find((candidate) => candidate.id === id);
              return <span className="playback-current-speaker" key={id} data-speaker-hero="true" data-speaker-active={activeIds.has(id) ? "true" : "false"}>
                <SpeakerAvatar id={id} image={avatars[id]} />
                <strong title={speaker?.name}>{captionSpeakerName(id)}</strong>
                <span className="playback-identity-state">{speaker ? speaker.confirmed ? t("Name confirmed", "姓名已确认") : t("Name unconfirmed", "姓名待确认") : ""}</span>
                <span className="playback-speaking-state" style={{ visibility: activeIds.has(id) ? "visible" : "hidden" }} aria-hidden={!activeIds.has(id)}>{t("Speaking", "正在说话")}</span>
              </span>;
            })}
            {displayedCaptions.some((caption) => caption.speakerIds.length === 0) && <span className="playback-current-speaker"><span className="speaker-avatar" aria-hidden="true">?</span><strong>{t("Unknown speaker", "未知说话人")}</strong></span>}
          </div>
          <div className="playback-current-content" role="region" aria-label={t("Current captions", "当前字幕")} tabIndex={0}>
            {context.length > 0 && <span className="playback-context-only">{t("Caption context during a word pause", "词间停顿的字幕上下文")}</span>}
            {displayedCaptions.map((caption) => (
              <div className="playback-current-caption" key={caption.id}>
                {(displayedCaptions.length > 1 || caption.speakerIds.length > 1) && <span className="playback-current-caption-name">{caption.speakerIds.length ? caption.speakerIds.map(captionSpeakerName).join(" + ") : t("Unknown speaker", "未知说话人")}</span>}
                <p>{caption.fragments.map((fragment, index) => <span key={fragment.id} data-fragment-active={fragmentsAtTime([fragment], position).length ? "true" : "false"}>{index > 0 ? transcriptTextSeparator(caption.fragments[index - 1].text, fragment.text) : ""}{fragment.text}</span>)}</p>
              </div>
            ))}
          </div>
          <div className="playback-gap small muted" style={{ visibility: showGap ? "visible" : "hidden" }} aria-hidden={!showGap}>
            <span>{t("No timed caption at this position.", "此处没有带时间的字幕。")}</span>
            {audioAvailable && jumpTarget && (
              <button type="button" className="text-button" tabIndex={showGap ? undefined : -1} onClick={() => onSeek(jumpTarget.start)}>
                {nextCaption ? t("Next speech", "下一段发言") : t("First speech", "首段发言")} · {formatTime(jumpTarget.start)}
              </button>
            )}
          </div>
          <div className="playback-stage-footer" aria-hidden="true" />
        </section>
      </div>
      <section className="playback-transcript-panel" aria-label={t("Playback transcript", "播放转录")}>
        <div className="playback-transcript-head">
          <div>
            <h3 className="chat-divider">{t("Meeting transcript", "会议转录")}</h3>
            <p className="small muted">
              {captions.length} {t("timed caption groups", "个有时间字幕组")} · {t("source timing preserved", "保留源时间")}
            </p>
          </div>
          <div className="live-caption-head">
            <label className="small muted">
              {t("Caption size", "字幕大小")}
              <select aria-label={t("Caption size", "字幕大小")} value={captionSize} onChange={(event) => setCaptionSize(event.target.value as "normal" | "large" | "xlarge")}>
                <option value="normal">{t("Normal", "标准")}</option>
                <option value="large">{t("Large", "大")}</option>
                <option value="xlarge">{t("Extra large", "特大")}</option>
              </select>
            </label>
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
          {turns.map((turn) => (
            <div key={turn.captions[0].id} role="listitem" className="playback-caption-list-item playback-turn">
              <span className="chat-avatars" aria-hidden="true">
                {turn.speakerIds.length ? turn.speakerIds.map((id) => {
                  return <SpeakerAvatar key={id} id={id} image={avatars[id]} />;
                }) : <span className="speaker-avatar">?</span>}
              </span>
              <div className="playback-turn-body">
                <div className="playback-turn-head">
                  <strong className="chat-speaker-name">
                    {turn.speakerIds.length
                      ? turn.speakerIds
                          .map(
                            (id) =>
                              meeting.speakers.find((speaker) => speaker.id === id)?.name ??
                              t("Unknown speaker", "未知说话人"),
                          )
                          .join(" + ")
                      : t("Unknown speaker", "未知说话人")}
                  </strong>
                  <span className="playback-caption-time">{formatTime(turn.captions[0].start)}</span>
                </div>
                {turn.captions.map((caption) => {
                  const active = current.includes(caption);
                  return (
                    <button
                      key={caption.id}
                      type="button"
                      data-caption-id={caption.id}
                      className={`playback-caption-row${active ? " is-active" : ""}`}
                      aria-current={active ? "true" : undefined}
                      onClick={() => onSeek(caption.start)}
                      disabled={!audioAvailable}
                    >
                      <span className="playback-caption-time">{formatTime(caption.start)}</span>
                      <span className={`chat-text caption-${captionSize}`}>
                        {caption.fragments.map((fragment, index) => (
                          <span key={fragment.id} data-fragment-id={fragment.id}
                            data-fragment-active={fragmentsAtTime([fragment], position).length ? "true" : "false"}>
                            {index > 0 ? transcriptTextSeparator(caption.fragments[index - 1].text, fragment.text) : ""}{fragment.text}
                          </span>
                        ))}
                      </span>
                      {active && playing && <span className="chat-wave" aria-hidden="true">·|·|·</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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
                      data-tooltip={t("Edit speaker name and listen to samples", "编辑此说话人姓名并试听样本")}
                      onClick={() => onSelectSpeaker(speaker.id)}
                      className={`playback-speaker${isActive ? " is-active" : ""}${atPosition && !isActive ? " is-at-position" : ""}`}
                      data-roster-active={isActive ? "true" : "false"}
                      data-roster-at-position={atPosition ? "true" : "false"}
                    >
                      <SpeakerAvatar id={speaker.id} image={avatars[speaker.id]} className="speaker-avatar large" />
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

      {duration <= 0 && (
        <p className="notice sand">{t("Recording duration is unavailable; playback timing may be limited.", "录音时长不可用，播放时间可能受限。")}</p>
      )}
    </div>
  );
}
