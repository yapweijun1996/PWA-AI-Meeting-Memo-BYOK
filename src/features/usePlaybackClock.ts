import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerLike } from "../audio/chunked-audio";
import { createPlaybackEnergyStore, PlaybackEnergySampler, playbackEnergyHub, type PlaybackEnergyStore } from "../audio/playback-energy";

export type PlaybackStatus =
  | "idle"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "error";

/**
 * High-resolution playhead outside React state. It is updated on every sample
 * (on foreground animation frames) without rendering anything; components subscribe with
 * useSyncExternalStore and a selector that only changes when they need to render.
 */
export type PlaybackClockStore = {
  getPosition: () => number;
  subscribe: (listener: () => void) => () => void;
};

export function createPlaybackClockStore(): PlaybackClockStore & { set: (position: number) => void } {
  let position = 0;
  const listeners = new Set<() => void>();
  return {
    getPosition: () => position,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (next === position) return;
      position = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export type PlaybackClock = {
  position: number;
  duration: number;
  rate: number;
  playing: boolean;
  status: PlaybackStatus;
  refresh: () => void;
  /** Exact playhead for components that should not re-render on every sample. */
  store: PlaybackClockStore;
  energy: PlaybackEnergyStore;
};

type PlaybackSnapshot = Omit<PlaybackClock, "refresh" | "store" | "energy">;

/**
 * `position` in React state is only for coarse UI (time label, range input, speaker toolbar).
 * Sampling and timeupdate reads republish it once per bucket instead of every frame;
 * every discrete event (seek, pause, rate change, ...) still publishes the exact position.
 */
export const COARSE_POSITION_SECONDS = 0.25;

export function samePositionBucket(a: number, b: number) {
  return Math.floor(a / COARSE_POSITION_SECONDS) === Math.floor(b / COARSE_POSITION_SECONDS);
}

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
  audioRef: RefObject<PlayerLike | null>,
  enabled: boolean,
  initialDuration = 0,
): PlaybackClock {
  const refreshRef = useRef<() => void>(() => undefined);
  const [store] = useState(createPlaybackClockStore);
  const [energy] = useState(createPlaybackEnergyStore);
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
      store.set(0);
      energy.set(0);
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

    const sampler = new PlaybackEnergySampler(playbackEnergyHub);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let waiting = false;
    const mediaElement = () => audio instanceof HTMLMediaElement ? audio : audio.getAudioElement?.() ?? null;
    const resetEnergy = () => { sampler.reset(); energy.set(0); };
    const sampleEnergy = () => {
      sampler.restore(mediaElement());
      if (motion.matches || waiting || audio.paused || audio.ended || audio.error || document.hidden) resetEnergy();
      else energy.set(sampler.sample(mediaElement()));
    };
    const prepareEnergy = () => {
      const element = mediaElement();
      if (document.hidden || audio.paused || !element || (motion.matches && !playbackEnergyHub.hasSource(element))) return;
      void sampler.prepare().then(() => { if (!disposed) sampleEnergy(); });
    };
    const motionChanged = () => { resetEnergy(); if (!motion.matches) prepareEnergy(); };
    motion.addEventListener("change", motionChanged);
    // Reconnect a cached element immediately after an effect replay; never create a context here.
    sampler.restore(mediaElement());

    const read = (status?: PlaybackStatus, resetBuffering = false, coarse = false) => {
      const position = finite(audio.currentTime, 0);
      const duration = finite(audio.duration, finite(initialDuration, 0));
      const rate = finite(audio.playbackRate, 1) || 1;
      const playing = !audio.paused && !audio.ended;
      store.set(position);
      setClock((current) => {
        const nextStatus = resolvePlaybackStatus(current.status, status, {
          error: Boolean(audio.error),
          ended: audio.ended,
          playing,
          position,
          resetBuffering,
        });
        if (
          (coarse ? samePositionBucket(current.position, position) : current.position === position) &&
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
    const stopSampling = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const sample = () => {
      frame = null;
      if (audio.paused || audio.ended || audio.error || document.hidden) return;
      // Sample actual media time on each foreground frame. Boundary-based
      // subscribers still render only when their derived interval changes.
      read(undefined, false, true);
      sampleEnergy();
      frame = requestAnimationFrame(sample);
    };
    const startSampling = () => {
      if (frame === null && !audio.paused && !audio.ended && !document.hidden) {
        frame = requestAnimationFrame(sample);
      }
    };
    const visibilityChanged = () => {
      stopSampling();
      read();
      resetEnergy();
      if (!document.hidden) prepareEnergy();
      startSampling();
    };
    const handlers: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
      ["loadedmetadata", () => read(undefined, true)],
      ["durationchange", () => read(undefined, true)],
      ["timeupdate", () => read(undefined, false, true)],
      ["seeking", () => { resetEnergy(); read(); }],
      ["seeked", () => read()],
      ["ratechange", () => read()],
      ["play", () => { waiting = false; read("playing"); prepareEnergy(); startSampling(); }],
      ["playing", () => { waiting = false; read("playing"); prepareEnergy(); startSampling(); }],
      ["pause", () => { stopSampling(); resetEnergy(); read(audio.ended ? "ended" : "paused"); }],
      ["waiting", () => { waiting = true; stopSampling(); resetEnergy(); read("buffering"); }],
      ["canplay", () => { waiting = false; read(audio.paused ? "paused" : "playing"); prepareEnergy(); startSampling(); }],
      ["ended", () => { stopSampling(); resetEnergy(); read("ended"); }],
      ["error", () => { stopSampling(); resetEnergy(); read("error"); }],
    ];
    for (const [event, handler] of handlers) audio.addEventListener(event, handler);
    document.addEventListener("visibilitychange", visibilityChanged);
    read();
    prepareEnergy();
    startSampling();
    return () => {
      disposed = true;
      stopSampling();
      resetEnergy();
      sampler.release();
      motion.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
      for (const [event, handler] of handlers) audio.removeEventListener(event, handler);
      if (refreshRef.current === read) refreshRef.current = () => undefined;
    };
  }, [audioRef, enabled, initialDuration, store, energy]);

  const refresh = useCallback(() => {
    flushSync(() => refreshRef.current());
  }, []);
  return { ...clock, refresh, store, energy };
}
