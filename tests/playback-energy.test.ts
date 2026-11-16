import { describe, expect, it, vi } from "vitest";
import {
  createPlaybackEnergyStore,
  PlaybackEnergyHub,
  PlaybackEnergySampler,
  smoothPlaybackEnergy,
} from "../src/audio/playback-energy";

function fixture(state = "running") {
  let amplitude = 0.5;
  const sources: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const context = {
    state,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    createAnalyser: vi.fn(() => ({
      fftSize: 512,
      getFloatTimeDomainData: (values: Float32Array) => values.fill(amplitude),
    })),
    createMediaElementSource: vi.fn(() => {
      const source = { connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }),
  };
  const hub = new PlaybackEnergyHub(() => context as unknown as AudioContext);
  return {
    context,
    hub,
    sources,
    setAmplitude(value: number) {
      amplitude = value;
    },
  };
}
const element = () => ({}) as HTMLMediaElement;

describe("recording energy", () => {
  it("does not repeatedly bind an unsupported element", async () => {
    const { hub, context } = fixture(),
      sampler = new PlaybackEnergySampler(hub),
      media = element();
    context.createMediaElementSource.mockImplementation(() => {
      throw new Error("unsupported");
    });
    await sampler.prepare();
    expect(sampler.sample(media)).toBe(0);
    expect(sampler.sample(media)).toBe(0);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("shares an in-flight resume across playback events", async () => {
    const { hub, context } = fixture("suspended");
    let resume!: () => void;
    context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resume = () => {
            context.state = "running";
            resolve();
          };
        }),
    );
    const one = hub.prepare(),
      two = hub.prepare();
    expect(context.resume).toHaveBeenCalledTimes(1);
    resume();
    expect(await Promise.all([one, two])).toEqual([true, true]);
  });
  it("restores only previously bound output paths without sampling or creating a new source", async () => {
    const { hub, context, sources } = fixture(),
      media = element();
    const original = new PlaybackEnergySampler(hub);
    await original.prepare();
    original.sample(media);
    original.release();
    const restored = new PlaybackEnergySampler(hub);
    restored.restore(media);
    expect(sources[0].connect.mock.calls.at(-2)).toEqual([context.destination]);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
    restored.restore(element());
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
    restored.release();
  });
  it("smooths RMS with the requested weights, bounds input and clears silence", () => {
    expect(
      smoothPlaybackEnergy(0.4, new Float32Array([0.8, -0.8])),
    ).toBeCloseTo(0.5);
    expect(smoothPlaybackEnergy(10, new Float32Array([10]))).toBe(1);
    expect(smoothPlaybackEnergy(-1, new Float32Array([1]))).toBe(0.25);
    expect(smoothPlaybackEnergy(NaN, new Float32Array([1]))).toBe(0.25);
    expect(smoothPlaybackEnergy(1, new Float32Array([0, 0]))).toBe(0);
    expect(smoothPlaybackEnergy(1, new Float32Array())).toBe(0);
    expect(smoothPlaybackEnergy(1, new Float32Array([NaN]))).toBe(0);
  });

  it("publishes bounded changes and supports unsubscribe", () => {
    const store = createPlaybackEnergyStore(),
      listener = vi.fn();
    const off = store.subscribe(listener);
    store.set(2);
    store.set(2);
    expect(store.getEnergy()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.set(NaN);
    expect(store.getEnergy()).toBe(0);
    off();
    store.set(0.5);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not reroute audio before a context is running", async () => {
    const { context, hub } = fixture("suspended"),
      sampler = new PlaybackEnergySampler(hub),
      media = element();
    expect(sampler.sample(media)).toBe(0);
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
    expect(await sampler.prepare()).toBe(true);
    expect(sampler.sample(media)).toBe(0.125);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("retains the direct output path and reuses the source across effect replay", async () => {
    const { context, hub, sources } = fixture(),
      media = element();
    const first = new PlaybackEnergySampler(hub);
    await first.prepare();
    first.sample(media);
    expect(sources[0].connect.mock.calls[0]).toEqual([context.destination]);
    expect(sources[0].connect).toHaveBeenCalledTimes(2);
    first.release();
    const replay = new PlaybackEnergySampler(hub);
    expect(replay.sample(media)).toBe(0.125);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(sources[0].disconnect).toHaveBeenCalledTimes(1);
    expect(sources[0].connect).toHaveBeenCalledTimes(4);
    replay.release();
  });

  it("does not disconnect another owner and resets at chunk switches", async () => {
    const { hub, sources, context } = fixture(),
      media = element();
    const one = new PlaybackEnergySampler(hub),
      two = new PlaybackEnergySampler(hub);
    await one.prepare();
    one.sample(media);
    two.sample(media);
    one.release();
    expect(sources[0].disconnect).not.toHaveBeenCalled();
    expect(two.sample(element())).toBe(0.125);
    expect(sources[0].disconnect).toHaveBeenCalledTimes(1);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
    two.release();
  });

  it("clears energy on silence, reset, missing media and context interruption", async () => {
    const { hub, context, setAmplitude } = fixture(),
      sampler = new PlaybackEnergySampler(hub),
      media = element();
    await sampler.prepare();
    expect(sampler.sample(media)).toBe(0.125);
    setAmplitude(0);
    expect(sampler.sample(media)).toBe(0);
    setAmplitude(1);
    expect(sampler.sample(media)).toBe(0.25);
    sampler.reset();
    expect(sampler.sample(media)).toBe(0.25);
    context.state = "suspended";
    expect(sampler.sample(media)).toBe(0);
    expect(sampler.sample(null)).toBe(0);
    sampler.release();
  });

  it("falls back without binding when context creation or resume is refused", async () => {
    const unavailable = new PlaybackEnergySampler(
      new PlaybackEnergyHub(() => {
        throw new Error("unavailable");
      }),
    );
    expect(await unavailable.prepare()).toBe(false);
    expect(unavailable.sample(element())).toBe(0);
    const { hub, context } = fixture("suspended");
    context.resume.mockRejectedValue(new Error("denied"));
    const denied = new PlaybackEnergySampler(hub);
    expect(await denied.prepare()).toBe(false);
    expect(denied.sample(element())).toBe(0);
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
  });
});
