import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import type { Meeting } from "../domain/model";
import { formatTime, speakerName } from "../domain/operations";
import { buildPlaybackCaptions, captionsAtTime, captionContextAtTime, fragmentsAtTime, playbackBoundaries, playbackCaptionWindowStart, snapToPlaybackInterval } from "../domain/playback";
import { speakerBackground } from "../components/speaker-appearance";
import type { PlaybackClockStore, PlaybackStatus } from "./usePlaybackClock";

type Props = {
  meeting: Meeting; clock: PlaybackClockStore; position: number; duration: number; rate: number;
  playing: boolean; status: PlaybackStatus; onSeek: (position: number) => void;
  onTogglePlayback: () => Promise<void>; onChangeRate: (rate: number) => void;
  t: (english: string, chinese: string) => string;
};

function joinedText(parts: string[]) {
  return parts.reduce((left, right) => {
    if (!left || !right) return left + right;
    const joined = /[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]$/u.test(left) ||
      /^[\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af.,!?;:，。！？；：、）)\]}]/u.test(right) || /[(\x5b{（]$/u.test(left);
    return left + (joined ? "" : " ") + right;
  }, "");
}

export function ImmersivePlayback({ meeting, clock, position, duration, rate, playing, status, onSeek, onTogglePlayback, onChangeRate, t }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const captionBox = useRef<HTMLDivElement>(null);
  const captionKey = useRef("");
  const transcriptToggle = useRef<HTMLButtonElement>(null);
  const native = useRef(false);
  const exitingFullscreen = useRef<Promise<void> | null>(null);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [panel, setPanel] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [controlError, setControlError] = useState(false);
  const [size, setSize] = useState("normal");
  const [follow, setFollow] = useState(true);
  const [page, setPage] = useState(0);
  const [followStart, setFollowStart] = useState(0);
  const [untimedPage, setUntimedPage] = useState(0);
  const captions = useMemo(() => buildPlaybackCaptions(meeting.segments), [meeting.segments]);
  const boundaries = useMemo(() => playbackBoundaries(meeting.segments, captions), [meeting.segments, captions]);
  const subscribe = useCallback((listener: () => void) => open ? clock.subscribe(listener) : () => {}, [clock, open]);
  const exact = useSyncExternalStore(subscribe, () => open ? snapToPlaybackInterval(boundaries, clock.getPosition()) : 0, () => 0);
  const current = useMemo(() => captionsAtTime(captions, exact), [captions, exact]);
  const context = useMemo(() => captionContextAtTime(captions, exact), [captions, exact]);
  const untimed = useMemo(() => meeting.segments.filter((segment) => segment.start === null || segment.end === null), [meeting.segments]);
  const activeIds = new Set(current.flatMap((caption) => caption.speakerIds));
  const activeUnknown = current.some((caption) => caption.speakerIds.length === 0);
  const automatic = playbackCaptionWindowStart(captions, exact, 40);
  const boundedStart = Math.min(followStart, Math.max(0, captions.length - 40));
  const stableStart = Math.abs(automatic - boundedStart) > 12 ? automatic : boundedStart;
  if (follow && stableStart !== followStart) setFollowStart(stableStart);
  const start = follow ? stableStart : Math.min(page, Math.max(0, captions.length - 40));
  const visible = captions.slice(start, start + 40);
  const active = current[0]?.id;

  function close() {
    openRef.current = false;
    native.current = false;
    if (document.fullscreenElement === host.current) exitingFullscreen.current = document.exitFullscreen().catch(() => undefined);
    setOpen(false);
  }
  function enter() {
    const element = host.current;
    if (!element) return;
    openRef.current = true;
    element.hidden = false;
    setOpen(true);
    setFallback(false);
    setControlError(false);
    if (!element.requestFullscreen) { setFallback(true); return; }
    try {
      void element.requestFullscreen().then(() => {
        if (!openRef.current && document.fullscreenElement === element) void document.exitFullscreen().catch(() => undefined);
        else if (document.fullscreenElement === element) native.current = true;
        else if (openRef.current) setFallback(true);
      }).catch(() => { if (openRef.current) setFallback(true); });
    } catch { setFallback(true); }
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    exitButton.current?.focus();
    const changed = () => {
      if (document.fullscreenElement === host.current) native.current = true;
      else if (native.current && openRef.current) { native.current = false; openRef.current = false; setOpen(false); }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !host.current) return;
      const items = [...host.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter((item) => item.getClientRects().length > 0);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", key);
    return () => {
      openRef.current = false;
      native.current = false;
      const pendingExit = exitingFullscreen.current ?? (document.fullscreenElement === host.current ? document.exitFullscreen().catch(() => undefined) : null);
      exitingFullscreen.current = null;
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previousOverflow;
      void Promise.resolve(pendingExit).then(() => {
        if (openRef.current) return;
        window.scrollTo(scrollX, scrollY);
        opener.current?.focus({ preventScroll: true });
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open || !panel || !follow || !active) return;
    const list = transcript.current;
    const row = list?.querySelector<HTMLElement>(`[data-immersive-caption="${CSS.escape(active)}"]`);
    if (!list || !row) return;
    const listBox = list.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top || rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.top - listBox.top - listBox.height / 3;
  }, [open, panel, follow, active, start]);

  const textCaptions = current.length ? current : context;
  const contextOnly = context.length > 0 && current.length === 0 && (!playing || status !== "playing");
  const textKey = textCaptions.map((caption) => caption.id).join("|");

  // The captions have a fixed-height area (so nothing around them moves) and scroll inside it. Keep the line with the
  // word being spoken visible, and start a new caption from its top.
  useEffect(() => {
    const box = captionBox.current;
    if (!open || !box) return;
    if (captionKey.current !== textKey) { captionKey.current = textKey; box.scrollTop = 0; }
    const word = box.querySelector<HTMLElement>('[data-current="true"]');
    if (!word) return;
    const area = box.getBoundingClientRect(), line = word.getBoundingClientRect();
    if (line.bottom > area.bottom) box.scrollTop += line.bottom - area.bottom;
    else if (line.top < area.top) box.scrollTop -= area.top - line.top;
  }, [open, exact, textKey, showCaptions, size]);
  const state = status === "error" ? t("Playback error", "播放出错") : status === "buffering" ? t("Buffering", "缓冲中") : status === "ended" ? t("Playback ended", "播放已结束") : !playing ? t("Paused at this position", "已暂停在此位置") : current.length ? activeUnknown ? t("Unknown speaker", "未知说话人") : t("Speaking", "正在发言") : context.length ? t("Between words · context only", "词语间隙 · 仅显示上下文") : t("No attributed speech at this position", "此位置没有已归属的发言");
  const suspend = () => { setPage(start); setFollow(false); };
  return <>
    <button ref={opener} type="button" className="button secondary compact" onClick={enter}><Maximize2 size={15} /> {t("Immersive playback", "沉浸式播放")}</button>
    <div ref={host} hidden={!open} className="immersive" role="dialog" aria-modal="true" aria-label={t("Immersive playback", "沉浸式播放")}>
      {open && <>
        <header className="immersive-header"><strong>MeetingMemo</strong><span>{meeting.title}</span><button ref={exitButton} type="button" onClick={close}><Minimize2 size={17} /> {t("Exit immersive", "退出沉浸模式")}</button></header>
        {fallback && <p className="immersive-fallback" role="status">{t("Full screen is unavailable; using the in-page view.", "无法使用全屏，正在使用页面内视图。")}</p>}
        {controlError && <p className="immersive-fallback" role="alert">{t("Playback could not start.", "无法开始播放。")}</p>}
        <div className="immersive-content">
          <section className="immersive-stage" aria-label={t("Speaker and captions", "说话人和字幕")}>
            <div className="immersive-roster">
              {meeting.speakers.map((speaker, index) => <div className="immersive-person" key={speaker.id} data-active={playing && status === "playing" && activeIds.has(speaker.id)}>
                <span className="immersive-avatar" style={{ background: speakerBackground(index) }} aria-hidden="true">S{index + 1}</span><strong>{speaker.name}</strong>
                {/* Always present and visually hidden: a line that appears under the active speaker would change the roster height every time the speaker changes. The ring on the avatar and the status line below carry the visible state. */}
                <span className="immersive-person-status">{activeIds.has(speaker.id) ? (playing && status === "playing" ? t("Speaking", "正在发言") : t("At position", "当前播放位置")) : ""}</span>
              </div>)}
            </div>
            {/* Two fixed lines, so a status or context message appearing never moves what is below it. */}
            <div className="immersive-status">
              <p className="immersive-state">{state}</p>
              <p className="immersive-state">{contextOnly ? t("Between words · context only", "词语间隙 · 仅显示上下文") : " "}</p>
              {!captions.length && <p className="immersive-state">{t("Speaker timing is unavailable.", "说话人时间不可用。")}</p>}
            </div>
            {showCaptions && <div ref={captionBox} className={`immersive-captions size-${size}`}>{textCaptions.map((caption) => <p key={caption.id}>
              {(current.length > 1 || caption.speakerIds.length !== 1) && <span className="immersive-caption-speaker">{caption.speakerIds.length ? speakerName(meeting, caption.speakerIds) : t("Unknown speaker", "未知说话人")}: </span>}
              {caption.fragments.map((fragment, index) => <span key={fragment.id} data-current={fragmentsAtTime([fragment], exact).length > 0 ? "true" : undefined}>{index > 0 && joinedText([caption.fragments[index - 1].text, fragment.text]) !== caption.fragments[index - 1].text + fragment.text ? " " : ""}{fragment.text}</span>)}
            </p>)}</div>}
          </section>
          {panel && <aside className="immersive-transcript" aria-label={t("Transcript", "转录")}>
            <div className="immersive-panel-head"><h2>{t("Transcript", "转录")}</h2><button type="button" onClick={() => { setPanel(false); transcriptToggle.current?.focus(); }} aria-label={t("Close transcript", "关闭转录")}>×</button></div>
            {!follow && <button type="button" onClick={() => setFollow(true)}>{t("Follow playback", "跟随播放")}</button>}
            <div ref={transcript} className="immersive-transcript-list" onWheel={suspend} onTouchMove={suspend} onPointerDown={suspend} onKeyDown={suspend} tabIndex={0}>
              {visible.map((caption) => <button key={caption.id} type="button" data-immersive-caption={caption.id} className={current.includes(caption) ? "is-current" : ""} onClick={() => { suspend(); onSeek(caption.start); }}>
                <span>{formatTime(caption.start)} · {caption.speakerIds.length ? speakerName(meeting, caption.speakerIds) : t("Unknown speaker", "未知说话人")}</span>
                <span>{caption.fragments.map((fragment, index) => <span key={fragment.id} className={fragmentsAtTime([fragment], exact).length ? "is-current-fragment" : undefined}>{index > 0 && joinedText([caption.fragments[index - 1].text, fragment.text]) !== caption.fragments[index - 1].text + fragment.text ? " " : ""}{fragment.text}</span>)}</span>
              </button>)}
              {untimed.length > 0 && <div className="immersive-untimed"><strong>{t("Timing unavailable", "时间不可用")}</strong>{untimed.slice(untimedPage, untimedPage + 40).map((segment) => <p key={segment.id}>{segment.speakerIds.length ? speakerName(meeting, segment.speakerIds) : t("Unknown speaker", "未知说话人")}: {segment.text}</p>)}
                {untimed.length > 40 && <div><button type="button" disabled={untimedPage === 0} onClick={() => setUntimedPage(Math.max(0, untimedPage - 40))}>{t("Earlier untimed", "较早的无时间片段")}</button><button type="button" disabled={untimedPage + 40 >= untimed.length} onClick={() => setUntimedPage(untimedPage + 40)}>{t("Later untimed", "较晚的无时间片段")}</button></div>}
              </div>}
            </div>
            <div className="immersive-paging"><button type="button" disabled={start === 0} onClick={() => { setFollow(false); setPage(Math.max(0, start - 40)); }}>{t("Earlier", "更早")}</button><span>{captions.length ? start + 1 : 0}–{Math.min(start + 40, captions.length)} / {captions.length}</span><button type="button" disabled={start + 40 >= captions.length} onClick={() => { setFollow(false); setPage(start + 40); }}>{t("Later", "更晚")}</button></div>
          </aside>}
        </div>
        <footer className="immersive-controls">
          <button type="button" onClick={() => { void onTogglePlayback().then(() => setControlError(false)).catch(() => setControlError(true)); }} aria-label={playing ? t("Pause audio", "暂停录音") : t("Play audio", "播放录音")}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
          <button type="button" onClick={() => onSeek(Math.max(0, position - 15))} aria-label={t("Back 15 seconds", "后退15秒")}><RotateCcw size={18} /> 15</button>
          <button type="button" onClick={() => onSeek(Math.min(duration, position + 15))} aria-label={t("Forward 15 seconds", "前进15秒")}><RotateCw size={18} /> 15</button>
          <span>{formatTime(position)}</span><input type="range" aria-label={t("Playback position", "播放位置")} min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} onChange={(event) => onSeek(Number(event.target.value))} /><span>{formatTime(duration)}</span>
          <select aria-label={t("Playback speed", "播放速度")} value={String(rate)} onChange={(event) => onChangeRate(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}</select>
          <button type="button" aria-pressed={showCaptions} onClick={() => setShowCaptions(!showCaptions)}>{t("Captions", "字幕")}</button>
          <select aria-label={t("Caption size", "字幕大小")} value={size} onChange={(event) => setSize(event.target.value)}><option value="normal">{t("Normal", "标准")}</option><option value="large">{t("Large", "大")}</option><option value="xlarge">{t("Extra large", "特大")}</option></select>
          <button ref={transcriptToggle} type="button" aria-pressed={panel} onClick={() => setPanel(!panel)}>{t("Transcript", "转录")}</button>
        </footer>
      </>}
    </div>
  </>;
}
