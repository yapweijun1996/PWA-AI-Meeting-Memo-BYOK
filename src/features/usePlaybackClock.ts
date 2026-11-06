import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type PlaybackStatus =
  | "idle"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "error";

export type PlaybackClock = {
  position: number;
  duration: number;
  rate: number;
  playing: boolean;
  status: PlaybackStatus;
  refresh: () => void;
};

type PlaybackSnapshot = Omit<PlaybackClock, "refresh">;

export function resolvePlaybackStatus(
  currentStatus: PlaybackStatus,
  status: PlaybackStatus | undefined,
  state: {
    error: boolean;
    ended: boolean;
    playing: boolean;
    position: number;
    resetBuffering?: boolean;
  },
): PlaybackStatus {
  if (state.error) return "error";
  if (status) return status;
  if (!state.resetBuffering && currentStatus === "buffering") return "buffering";
  if (state.ended) return "ended";
  if (state.playing) return "playing";
  return state.position > 0 ? "paused" : "idle";
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Owns the read-only playback clock for the persistent audio element.
 * currentTime is sampled from the media element; no wall-clock elapsed time is
 * integrated here. The consumer can therefore use the same position for
 * speaker activity, captions, transcript highlighting, and seeking.
 */
export function usePlaybackClock(
  audioRef: RefObject<HTMLAudioElement | null>,
  enabled: boolean,
  initialDuration = 0,
): PlaybackClock {
  const refreshRef = useRef<() => void>(() => undefined);
  const [clock, setClock] = useState<PlaybackSnapshot>(() => ({
    position: 0,
    duration: finite(initialDuration, 0),
    rate: 1,
    playing: false,
    status: "idle",
  }));

  useEffect(() => {
    if (!enabled) {
      refreshRef.current = () => undefined;
      setClock((current) =>
        current.position === 0 && current.playing === false && current.status === "idle"
          ? current
          : {
              ...current,
              position: 0,
              playing: false,
              status: "idle",
            },
      );
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      refreshRef.current = () => undefined;
      return;
    }

    const read = (status?: PlaybackStatus, resetBuffering = false) => {
      const position = finite(audio.currentTime, 0);
      const duration = finite(audio.duration, finite(initialDuration, 0));
      const rate = finite(audio.playbackRate, 1) || 1;
      const playing = !audio.paused && !audio.ended;
      setClock((current) => {
        const nextStatus = resolvePlaybackStatus(current.status, status, {
          error: Boolean(audio.error),
          ended: audio.ended,
          playing,
          position,
          resetBuffering,
        });
        if (
          current.position === position &&
          current.duration === duration &&
          current.rate === rate &&
          current.playing === playing &&
          current.status === nextStatus
        )
          return current;
        return {
          position,
          duration,
          rate,
          playing,
          status: nextStatus,
        };
      });
    };
    refreshRef.current = read;
    let frame: number | null = null;
    let lastSample = -Infinity;
    const stopSampling = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const sample = (timestamp: number) => {
      frame = null;
      if (audio.paused || audio.ended || audio.error || document.hidden) return;
      // The frame timestamp only limits rendering work; media time is never
      // inferred from it. Media events still handle background/seek transitions.
      if (timestamp - lastSample >= 50) {
        read();
        lastSample = timestamp;
      }
      frame = requestAnimationFrame(sample);
    };
    const startSampling = () => {
      if (frame === null && !audio.paused && !audio.ended && !document.hidden) {
        lastSample = -Infinity;
        frame = requestAnimationFrame(sample);
      }
    };
    const visibilityChanged = () => {
      stopSampling();
      read();
      startSampling();
    };
    const handlers: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
      ["loadedmetadata", () => read(undefined, true)],
      ["durationchange", () => read(undefined, true)],
      ["timeupdate", () => read()],
      ["seeking", () => read()],
      ["seeked", () => read()],
      ["ratechange", () => read()],
      ["play", () => { read("playing"); startSampling(); }],
      ["playing", () => { read("playing"); startSampling(); }],
      ["pause", () => { stopSampling(); read(audio.ended ? "ended" : "paused"); }],
      ["waiting", () => { stopSampling(); read("buffering"); }],
      ["canplay", () => { read(audio.paused ? "paused" : "playing"); startSampling(); }],
      ["ended", () => { stopSampling(); read("ended"); }],
      ["error", () => { stopSampling(); read("error"); }],
    ];
    for (const [event, handler] of handlers) audio.addEventListener(event, handler);
    document.addEventListener("visibilitychange", visibilityChanged);
    read();
    startSampling();
    return () => {
      stopSampling();
      document.removeEventListener("visibilitychange", visibilityChanged);
      for (const [event, handler] of handlers) audio.removeEventListener(event, handler);
      if (refreshRef.current === read) refreshRef.current = () => undefined;
    };
  }, [audioRef, enabled, initialDuration]);

  const refresh = useCallback(() => {
    flushSync(() => refreshRef.current());
  }, []);
  return { ...clock, refresh };
}
