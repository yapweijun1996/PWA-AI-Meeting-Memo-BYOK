/* global Audio, AudioContext, Blob, URL, document, setTimeout, window */
import { chromium, webkit } from "@playwright/test";
import process from "node:process";
import console from "node:console";
// A silent synthetic control, independent of app code, permissions and provider APIs.
// No microphone is opened. The graph's output gain stays zero throughout.
const results = [];
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  const outside = [];
  await page.route("**/*", (route) => {
    // WebKit routes local Blob reads too; these are the probe's own generated WAV.
    if (route.request().url().startsWith("blob:http://127.0.0.1:4199/")) return route.continue();
    if (route.request().url() === "http://127.0.0.1:4199/probe")
      return route.fulfill({
        contentType: "text/html",
        body: "<button>Run silent synthetic probe</button>",
      });
    outside.push(route.request().url());
    return route.abort();
  });
  try {
    await page.goto("http://127.0.0.1:4199/probe");
    await page.evaluate(() => {
      document.querySelector("button").onclick = async () => {
        const context = new AudioContext();
        const mute = context.createGain();
        mute.gain.value = 0;
        mute.connect(context.destination);
        await context.resume();
        const oscillator = context.createOscillator();
        const oscillatorAnalyser = context.createAnalyser();
        oscillator.connect(oscillatorAnalyser);
        oscillatorAnalyser.connect(mute);
        oscillator.start();
        const rate = 16000,
          length = rate * 3;
        const bytes = new ArrayBuffer(44 + length * 2),
          view = new DataView(bytes);
        const ascii = (offset, value) =>
          [...value].forEach((char, index) =>
            view.setUint8(offset + index, char.charCodeAt(0)),
          );
        ascii(0, "RIFF");
        view.setUint32(4, bytes.byteLength - 8, true);
        ascii(8, "WAVE");
        ascii(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, rate, true);
        view.setUint32(28, rate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        ascii(36, "data");
        view.setUint32(40, length * 2, true);
        for (let i = 0; i < length; i++)
          view.setInt16(
            44 + i * 2,
            Math.sin((i * 440 * Math.PI * 2) / rate) * 12000,
            true,
          );
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "audio/wav" }),
        );
        const audio = new Audio(url);
        const source = context.createMediaElementSource(audio),
          analyser = context.createAnalyser();
        source.connect(analyser);
        analyser.connect(mute);
        const samples = new Float32Array(analyser.fftSize);
        const rms = (node) => {
          node.getFloatTimeDomainData(samples);
          return Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length,
          );
        };
        const play = audio.play().then(
          () => "resolved",
          (error) => String(error),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        window.result = {
          context: context.state,
          contextTime: context.currentTime,
          mediaTime: audio.currentTime,
          paused: audio.paused,
          readyState: audio.readyState,
          oscillatorRms: rms(oscillatorAnalyser),
          mediaRms: rms(analyser),
          play: await Promise.race([play, Promise.resolve("pending")]),
        };
        audio.pause();
        oscillator.stop();
        await context.close();
        URL.revokeObjectURL(url);
      };
    });
    await page.getByRole("button").click();
    await page.waitForFunction(() => window.result, undefined, {
      timeout: 10000,
    });
    const result = await page.evaluate(() => window.result);
    results.push({
      engine: name,
      browser: browser.version(),
      result,
      outsideRequests: outside.length,
    });
    if (
      outside.length ||
      ![
        result.contextTime,
        result.mediaTime,
        result.oscillatorRms,
        result.mediaRms,
      ].every(Number.isFinite) ||
      result.context !== "running" ||
      result.paused ||
      result.readyState < 2 ||
      result.contextTime <= 0.2 ||
      result.mediaTime <= 0.2 ||
      result.oscillatorRms <= 0.1 ||
      result.mediaRms <= 0.1 ||
      result.play !== "resolved"
    )
      process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(results, null, 2));
