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
    const handlers: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
      ["loadedmetadata", () => read(undefined, true)],
      ["durationchange", () => read(undefined, true)],
      ["timeupdate", () => read()],
      ["seeking", () => read()],
      ["seeked", () => read()],
      ["ratechange", () => read()],
      ["play", () => read("playing")],
      ["playing", () => read("playing")],
      ["pause", () => read(audio.ended ? "ended" : "paused")],
      ["waiting", () => read("buffering")],
      ["canplay", () => read(audio.paused ? "paused" : "playing")],
      ["ended", () => read("ended")],
      ["error", () => read("error")],
    ];
    for (const [event, handler] of handlers) audio.addEventListener(event, handler);
    read();
    return () => {
      for (const [event, handler] of handlers) audio.removeEventListener(event, handler);
      if (refreshRef.current === read) refreshRef.current = () => undefined;
    };
  }, [audioRef, enabled, initialDuration]);

  const refresh = useCallback(() => {
    flushSync(() => refreshRef.current());
  }, []);
  return { ...clock, refresh };
}
