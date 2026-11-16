export type PlaybackEnergyStore = {
  getEnergy: () => number;
  subscribe: (listener: () => void) => () => void;
};

export function createPlaybackEnergyStore() {
  let energy = 0;
  const listeners = new Set<() => void>();
  return {
    getEnergy: () => energy,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(value: number) {
      const next = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      if (next === energy) return;
      energy = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** RMS describes the combined recording, never an isolated speaker's loudness. */
export function smoothPlaybackEnergy(
  previous: number,
  samples: Float32Array,
): number {
  if (!samples.length) return 0;
  let squares = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) return 0;
    squares += value * value;
  }
  const current = Math.min(1, Math.sqrt(squares / samples.length));
  // Exact silence clears the halo instead of leaving an asymptotic residual.
  if (current === 0) return 0;
  const last = Number.isFinite(previous)
    ? Math.max(0, Math.min(1, previous))
    : 0;
  return Math.min(1, last * 0.75 + current * 0.25);
}

type Graph = {
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  owners: Set<object>;
};

/** One bounded context per page; an element may have only one source node. */
export class PlaybackEnergyHub {
  private context?: AudioContext;
  private pending?: Promise<boolean>;
  private readonly graphs = new WeakMap<HTMLMediaElement, Graph>();
  private readonly unavailable = new WeakSet<HTMLMediaElement>();

  constructor(private readonly createContext: () => AudioContext) {}

  async prepare(): Promise<boolean> {
    try {
      const context = (this.context ??= this.createContext());
      if (context.state === "running") return true;
      if (context.state === "closed") return false;
      return await (this.pending ??= context
        .resume()
        .then(
          () => context.state === "running",
          () => false,
        )
        .finally(() => {
          this.pending = undefined;
        }));
    } catch {
      return false;
    }
  }

  hasSource(element: HTMLMediaElement) {
    return this.graphs.has(element);
  }

  acquire(
    element: HTMLMediaElement,
    owner: object,
    existingOnly = false,
  ): Graph | undefined {
    const context = this.context;
    // Never reroute native audio through a context that could not resume.
    if (
      !context ||
      context.state !== "running" ||
      this.unavailable.has(element)
    )
      return;
    let graph = this.graphs.get(element);
    if (!graph && existingOnly) return;
    if (!graph) {
      try {
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        graph = {
          source: context.createMediaElementSource(element),
          analyser,
          samples: new Float32Array(analyser.fftSize),
          owners: new Set(),
        };
        this.graphs.set(element, graph);
      } catch {
        this.unavailable.add(element);
        return;
      }
    }
    if (!graph.owners.size) {
      // The audible path bypasses the analyser; no gain/filter changes are made.
      graph.source.connect(context.destination);
      graph.source.connect(graph.analyser);
    }
    graph.owners.add(owner);
    return graph;
  }

  release(graph: Graph, owner: object) {
    graph.owners.delete(owner);
    if (!graph.owners.size) graph.source.disconnect();
  }

  isRunning() {
    return this.context?.state === "running";
  }
}

export class PlaybackEnergySampler {
  private graph?: Graph;
  private element?: HTMLMediaElement;
  private previous = 0;
  constructor(private readonly hub: PlaybackEnergyHub) {}

  prepare() {
    return this.hub.prepare();
  }

  restore(element: HTMLMediaElement | null) {
    if (element !== this.element) {
      this.release();
      this.element = element ?? undefined;
    }
    try {
      if (element) this.graph ??= this.hub.acquire(element, this, true);
    } catch {
      this.reset();
    }
  }

  sample(element: HTMLMediaElement | null): number {
    if (element !== this.element) {
      this.release();
      this.element = element ?? undefined;
    }
    if (!element) return 0;
    try {
      this.graph ??= this.hub.acquire(element, this);
      if (!this.graph || !this.hub.isRunning()) return this.reset();
      this.graph.analyser.getFloatTimeDomainData(this.graph.samples);
      return (this.previous = smoothPlaybackEnergy(
        this.previous,
        this.graph.samples,
      ));
    } catch {
      return this.reset();
    }
  }

  reset() {
    this.previous = 0;
    return 0;
  }

  release() {
    if (this.graph) this.hub.release(this.graph, this);
    this.graph = undefined;
    this.element = undefined;
    this.reset();
  }
}

export const playbackEnergyHub = new PlaybackEnergyHub(
  () => new AudioContext(),
);
