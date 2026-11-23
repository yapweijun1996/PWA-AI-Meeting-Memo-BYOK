import { createPortal } from "react-dom";
import { Button } from "../components/controls";
import { Icon } from "../components/Icon";
import { SpeakerAvatar, useSpeakerAvatars } from "../components/SpeakerAvatar";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import type { Meeting } from "../domain/model";
import { formatTime, speakerName } from "../domain/operations";
import { buildPlaybackCaptions, captionsAtTime, captionContextAtTime, fragmentsAtTime, playbackBoundaries, playbackCaptionWindowStart, snapToPlaybackInterval } from "../domain/playback";
import type { PlaybackClockStore, PlaybackStatus } from "./usePlaybackClock";
import { detectedOverlap, recordingOverlap } from "../domain/overlap-evidence";
import { OverlapNotice } from "./OverlapNotice";

type Props = {
  meeting: Meeting; clock: PlaybackClockStore; position: number; duration: number; rate: number;
  playing: boolean; status: PlaybackStatus; onSeek: (position: number) => void;
  onTogglePlayback: () => Promise<void>; onChangeRate: (rate: number) => void;
  onEditSpeakers: () => void;
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

function tableSeat(index: number, count: number, topSeats: number) {
  const longTable = count >= 6;
  if (longTable && index >= count - 2) {
    return { row: 2, column: index === count - 2 ? 1 : topSeats + 2, span: 1 };
  }
  const onTop = index < topSeats;
  const row = onTop ? 1 : 3;
  const indexInRow = onTop ? index : index - topSeats;
  if (longTable) return { row, column: 2 + indexInRow, span: 1 };
  // Each seat spans two tracks, leaving one empty track on either side of an odd roster's shorter row.
  const offset = onTop ? 0 : count % 2;
  return { row, column: 1 + offset + 2 * indexInRow, span: 2 };
}

export function ImmersivePlayback({ meeting, clock, position, duration, rate, playing, status, onSeek, onTogglePlayback, onChangeRate, onEditSpeakers, t }: Props) {
  const { avatars } = useSpeakerAvatars(meeting.id);
  const host = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const controls = useRef<HTMLElement>(null);
  const rosterBar = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const captionBox = useRef<HTMLDivElement>(null);
  const captionKey = useRef("");
  const transcriptToggle = useRef<HTMLButtonElement>(null);
  const native = useRef(false);
  const exitingFullscreen = useRef<Promise<void> | null>(null);
  const openRef = useRef(false);
  const fullscreenIntent = useRef(0);
  const playbackIntent = useRef(0);
  const viewSession = useRef(0);
  const restorePage = useRef<(() => void) | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 600px)").matches);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showRoster, setShowRoster] = useState(false);
  const [relevantRoster, setRelevantRoster] = useState(false);
  const [speakerLayout, setSpeakerLayout] = useState<"single" | "table">("table");
  const [controlError, setControlError] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [size, setSize] = useState("normal");
  const [follow, setFollow] = useState(true);
  // Read-only diagnostic: which interaction last paused transcript follow.
  const [pauseReason, setPauseReason] = useState("");
  const [page, setPage] = useState(0);
  const [followStart, setFollowStart] = useState(0);
  const [untimedPage, setUntimedPage] = useState(0);
  const [panelWidth, setPanelWidth] = useState(32);
  const [search, setSearch] = useState("");
  const commands = useRef({ onSeek, onTogglePlayback, duration, clock });
  commands.current = { onSeek, onTogglePlayback, duration, clock };
  const captions = useMemo(() => buildPlaybackCaptions(meeting.segments), [meeting.segments]);
  const overlap = recordingOverlap(meeting.audio);
  const boundaries = useMemo(() => playbackBoundaries(meeting.segments, captions, overlap?.intervals), [meeting.segments, captions, overlap]);
  const subscribe = useCallback((listener: () => void) => open ? clock.subscribe(listener) : () => {}, [clock, open]);
  const exact = useSyncExternalStore(subscribe, () => open ? snapToPlaybackInterval(boundaries, clock.getPosition()) : 0, () => 0);
  const current = useMemo(() => captionsAtTime(captions, exact), [captions, exact]);
  const context = useMemo(() => captionContextAtTime(captions, exact), [captions, exact]);
  const lastCaptions = useMemo(() => {
    if (current.length || context.length) return [];
    let latestEnd = -Infinity;
    const latest: typeof captions = [];
    for (const caption of captions) {
      if (caption.end > exact || caption.end < latestEnd) continue;
      if (caption.end > latestEnd) { latestEnd = caption.end; latest.length = 0; }
      latest.push(caption);
    }
    return latest;
  }, [captions, context.length, current.length, exact]);
  const untimed = useMemo(() => meeting.segments.filter((segment) => segment.start === null || segment.end === null), [meeting.segments]);
  const searchTerm = search.trim().toLocaleLowerCase();
  const hasSearch = Boolean(searchTerm);
  const captionSearchIndex = useMemo(() => hasSearch ? captions.map((caption) =>
    `${caption.text} ${joinedText(caption.fragments.map((fragment) => fragment.text))} ${speakerName(meeting, caption.speakerIds)} ${caption.speakerIds.length ? "" : "未知说话人"}`.toLocaleLowerCase())
  : [], [captions, meeting, hasSearch]);
  const untimedSearchIndex = useMemo(() => hasSearch ? untimed.map((segment) =>
    `${segment.text} ${speakerName(meeting, segment.speakerIds)} ${segment.speakerIds.length ? "" : "未知说话人"}`.toLocaleLowerCase())
  : [], [untimed, meeting, hasSearch]);
  const matchingCaptions = useMemo(() => searchTerm ? captions.filter((_, index) => captionSearchIndex[index].includes(searchTerm)) : captions,
  [captions, captionSearchIndex, searchTerm]);
  const matchingUntimed = useMemo(() => searchTerm ? untimed.filter((_, index) => untimedSearchIndex[index].includes(searchTerm)) : untimed,
  [untimed, untimedSearchIndex, searchTerm]);
  const activeIds = new Set(current.flatMap((caption) => caption.speakerIds));
  const activeUnknown = current.some((caption) => caption.speakerIds.length === 0);
  const retainedCaptions = context.length ? context : lastCaptions;
  const contextIds = new Set(retainedCaptions.flatMap((caption) => caption.speakerIds));
  const contextUnknown = retainedCaptions.some((caption) => caption.speakerIds.length === 0);
  const displayedIds = current.length ? activeIds : contextIds;
  const currentSpeakers = meeting.speakers.filter((speaker) => displayedIds.has(speaker.id));
  const rosterSpeakers = relevantRoster ? currentSpeakers : meeting.speakers;
  const showUnknownLabel = activeUnknown || (!current.length && contextUnknown);
  const speakerCount = meeting.speakers.length;
  const tableAvailable = speakerCount >= 2 && speakerCount <= 10;
  const longTable = speakerCount >= 6;
  const showTable = speakerLayout === "table" && tableAvailable;
  const topSeats = Math.ceil((longTable ? speakerCount - 2 : speakerCount) / 2);
  const seatColumns = longTable ? topSeats + 2 : topSeats * 2;
  const glowSeat = showTable && playing && status === "playing" && !activeUnknown && activeIds.size === 1
    ? meeting.speakers.findIndex((speaker) => activeIds.has(speaker.id)) : -1;
  const tableStyle = { "--seat-columns": seatColumns } as CSSProperties;
  if (glowSeat >= 0) {
    const { row, column, span } = tableSeat(glowSeat, speakerCount, topSeats);
    const edgeColumns = longTable ? 1 : 0;
    const surfaceColumns = seatColumns - 2 * edgeColumns;
    const center = column - 1 - edgeColumns + span / 2;
    Object.assign(tableStyle, {
      "--table-glow-x": `${Math.max(0, Math.min(1, center / surfaceColumns)) * 100}%`,
      "--table-glow-y": `${(row - 1) * 50}%`,
    });
  }
  const automatic = playbackCaptionWindowStart(captions, exact, 40);
  const boundedStart = Math.min(followStart, Math.max(0, captions.length - 40));
  const stableStart = Math.abs(automatic - boundedStart) > 12 ? automatic : boundedStart;
  if (follow && stableStart !== followStart) setFollowStart(stableStart);
  const start = follow && !searchTerm ? stableStart : Math.min(page, Math.max(0, matchingCaptions.length - 40));
  const visible = matchingCaptions.slice(start, start + 40);
  const active = current[0]?.id ?? retainedCaptions.find((caption) => visible.includes(caption))?.id ?? visible[0]?.id;

  function exitClosedFullscreen(element: HTMLElement) {
    if (exitingFullscreen.current) return exitingFullscreen.current;
    const session = viewSession.current;
    const restore = restorePage.current;
    const pending = (async () => {
      try {
        await document.exitFullscreen();
        restore?.();
      } catch {
        if (session !== viewSession.current || openRef.current || host.current !== element || document.fullscreenElement !== element) return;
        // A failed native exit must retain a visible player and recovery controls.
        openRef.current = true;
        native.current = true;
        setOpen(true);
        setFullscreenActive(true);
        setFallback(false);
        setFullscreenError(true);
      }
    })();
    exitingFullscreen.current = pending;
    void pending.then(() => {if (exitingFullscreen.current === pending) exitingFullscreen.current = null;});
    return pending;
  }

  function close() {
    fullscreenIntent.current += 1;
    playbackIntent.current += 1;
    openRef.current = false;
    native.current = false;
    setFullscreenActive(false);
    if (host.current && document.fullscreenElement === host.current) void exitClosedFullscreen(host.current);
    setOpen(false);
  }
  function enter() {
    const element = host.current;
    if (!element) return;
    const intent = ++fullscreenIntent.current;
    playbackIntent.current += 1;
    viewSession.current += 1;
    openRef.current = true;
    element.hidden = false;
    setOpen(true);
    setFallback(false);
    setControlError(false);
    setFullscreenError(false);
    if (!element.requestFullscreen) { setFallback(true); return; }
    try {
      void element.requestFullscreen().then(() => {
        if (intent !== fullscreenIntent.current) {
          if (!openRef.current && document.fullscreenElement === element) void exitClosedFullscreen(element);
          return;
        }
        if (!openRef.current && document.fullscreenElement === element) void exitClosedFullscreen(element);
        else if (document.fullscreenElement === element) { native.current = true; setFullscreenActive(true); }
        else if (openRef.current) setFallback(true);
      }).catch(() => { if (intent === fullscreenIntent.current && openRef.current) setFallback(true); });
    } catch { if (intent === fullscreenIntent.current && openRef.current) setFallback(true); }
  }

  function toggleFullscreen() {
    const element = host.current;
    if (!element) return;
    const intent = ++fullscreenIntent.current;
    setFullscreenError(false);
    const current = () => intent === fullscreenIntent.current && openRef.current;
    const failed = () => {
      if (!current()) return;
      const active = document.fullscreenElement === element;
      native.current = active;
      setFullscreenActive(active);
      setFallback(!active);
      setFullscreenError(true);
    };
    if (document.fullscreenElement === element) {
      native.current = false;
      try { void document.exitFullscreen().then(() => { if (current()) {setFullscreenActive(false); setFallback(false);} }).catch(failed); }
      catch { failed(); }
    } else if (element.requestFullscreen) {
      try { void element.requestFullscreen().then(() => {
        if (!current()) {
          if (!openRef.current && document.fullscreenElement === element) void exitClosedFullscreen(element);
          return;
        }
        const active = document.fullscreenElement === element;
        native.current = active;
        setFullscreenActive(active);
        setFallback(!active);
      }).catch(failed); }
      catch { failed(); }
    } else failed();
  }

  function togglePlayback() {
    const intent = ++playbackIntent.current;
    void commands.current.onTogglePlayback().then(() => {
      if (openRef.current && intent === playbackIntent.current) setControlError(false);
    }).catch(() => {
      if (openRef.current && intent === playbackIntent.current) setControlError(true);
    });
  }

  useEffect(() => {
    if (!open) return;
    openRef.current = true;
    native.current = document.fullscreenElement === host.current;
    const previousOverflow = document.body.style.overflow;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const session = viewSession.current;
    const restore = () => {
      if (openRef.current || session !== viewSession.current || !opener.current?.isConnected) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement && focused !== opener.current &&
          focused.isConnected && focused.matches('a[href], button, input, select, textarea, summary, [contenteditable="true"]') &&
          !host.current?.contains(focused) && !focused.matches(":disabled") &&
          !focused.closest("[hidden], [inert]") && focused.getClientRects().length) return;
      window.scrollTo(scrollX, scrollY);
      opener.current.focus({preventScroll: true});
    };
    restorePage.current = restore;
    document.body.style.overflow = "hidden";
    exitButton.current?.focus();
    const appRoot = opener.current?.closest<HTMLElement>("#root");
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    const changed = () => {
      const isFullscreen = document.fullscreenElement === host.current;
      setFullscreenActive(isFullscreen);
      if (isFullscreen) native.current = true;
      else if (native.current && openRef.current) { native.current = false; openRef.current = false; setOpen(false); }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.target === stage.current && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.key === " " && !event.repeat) {
          event.preventDefault();
          togglePlayback();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const { clock: currentClock, duration: total, onSeek: seek } = commands.current;
          const next = currentClock.getPosition() + (event.key === "ArrowLeft" ? -5 : 5);
          seek(Math.max(0, total > 0 ? Math.min(total, next) : next));
          return;
        }
      }
      if (event.key !== "Tab" || !host.current) return;
      const items = [...host.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')].filter((item) => item.getClientRects().length > 0);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", key);
    return () => {
      openRef.current = false;
      fullscreenIntent.current += 1;
      playbackIntent.current += 1;
      native.current = false;
      const pendingExit = exitingFullscreen.current ?? (host.current && document.fullscreenElement === host.current ? exitClosedFullscreen(host.current) : null);
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", key);
      if (appRoot) appRoot.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      void Promise.resolve(pendingExit).then(restore);
    };
  }, [open]);

  useEffect(() => {
    setControlsVisible(true);
    if (!open || !fullscreenActive || !playing || status !== "playing") return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      setControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const focused = document.activeElement;
        const inControls = focused instanceof HTMLElement && (header.current?.contains(focused) || controls.current?.contains(focused) || rosterBar.current?.contains(focused));
        if (inControls && focused.matches(":focus-visible")) return;
        if (inControls) stage.current?.focus({ preventScroll: true });
        setControlsVisible(false);
      }, 3000);
    };
    schedule();
    document.addEventListener("pointermove", schedule);
    document.addEventListener("pointerdown", schedule);
    document.addEventListener("keydown", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointermove", schedule);
      document.removeEventListener("pointerdown", schedule);
      document.removeEventListener("keydown", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
    };
  }, [open, fullscreenActive, playing, status]);

  useEffect(() => {
    if (!open || !panel || !follow || !active) return;
    const list = transcript.current;
    const row = list?.querySelector<HTMLElement>(`[data-immersive-caption="${CSS.escape(active)}"]`);
    if (!list || !row) return;
    const listBox = list.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
    const firstVisible = [...list.querySelectorAll<HTMLElement>("[data-immersive-caption]")]
      .find((item) => item.getBoundingClientRect().bottom > listBox.top);
    const clippedTop = firstVisible && firstVisible.getBoundingClientRect().top < listBox.top - 1;
    const bottomMargin = Math.min(80, listBox.height * 0.2);
    if (clippedTop || rowBox.top < listBox.top || rowBox.bottom > listBox.bottom - bottomMargin) {
      // Align a whole preceding row at the top when it leaves enough room for the current row.
      let anchor = row;
      let previous = anchor.previousElementSibling;
      while (previous instanceof HTMLElement && previous.hasAttribute("data-immersive-caption")) {
        const box = previous.getBoundingClientRect();
        if (rowBox.top - box.top > listBox.height / 3 || rowBox.bottom - box.top > listBox.height) break;
        anchor = previous;
        previous = previous.previousElementSibling;
      }
      list.scrollTop += anchor.getBoundingClientRect().top - listBox.top;
    }
  }, [open, panel, follow, active, start]);

  const textCaptions = current.length ? current : retainedCaptions;
  const contextOnly = context.length > 0 && current.length === 0 && (!playing || status !== "playing");
  const textKey = textCaptions.map((caption) => caption.id).join("|");
  const textFitKey = textCaptions.map((caption) => `${caption.id}:${caption.text}`).join("|");

  // Fit the current caption to its stable stage area without changing speaker layout.
  useLayoutEffect(() => {
    const box = captionBox.current;
    const area = box?.parentElement;
    if (!open || !showCaptions || !box || !area) return;
    const fit = () => {
      const preferred = Number.parseFloat(getComputedStyle(area).fontSize);
      if (!Number.isFinite(preferred) || area.clientWidth === 0 || area.clientHeight === 0) return;
      const meta = area.querySelector<HTMLElement>(".immersive-caption-meta");
      const areaStyle = getComputedStyle(area);
      const cardInset = meta ? meta.offsetHeight + 4 + parseFloat(areaStyle.paddingTop) + parseFloat(areaStyle.paddingBottom) : 0;
      let low = Math.min(16, preferred), high = preferred;
      for (let iteration = 0; iteration < 9; iteration++) {
        const candidate = (low + high) / 2;
        box.style.fontSize = `${candidate}px`;
        const limit = Math.min(Math.max(0, area.clientHeight - cardInset), candidate * 4.05);
        if (box.scrollHeight <= limit + 1 && box.scrollWidth <= box.clientWidth + 1) low = candidate;
        else high = candidate;
      }
      box.style.fontSize = `${low}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [open, showCaptions, size, textFitKey]);

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
  const retainedLabel = lastCaptions.length ? t("Last caption · not current speech", "上一条字幕 · 当前没有归属发言") : t("Context only", "仅显示上下文");
  const captionAttribution = textCaptions.map((caption) => caption.speakerIds.length ? speakerName(meeting, caption.speakerIds) : t("Unknown speaker", "未知说话人")).join(" + ");
  const captionState = status === "error" || status === "buffering" ? state : current.length
    ? playing && status === "playing" ? t("Speaking", "正在发言") : t("At this position", "此位置的归属") : retainedLabel;
  const suspend = (reason: string) => { setPage(start); setFollow(false); setPauseReason(reason); };
  const jumpToCurrent = () => { setSearch(""); setFollow(true); setPauseReason(""); };
  return <>
    <Button ref={opener} type="button" className="button secondary compact" onClick={enter}><Icon glyph={Maximize2} size="compact" /> {t("Immersive playback", "沉浸式播放")}</Button>
    {createPortal(<div ref={host} hidden={!open} className="immersive" role="dialog" aria-modal="true" aria-label={t("Immersive playback", "沉浸式播放")}>
      {open && <>
        <header ref={header} hidden={!controlsVisible} className="immersive-header"><strong>MeetingMemo</strong><span role="group" aria-label={t("Meeting title", "会议标题")}>{meeting.title}</span><Button className="immersive-fullscreen-toggle" type="button" onClick={toggleFullscreen} aria-label={fullscreenActive ? t("Exit full screen", "\u9000\u51fa\u5168\u5c4f") : t("Enter full screen", "\u8fdb\u5165\u5168\u5c4f")}>{fullscreenActive ? <Icon glyph={Minimize2} size="status" /> : <Icon glyph={Maximize2} size="status" />}<span className="immersive-fullscreen-label">{fullscreenActive ? t("Exit full screen", "\u9000\u51fa\u5168\u5c4f") : t("Full screen", "\u5168\u5c4f")}</span></Button><Button className="immersive-exit-button" ref={exitButton} type="button" onClick={close} aria-label={t("Exit immersive", "\u9000\u51fa\u6c89\u6d78\u6a21\u5f0f")}><Icon glyph={X} size="status" /><span className="immersive-exit-label">{t("Exit immersive", "\u9000\u51fa\u6c89\u6d78\u6a21\u5f0f")}</span></Button></header>
        {fallback && <p className="immersive-fallback" role="status">{t("Full screen is unavailable; using the in-page view.", "无法使用全屏，正在使用页面内视图。")}</p>}
        {controlError && <p className="immersive-fallback" role="alert">{t("Playback could not start.", "无法开始播放。")}</p>}
        {fullscreenError && <p className="immersive-fallback" role="alert">{t("Full screen could not change. Try again or use your browser controls.", "无法切换全屏。请重试或使用浏览器控制。")}</p>}
        <div className="immersive-content">
          <section ref={stage} tabIndex={0} className="immersive-stage" data-roster-open={showRoster} data-cinematic={showTable && !controlsVisible && !panel && !showRoster} aria-label={t("Speaker and captions", "说话人和字幕")} aria-describedby="immersive-keyboard-help">
            <div ref={rosterBar} hidden={!controlsVisible} className="immersive-roster-bar">
              <span>{meeting.speakers.length} {t("speaker labels", "个说话人标签")}</span>
              <Button type="button" aria-expanded={showRoster} aria-controls="immersive-roster" onClick={() => setShowRoster(!showRoster)}>{showRoster ? t("Hide labels", "隐藏标签") : t("View labels", "查看标签")}</Button>
              {showRoster && <Button type="button" aria-pressed={relevantRoster} aria-controls="immersive-roster" onClick={() => setRelevantRoster(!relevantRoster)}>{t("Relevant labels only", "仅显示相关标签")}</Button>}
              {tableAvailable && <div className="immersive-speaker-layout" role="group" aria-label={t("Speaker layout", "说话人布局")}>
                <Button type="button" aria-pressed={!showTable} onClick={() => setSpeakerLayout("single")}>{t("Single", "单人")}</Button>
                <Button type="button" aria-pressed={showTable} onClick={() => setSpeakerLayout("table")}>{t("Table", "会议桌")}</Button>
              </div>}
            </div>
            <div id="immersive-roster" className="immersive-roster" hidden={!showRoster} role="group" aria-label={t("Speaker labels", "说话人标签")}>
              {rosterSpeakers.map((speaker) => {
                const atPosition=activeIds.has(speaker.id);
                const previousContext=!current.length && contextIds.has(speaker.id);
                const speaking=playing && status === "playing" && atPosition;
                return <div className="immersive-person" key={speaker.id} data-speaker-id={speaker.id} data-active={speaking} data-position={atPosition} data-context={previousContext}>
                  <strong>{speaker.name}</strong><span>{speaker.confirmed ? t("Name confirmed", "姓名已确认") : t("Unconfirmed", "未确认")}</span>
                  <span aria-hidden={!atPosition && !previousContext}>{speaking ? t("Speaking", "正在发言") : atPosition ? t("At this position", "此位置的归属") : previousContext ? retainedLabel : "\u00a0"}</span>
                </div>;
              })}
              {showUnknownLabel && <div className="immersive-person" data-unknown="true" data-active={playing && status === "playing" && activeUnknown} data-position={activeUnknown} data-context={!current.length && contextUnknown}>
                <strong>{t("Unknown speaker", "未知说话人")}</strong><span>{t("No confirmed identity", "身份未确认")}</span>
                <span>{activeUnknown ? playing && status === "playing" ? t("Speaking", "正在发言") : t("At this position", "此位置的归属") : retainedLabel}</span>
              </div>}
              {relevantRoster && !rosterSpeakers.length && !showUnknownLabel && <p>{t("No attributed speech or retained context here.", "此处没有已归属发言或保留的上下文。")}</p>}
              <Button type="button" onClick={() => { close(); onEditSpeakers(); }}>{t("Edit speakers", "编辑说话人")}</Button>
            </div>
            {showTable ? <div className={longTable ? "immersive-table-speakers long-table" : "immersive-table-speakers"} style={tableStyle} data-count={speakerCount} data-glow-seat={glowSeat >= 0 ? glowSeat : undefined} role="group" tabIndex={0} aria-label={t("Meeting speaker labels", "会议说话人标签")}>
              {meeting.speakers.map((speaker, index) => {
                const atPosition = activeIds.has(speaker.id);
                const speaking = playing && status === "playing" && atPosition;
                const { row, column, span } = tableSeat(index, speakerCount, topSeats);
                return <div className="immersive-table-speaker" style={{ gridRow: row, gridColumn: `${column} / span ${span}` }} key={speaker.id} data-speaker-id={speaker.id} data-active={speaking} data-position={atPosition}>
                  <SpeakerAvatar id={speaker.id} image={avatars[speaker.id]} className="immersive-avatar" />
                  <strong title={speaker.name}>{speaker.name}</strong>
                  <span className="immersive-confirmation">{speaker.confirmed ? t("Name confirmed", "姓名已确认") : t("Unconfirmed", "未确认")}</span>
                  <span className="immersive-table-activity">{speaking ? t("Speaking", "正在发言") : atPosition ? t("At this position", "此位置的归属") : "\u00a0"}</span>
                </div>;
              })}
            </div> : <div className="immersive-current-speakers" role="group" aria-label={t("Speaker attribution and context", "说话人归属及上下文")}>
              {currentSpeakers.map((speaker) => <div className="immersive-current-speaker" key={speaker.id} data-active={playing && status === "playing" && activeIds.has(speaker.id)} data-context={!current.length && contextIds.has(speaker.id)}>
                <SpeakerAvatar id={speaker.id} image={avatars[speaker.id]} className="immersive-avatar" />
                <strong>{speaker.name}</strong><span className="immersive-confirmation">{speaker.confirmed ? t("Name confirmed", "姓名已确认") : t("Unconfirmed", "未确认")}</span>
                {!current.length && <span className="immersive-sr-only">{retainedLabel}</span>}
              </div>)}
              {(activeUnknown || (!current.length && contextUnknown)) && <div className="immersive-current-speaker" data-context={!current.length}><span className="immersive-avatar" aria-hidden="true">?</span><strong>{t("Unknown speaker", "未知说话人")}</strong>{!current.length && <span className="immersive-sr-only">{retainedLabel}</span>}</div>}
            </div>}
            {/* Two fixed lines, so a status or context message appearing never moves what is below it. */}
            <div className="immersive-status">
              {overlap && current.length > 0 && detectedOverlap(overlap, exact) &&
                <OverlapNotice evidence={overlap} unknown={activeUnknown} t={t} />}
              <p className={`immersive-state${status === "error" || status === "buffering" ? "" : " immersive-sr-only"}`}>{state}</p>
              {showTable && (activeUnknown || (!current.length && contextUnknown)) && <p className="immersive-state">{activeUnknown ? t("Unknown speaker at this position", "此位置有未知说话人") : t("Previous unknown speaker · context only", "上一位未知说话人 · 仅显示上下文")}</p>}
              <p className="immersive-state immersive-sr-only">{contextOnly ? t("Between words · context only", "词语间隙 · 仅显示上下文") : lastCaptions.length ? retainedLabel : " "}</p>
              {!captions.length && <p className="immersive-state">{t("Speaker timing is unavailable.", "说话人时间不可用。")}</p>}
            </div>
            {showCaptions && <div className={`immersive-captions size-${size}${showTable ? " immersive-table-captions" : ""}`}>
              {showTable && <div className="immersive-caption-meta"><strong title={captionAttribution}>{captionAttribution || t("No attributed speech", "没有已归属的发言")}</strong><span>{textCaptions.length ? captionState : "\u00a0"}</span>{textCaptions.length === 1 && <time>{formatTime(textCaptions[0].start)}</time>}</div>}
              <div ref={captionBox} className="immersive-caption-content" role="region" tabIndex={0} aria-label={t("Captions", "字幕")}>{textCaptions.map((caption) => <p key={caption.id}>
              {(current.length > 1 || caption.speakerIds.length !== 1) && <span className="immersive-caption-speaker">{caption.speakerIds.length ? speakerName(meeting, caption.speakerIds) : t("Unknown speaker", "未知说话人")}: </span>}
              {caption.fragments.map((fragment, index) => <span key={fragment.id} data-current={fragmentsAtTime([fragment], exact).length > 0 ? "true" : undefined}>{index > 0 && joinedText([caption.fragments[index - 1].text, fragment.text]) !== caption.fragments[index - 1].text + fragment.text ? " " : ""}{fragment.text}</span>)}
            </p>)}</div></div>}
          </section>
          {panel && <aside className="immersive-transcript" aria-label={t("Transcript", "转录")} style={{ "--transcript-width": `${panelWidth}%` } as CSSProperties}>
            <div className="immersive-panel-head"><h2>{t("Transcript", "转录")}</h2><Button type="button" onClick={() => { setPanel(false); transcriptToggle.current?.focus(); }} aria-label={t("Close transcript", "关闭转录")}><Icon glyph={X} size="small" /></Button></div>
            <label className="immersive-panel-width">{t("Panel width", "面板宽度")} <input type="range" aria-label={t("Transcript panel width", "转录面板宽度")} aria-valuetext={`${panelWidth}%`} min="25" max="45" step="1" value={panelWidth} onChange={(event) => setPanelWidth(Number(event.target.value))} /><span>{panelWidth}%</span></label>
            <label className="immersive-search"><span>{t("Search transcript", "搜索转录")}</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setUntimedPage(0); setFollow(false); setPauseReason("search"); }} placeholder={t("Search text or speaker", "搜索文字或说话人")} /></label>
            <div className="immersive-follow-row"><p className="immersive-follow-status" data-follow-pause-reason={follow ? undefined : pauseReason || undefined}>{follow && !searchTerm ? t("Following playback", "正在跟随播放") : searchTerm ? t("Search results · follow paused", "搜索结果 · 跟随已暂停") : t("Follow paused", "跟随已暂停")}</p><Button type="button" onClick={jumpToCurrent}>{t("Jump to current", "跳至当前位置")}</Button></div>
            <div ref={transcript} className="immersive-transcript-list" onWheel={() => suspend("wheel")} onTouchMove={() => suspend("touch")} onPointerDown={() => suspend("pointer")} onKeyDown={(event) => suspend(`key:${event.key}`)} tabIndex={0}>
              {visible.map((caption) => <Button key={caption.id} type="button" data-immersive-caption={caption.id} className={current.includes(caption) ? "is-current" : ""} onClick={() => { suspend("caption-click"); onSeek(caption.start); }}>
                <span className="immersive-row-meta"><span>{formatTime(caption.start)}</span><strong>{caption.speakerIds.length ? speakerName(meeting, caption.speakerIds) : t("Unknown speaker", "未知说话人")}</strong></span>
                <span>{caption.fragments.map((fragment, index) => <span key={fragment.id} className={fragmentsAtTime([fragment], exact).length ? "is-current-fragment" : undefined}>{index > 0 && joinedText([caption.fragments[index - 1].text, fragment.text]) !== caption.fragments[index - 1].text + fragment.text ? " " : ""}{fragment.text}</span>)}</span>
              </Button>)}
              {searchTerm && !matchingCaptions.length && <p className="immersive-empty">{matchingUntimed.length ? t("No timed captions match.", "没有匹配的带时间字幕。") : t("No transcript matches.", "没有匹配的转录。")}</p>}
            </div>
              {matchingUntimed.length > 0 && <details className="immersive-untimed" open={searchTerm ? true : undefined}><summary><span>{t("Timing unavailable", "时间不可用")}</span> ({matchingUntimed.length})</summary>{matchingUntimed.slice(untimedPage, untimedPage + 40).map((segment) => <p key={segment.id}>{segment.speakerIds.length ? speakerName(meeting, segment.speakerIds) : t("Unknown speaker", "未知说话人")}: {segment.text}</p>)}
                {matchingUntimed.length > 40 && <div><Button type="button" disabled={untimedPage === 0} onClick={() => setUntimedPage(Math.max(0, untimedPage - 40))}>{t("Earlier untimed", "较早的无时间片段")}</Button><Button type="button" disabled={untimedPage + 40 >= matchingUntimed.length} onClick={() => setUntimedPage(untimedPage + 40)}>{t("Later untimed", "较晚的无时间片段")}</Button></div>}
              </details>}
            <div className="immersive-paging"><Button type="button" disabled={start === 0} onClick={() => { setFollow(false); setPauseReason("page-earlier"); setPage(Math.max(0, start - 40)); }}><Icon glyph={ChevronLeft} size="small" />{t("Earlier", "更早")}</Button><span>{t("Caption groups", "字幕组")} {matchingCaptions.length ? start + 1 : 0}–{Math.min(start + 40, matchingCaptions.length)} {t("of", "/")} {matchingCaptions.length}</span><Button type="button" disabled={start + 40 >= matchingCaptions.length} onClick={() => { setFollow(false); setPauseReason("page-later"); setPage(start + 40); }}>{t("Later", "更晚")}<Icon glyph={ChevronRight} size="small" /></Button></div>
          </aside>}
        </div>
        <footer ref={controls} hidden={!controlsVisible} className="immersive-controls">
          <div className="immersive-timeline"><span>{formatTime(position)}</span><input type="range" aria-label={t("Playback position", "播放位置")} min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} onChange={(event) => onSeek(Number(event.target.value))} /><span>{formatTime(duration)}</span></div>
          <div className="immersive-control-row">
          <Button type="button" onClick={togglePlayback} aria-label={playing ? t("Pause audio", "暂停录音") : t("Play audio", "播放录音")}>{playing ? <Icon glyph={Pause} size="transport" /> : <Icon glyph={Play} size="transport" />}</Button>
          <Button type="button" onClick={() => onSeek(Math.max(0, position - 15))} aria-label={t("Back 15 seconds", "后退15秒")}><Icon glyph={RotateCcw} size="control" /> 15</Button>
          <Button type="button" onClick={() => onSeek(Math.min(duration, position + 15))} aria-label={t("Forward 15 seconds", "前进15秒")}><Icon glyph={RotateCw} size="control" /> 15</Button>
          <select aria-label={t("Playback speed", "播放速度")} value={String(rate)} onChange={(event) => onChangeRate(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}</select>
          <Button type="button" aria-pressed={showCaptions} onClick={() => setShowCaptions(!showCaptions)}>{t("Captions", "字幕")}</Button>
          <select aria-label={t("Caption size", "字幕大小")} value={size} onChange={(event) => setSize(event.target.value)}><option value="normal">{t("Normal", "标准")}</option><option value="large">{t("Large", "大")}</option><option value="xlarge">{t("Extra large", "特大")}</option></select>
          <div className="immersive-view-mode" role="group" aria-label={t("View mode", "查看模式")}>
            <Button type="button" aria-pressed={!panel} onClick={() => setPanel(false)}>{t("Focus", "专注")}</Button>
            <Button ref={transcriptToggle} type="button" aria-pressed={panel} onClick={() => setPanel(true)}>{t("Reading", "阅读")}</Button>
          </div>
          </div>
          <p id="immersive-keyboard-help" className="immersive-keyboard-help">{t("Focus the stage: Space plays or pauses; arrow keys skip 5 seconds.", "聚焦舞台后：空格播放或暂停；方向键跳转 5 秒。")}</p>
        </footer>
      </>}
    </div>, document.body)}
  </>;
}
