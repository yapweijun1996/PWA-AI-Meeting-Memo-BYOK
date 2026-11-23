import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createMeeting, type Meeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });
const uuid = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
function fixture(): Meeting {
  const meeting = createMeeting({
    title: "20,000 fragment synthetic playback",
  });
  meeting.synthetic = true;
  meeting.speakers = Array.from({ length: 100 }, (_, index) => ({
    id: uuid("20000000", index),
    name: `Label ${String(index + 1).padStart(3, "0")}`,
    confirmed: index === 0,
    sourceLabels: [`synthetic-${index + 1}`],
  }));
  meeting.segments = Array.from({ length: 20000 }, (_, index) => {
    const start =
      index <= 100 ? 0 : index === 101 ? 10 : 20 + (index - 102) * 0.25;
    const text =
      index === 101
        ? `LONG-PASSAGE-START ${"inventory ERP 中文 conditions. ".repeat(600)} END-LONG-SOURCE`
        : `Perf passage ${index + 1}: preserve original quantities and uncertain conditions.`;
    return {
      id: uuid("10000000", index),
      revision: 1,
      start,
      end: index <= 100 ? 10 : index === 101 ? 20 : start + 0.2,
      speakerIds: index === 100 ? [] : [meeting.speakers[index % 100].id],
      text,
      originalText: text,
      reviewed: false,
      parents: [],
    };
  });
  return meeting;
}
function wav() {
  const buffer = Buffer.alloc(44 + 32000);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}
async function sourceDigest(page: Page) {
  return page.evaluate(async () => {
    const source = await new Promise<{
      segments: unknown[];
      speakers: unknown[];
      jobs: unknown[];
    }>((resolve) => {
      const open = indexedDB.open("meeting-memo-byok-v1");
      open.onsuccess = () => {
        const database = open.result;
        const request = database
          .transaction("meetings")
          .objectStore("meetings")
          .getAll();
        request.onsuccess = () => {
          resolve(request.result[0]);
          database.close();
        };
      };
    });
    const bytes = new TextEncoder().encode(
      JSON.stringify({ segments: source.segments, speakers: source.speakers }),
    );
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      segments: source.segments.length,
      speakers: source.speakers.length,
      jobs: source.jobs.length,
      hash,
    };
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, font: "normal" },
  { name: "tablet", width: 768, height: 1024, font: "normal" },
  { name: "portrait", width: 390, height: 844, font: "xxlarge" },
  { name: "landscape", width: 844, height: 390, font: "xxlarge" },
])
  test(`long playback projection and bounded evidence on ${viewport.name}`, async ({
    page,
    context,
    browser,
    browserName,
  }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    const unexpected: string[] = [];
    await context.route("https://**/*", (route) => {
      unexpected.push(route.request().url());
      return route.abort();
    });
    await page.addInitScript((size) => {
      localStorage.setItem("meeting-memo:font-size", size);
      window.confirm = () => true;
      HTMLElement.prototype.requestFullscreen = () =>
        Promise.reject(new Error("Synthetic in-page playback"));
      for (const type of [
        "error",
        "playing",
        "canplay",
        "waiting",
        "pause",
        "ended",
      ])
        document.addEventListener(
          type,
          (event) => {
            if (event.isTrusted && event.target instanceof HTMLMediaElement)
              event.stopImmediatePropagation();
          },
          true,
        );
      Object.defineProperty(HTMLMediaElement.prototype, "error", {
        configurable: true,
        get: () => null,
      });
      HTMLMediaElement.prototype.play = function () {
        Object.defineProperty(this, "paused", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(this, "ended", {
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
    }, viewport.font);
    await page.goto("./");
    const meeting = fixture();
    await page
      .getByLabel("Restore backup", { exact: true })
      .setInputFiles({
        name: "synthetic-performance.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(meeting)),
      });
    await expect(
      page.getByRole("heading", {
        name: `${meeting.title} (restored)`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByLabel("Attach audio", { exact: true })
      .setInputFiles({
        name: "synthetic-performance.wav",
        mimeType: "audio/wav",
        buffer: wav(),
      });
    await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
    await page.locator("audio").evaluate((element, duration) => {
      let position = 0;
      Object.defineProperty(element, "currentTime", {
        configurable: true,
        get: () => position,
        set: (value) => {
          position = value;
        },
      });
      Object.defineProperty(element, "duration", {
        configurable: true,
        value: duration,
      });
      element.dispatchEvent(new Event("loadedmetadata"));
    }, meeting.segments.at(-1)!.end!);
    const before = await sourceDigest(page);
    expect(before.segments).toBe(20000);
    expect(before.speakers).toBe(100);
    expect(before.jobs).toBe(0);
    await page.getByRole("tab", { name: /^Speakers/ }).click();
    await page
      .getByRole("button", { name: "Playback mode", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Immersive playback", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Immersive playback", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Immersive playback" });
    if (viewport.font === "xxlarge")
      await dialog
        .getByLabel("Caption size", { exact: true })
        .selectOption("xlarge");
    await dialog.getByRole("button", { name: "Reading", exact: true }).click();
    const samples = [];
    for (const position of [
      0.1, 5, 15, 20.3, 200.1, 400.1, 1000.1, 2000.1, 3000.1, 4000.1, 4990.1,
    ]) {
      const sample = await page.evaluate(async (position) => {
        const audio = document.querySelector("audio")!;
        const started = performance.now();
        audio.currentTime = position;
        audio.dispatchEvent(new Event("seeked"));
        const dispatchMs = performance.now() - started;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const surface = document.querySelector<HTMLElement>(
          '.immersive[role="dialog"]',
        )!;
        return {
          position,
          dispatchMs,
          secondFrameMs: performance.now() - started,
          transcriptRows: surface.querySelectorAll("[data-immersive-caption]")
            .length,
          currentCaptions: surface.querySelectorAll(
            ".immersive-caption-content > p",
          ).length,
          currentLabels: surface.querySelectorAll(".immersive-current-speaker")
            .length,
          domElements: surface.querySelectorAll("*").length,
        };
      }, position);
      expect(sample.transcriptRows).toBeLessThanOrEqual(40);
      expect(sample.transcriptRows).toBeGreaterThan(0);
      samples.push(sample);
      if (position === 5) {
        expect(sample.currentCaptions).toBe(101);
        expect(sample.currentLabels).toBe(101);
      }
    }
    await dialog
      .getByRole("button", { name: "Close transcript", exact: true })
      .click();
    await page.locator("audio").evaluate((element) => {
      (element as HTMLMediaElement).currentTime = 15;
      element.dispatchEvent(new Event("seeked"));
    });
    const captions = dialog.getByRole("region", {
      name: "Captions",
      exact: true,
    });
    await expect(captions).toContainText("LONG-PASSAGE-START");
    await expect(captions).toContainText("END-LONG-SOURCE");
    expect(
      await captions.evaluate((element) => element.clientHeight),
    ).toBeGreaterThan(0);
    const scrollOwners: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      range: number;
      owners: { className: string; scrollTop: number; range: number }[];
    }[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const geometry = await captions.evaluate((element) => {
        const box = element.getBoundingClientRect();
        let top = Math.max(box.top, 0),
          bottom = Math.min(box.bottom, innerHeight),
          left = Math.max(box.left, 0),
          right = Math.min(box.right, innerWidth);
        const owners = [];
        let range = 0;
        for (
          let owner: Element | null = element;
          owner;
          owner = owner.parentElement
        ) {
          const style = getComputedStyle(owner),
            bounds = owner.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            top = Math.max(top, bounds.top);
            bottom = Math.min(bottom, bounds.bottom);
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            left = Math.max(left, bounds.left);
            right = Math.min(right, bounds.right);
          }
          if (/auto|scroll/.test(style.overflowY)) {
            range += owner.scrollHeight - owner.clientHeight;
            owners.push({
              className: owner.className,
              scrollTop: owner.scrollTop,
              range: owner.scrollHeight - owner.clientHeight,
            });
          }
          if (owner.classList.contains("immersive")) break;
        }
        return { top, bottom, left, right, range, owners };
      });
      scrollOwners.push(geometry);
      if (
        geometry.bottom > geometry.top + 4 &&
        geometry.right > geometry.left + 4
      ) {
        await page.mouse.move(
          (geometry.left + geometry.right) / 2,
          (geometry.top + geometry.bottom) / 2,
        );
        await page.mouse.wheel(0, geometry.range + 100);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
      }
    }
    await expect(captions).toBeInViewport();
    const measureLongText = () => captions.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let last: Text | undefined;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.data.includes("END-LONG-SOURCE")) last = node;
      }
      const range = document.createRange();
      range.setStart(last!, last!.data.indexOf("END-LONG-SOURCE"));
      range.setEnd(last!, last!.data.length);
      const tail = range.getBoundingClientRect(),
        box = element.getBoundingClientRect(),
        stage = element.closest(".immersive-stage")!.getBoundingClientRect();
      let clipTop = 0,
        clipBottom = innerHeight;
      for (
        let owner: Element | null = element;
        owner;
        owner = owner.parentElement
      ) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(owner).overflowY)) {
          const bounds = owner.getBoundingClientRect();
          clipTop = Math.max(clipTop, bounds.top);
          clipBottom = Math.min(clipBottom, bounds.bottom);
        }
        if (owner.classList.contains("immersive")) break;
      }
      return {
        characters: element.textContent?.length ?? 0,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        marginTop: getComputedStyle(element).marginTop,
        fontPixels: getComputedStyle(element).fontSize,
        maxHeight: getComputedStyle(element).maxHeight,
        tailBottom: tail.bottom,
        clipTop,
        clipBottom,
        boxBottom: box.bottom,
        stageBottom: stage.bottom,
        parentBottom: element.parentElement!.getBoundingClientRect().bottom,
        tailVisible: tail.top >= clipTop - 1 && tail.bottom <= clipBottom + 1,
      };
    });
    let longText = await measureLongText();
    // WebKit may continue its native wheel animation after the two observed frames.
    await expect(async () => {
      longText = await measureLongText();
      await writeFile(
        info.outputPath("long-text-observation.json"),
        JSON.stringify({ longText, scrollOwners }, null, 2),
      );
      expect(longText.tailVisible).toBe(true);
      expect(longText.characters).toBeGreaterThan(15000);
    }).toPass({ timeout: 2000 });
    await expect(
      dialog.getByRole("button", { name: "Exit immersive", exact: true }),
    ).toBeInViewport();
    await dialog.getByRole("button", { name: "Reading", exact: true }).click();
    await dialog
      .getByLabel("Search transcript", { exact: true })
      .fill("Perf passage 20000:");
    await expect(dialog.locator("[data-immersive-caption]")).toHaveCount(1);
    await expect(dialog.locator("[data-immersive-caption]")).toHaveAttribute(
      "data-immersive-caption",
      meeting.segments.at(-1)!.id,
    );
    await dialog.locator("[data-immersive-caption]").click();
    expect(
      await page
        .locator("audio")
        .evaluate((element) => (element as HTMLMediaElement).currentTime),
    ).toBe(meeting.segments.at(-1)!.start);
    const layout = await dialog.evaluate((element) => {
      const footer = element.querySelector("footer")!.getBoundingClientRect();
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const insets = [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ];
      probe.remove();
      return {
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        footerBottom: footer.bottom,
        viewportHeight: innerHeight,
        observedSafeAreaInsets: insets,
        fontSize: document.documentElement.dataset.fontSize,
      };
    });
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.fontSize).toBe(viewport.font);
    expect(await sourceDigest(page)).toEqual(before);
    expect(unexpected).toEqual([]);
    const report = {
      format: "meeting-memo-browser-playback-benchmark",
      version: 1,
      engine: browserName,
      browserVersion: browser.version(),
      viewport,
      segments: 20000,
      labels: 100,
      samples,
      longText,
      scrollOwners,
      layout,
      scope:
        "Synthetic seek dispatch and second animation frame, with controlled media state. Excludes native decoding/audio output, physical rotation/safe areas, phones, screen readers and provider quality.",
    };
    await writeFile(
      info.outputPath("playback-performance.json"),
      JSON.stringify(report, null, 2),
    );
    await page.screenshot({ path: info.outputPath("long-playback.png") });
  });
