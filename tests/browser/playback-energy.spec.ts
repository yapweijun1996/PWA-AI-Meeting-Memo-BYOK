import { test, expect, type Page } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "no-preference" });
type EnergyWindow = Window & { energyInput: number; energyBindings: number };

function wav(tone: boolean) {
  const rate = 8000,
    seconds = 10,
    bytes = Buffer.alloc(44 + rate * seconds * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  if (tone)
    for (let i = 0; i < rate * seconds; i++)
      bytes.writeInt16LE(
        Math.round(Math.sin((i * 440 * Math.PI * 2) / rate) * 12000),
        44 + i * 2,
      );
  return bytes;
}

async function prepare(
  page: Page,
  mode: "synthetic" | "unavailable" | "native",
) {
  await page.context().route("https://**/*", (route) => route.abort());
  await page.addInitScript((kind) => {
    window.confirm = () => true;
    const state = window as unknown as EnergyWindow;
    state.energyInput = 0.8;
    state.energyBindings = 0;
    if (kind === "native") {
      // Keep the native graph, but mute its final output for this synthetic tone.
      const NativeContext = AudioContext;
      class QuietContext extends NativeContext {
        constructor() {
          super();
        }
        createMediaElementSource(media: HTMLMediaElement) {
          state.energyBindings++;
          const node = super.createMediaElementSource(media);
          const connect = node.connect.bind(node);
          node.connect = ((target: AudioNode) => {
            if (target === this.destination) {
              const quiet = this.createGain();
              quiet.gain.value = 0;
              quiet.connect(target);
              return connect(quiet);
            }
            return connect(target);
          }) as typeof node.connect;
          return node;
        }
      }
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: QuietContext,
      });
      return;
    }
    class SyntheticContext {
      state = "running";
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createAnalyser() {
        return {
          fftSize: 512,
          getFloatTimeDomainData: (values: Float32Array) =>
            values.fill(state.energyInput),
        };
      }
      createMediaElementSource() {
        state.energyBindings++;
        return { connect() {}, disconnect() {} };
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: kind === "unavailable" ? undefined : SyntheticContext,
    });
    for (const type of [
      "error",
      "playing",
      "waiting",
      "pause",
      "ended",
      "timeupdate",
      "seeked",
    ]) {
      document.addEventListener(
        type,
        (event) => {
          if (event.isTrusted && event.target instanceof HTMLMediaElement)
            event.stopImmediatePropagation();
        },
        true,
      );
    }
    Object.defineProperty(HTMLMediaElement.prototype, "error", {
      configurable: true,
      get: () => null,
    });
    HTMLMediaElement.prototype.play = function () {
      Object.defineProperty(this, "paused", {
        configurable: true,
        value: false,
      });
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      Object.defineProperty(this, "paused", {
        configurable: true,
        value: true,
      });
      this.dispatchEvent(new Event("pause"));
    };
  }, mode);
  const meeting = sampleMeeting();
  meeting.title = `Energy ${mode} control`;
  meeting.synthetic = true;
  meeting.segments = meeting.segments.slice(0, 3).map((segment, index) => ({
    ...segment,
    start: index === 0 ? 0 : index === 1 ? 1 : 4,
    end: index === 0 ? 2 : index === 1 ? 3 : 9,
    speakerIds: [meeting.speakers[index === 1 ? 1 : 0].id],
  }));
  meeting.memos = [];
  meeting.audio = null;
  await page.goto("./");
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "energy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(meeting)),
  });
  await expect(
    page.getByRole("heading", {
      name: `${meeting.title} (restored)`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({
    name: "synthetic-energy.wav",
    mimeType: "audio/wav",
    buffer: wav(mode === "native"),
  });
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  if (mode !== "native")
    await page.locator("audio").evaluate((element) => {
      let time = 0;
      Object.defineProperty(element, "currentTime", {
        configurable: true,
        get: () => time,
        set: (value) => {
          time = value;
        },
      });
    });
  await page.getByRole("tab", { name: /^Speakers/ }).click();
  await page
    .getByRole("button", { name: "Playback mode", exact: true })
    .click();
}

async function seek(page: Page, time: number) {
  await page.locator("audio").evaluate((element, value) => {
    (element as HTMLMediaElement).currentTime = value;
    element.dispatchEvent(new Event("seeked"));
  }, time);
}
async function scales(page: Page) {
  return page
    .locator(".playback-current-speaker .speaker-avatar")
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          new DOMMatrix(getComputedStyle(element, "::after").transform).a,
      ),
    );
}

test("energy halos respect overlap, pause, gaps, silence, buffering and live reduced motion", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "synthetic");
  await seek(page, 1.5);
  await expect.poll(() => scales(page)).toEqual([1, 1]);
  await page
    .locator(".audio-player")
    .getByRole("button", { name: "Play audio", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await scales(page)).filter((value) => value > 1.02 && value <= 1.12)
          .length,
    )
    .toBe(2);
  await page
    .locator(".playback-mode")
    .screenshot({ path: info.outputPath("overlap-energy.png") });
  await page.evaluate(() => {
    (window as unknown as EnergyWindow).energyInput = 0;
  });
  await expect.poll(() => scales(page)).toEqual([1, 1]);
  await page.evaluate(() => {
    (window as unknown as EnergyWindow).energyInput = 0.8;
  });
  await seek(page, 3.5);
  await expect(page.locator('[data-speaker-active="true"]')).toHaveCount(0);
  await seek(page, 4.5);
  await expect.poll(async () => (await scales(page))[0]).toBeGreaterThan(1.02);
  await page.locator("audio").dispatchEvent("waiting");
  await expect.poll(() => scales(page)).toEqual([1]);
  await page.locator("audio").dispatchEvent("canplay");
  await expect.poll(async () => (await scales(page))[0]).toBeGreaterThan(1.02);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => scales(page)).toEqual([1]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => (await scales(page))[0]).toBeGreaterThan(1.02);
  await page
    .locator(".audio-player")
    .getByRole("button", { name: "Pause audio", exact: true })
    .click();
  await expect.poll(() => scales(page)).toEqual([1]);
  expect(
    await page.evaluate(
      () => (window as unknown as EnergyWindow).energyBindings,
    ),
  ).toBe(1);
});

test("unavailable Web Audio keeps the ordinary player usable without a halo", async ({
  page,
}) => {
  await prepare(page, "unavailable");
  await seek(page, 0.5);
  await page
    .locator(".audio-player")
    .getByRole("button", { name: "Play audio", exact: true })
    .click();
  await expect(page.locator('[data-speaker-active="true"]')).toHaveCount(1);
  await expect.poll(() => scales(page)).toEqual([1]);
  await page
    .locator(".audio-player")
    .getByRole("button", { name: "Pause audio", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as EnergyWindow).energyBindings,
    ),
  ).toBe(0);
});

test("native recording energy reaches the halo and the native clock continues", async ({
  page,
}, info) => {
  await prepare(page, "native");
  await seek(page, 4.5);
  await page
    .locator(".audio-player")
    .getByRole("button", { name: "Play audio", exact: true })
    .click();
  await expect.poll(async () => (await scales(page))[0]).toBeGreaterThan(1.005);
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((element) => (element as HTMLMediaElement).currentTime),
    )
    .toBeGreaterThan(5);
  await page
    .locator(".playback-mode")
    .screenshot({ path: info.outputPath("native-energy.png") });
  await page
    .locator(".audio-player")
    .getByRole("button", { name: "Pause audio", exact: true })
    .click();
  await expect.poll(() => scales(page)).toEqual([1]);
  expect(
    await page.evaluate(
      () => (window as unknown as EnergyWindow).energyBindings,
    ),
  ).toBe(1);
});
