import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";

const base = "/PWA-AI-Meeting-Memo-BYOK/";

test.use({ deviceScaleFactor: 2, serviceWorkers: "block" });

function syntheticBackup(): Buffer {
  const audio = Buffer.alloc(44 + 16_000 * 10);
  audio.write("RIFF");
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16_000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);

  const speakerId = crypto.randomUUID();
  const segmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    type: "summary",
    text: "Review the inventory process with finance and document the confirmed result. ".repeat(8),
    ownerId: null,
    dueDate: null,
    dueOriginal: null,
    sources: [{ id: segmentId, revision: 1 }],
    review: "pending",
    reviewedRevision: null,
  };
  const meeting = {
    schemaVersion: 1,
    version: 0,
    id: crypto.randomUUID(),
    title: "Inventory process review",
    date: "2026-11-06",
    timezone: "Asia/Singapore",
    languages: "English",
    attendees: [],
    glossary: "",
    kind: "general",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    synthetic: true,
    speakers: [
      {
        id: speakerId,
        name: "Speaker 1",
        confirmed: false,
        sourceLabels: ["synthetic"],
      },
    ],
    segments: [
      {
        id: segmentId,
        revision: 1,
        start: 0,
        end: 3,
        speakerIds: [speakerId],
        originalText: "Review inventory with finance.",
        text: "Review inventory with finance.",
        reviewed: false,
        parents: [],
      },
    ],
    history: [],
    undo: [],
    memos: [
      {
        id: crypto.randomUUID(),
        createdAt: now,
        sourceRevision: 1,
        model: "synthetic-fixture",
        items: [item],
        originalItems: [structuredClone(item)],
      },
    ],
    jobs: [],
    audio: {
      name: "Inventory-review.wav",
      type: "audio/wav",
      size: audio.length,
      duration: 10,
      hash: createHash("sha256").update(audio).digest("hex"),
      present: true,
    },
    runs: [],
  };

  return Buffer.from(
    zipSync({
      "meeting.json": strToU8(JSON.stringify(meeting)),
      "recording.bin": audio,
    }),
  );
}

async function restoreMeeting(page: Page, language: "en" | "zh-CN") {
  // Windows WebKit cannot decode this synthetic WAV consistently. Keep this
  // layout fixture independent of codec support; product media errors remain
  // handled by the application outside this fixture.
  await page.addInitScript(() => {
    // The layout fixture represents the normal registered/no-update state;
    // PWA lifecycle behavior is covered by the dedicated PWA tests.
    const registration = {
      waiting: null,
      installing: null,
      addEventListener() {},
      update: async () => {},
    };
    if (navigator.serviceWorker) {
      Object.defineProperty(navigator.serviceWorker, "register", {
        configurable: true,
        value: async () => registration,
      });
    }
    document.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopPropagation();
      },
      true,
    );
  });
  await page.goto(base);
  if (language === "zh-CN") {
    await page.goto(`${base}#/settings`);
    await page.getByLabel("Display language / 显示语言").selectOption(language);
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
  }
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".nav-file input").setInputFiles({
    name: "synthetic-ui.zip",
    mimeType: "application/zip",
    buffer: syntheticBackup(),
  });
  await page.locator(".meeting-heading").waitFor();
  await page
    .getByRole("tab", { name: language === "en" ? /Meeting notes/ : /会议笔记/ })
    .click();
  await page.locator(".memo-list textarea").first().waitFor();
}

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right }
        : null;
    };
    const memo = box(".memo-list textarea");
    const player = box(".audio-player");
    const importantRegions = [
      ".meeting-heading",
      ".workspace-toolbar",
      ".workspace-tabs",
      ".workspace-panel",
    ]
      .map(box)
      .filter((value): value is NonNullable<typeof value> => value !== null);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      memo,
      player,
      visibleMemo:
        memo && player
          ? Math.max(0, Math.min(innerHeight, player.y) - memo.y)
          : 0,
      documentWidth: document.documentElement.scrollWidth,
      regionsFit: importantRegions.every((region) => region.right <= innerWidth + 1),
    };
  });
}

async function expectWorkspaceActions(page: Page, language: "en" | "zh-CN") {
  const labels =
    language === "en"
      ? {
          edit: "Edit meeting details",
          remove: "Delete meeting",
          recording: "Recording details",
          transcribe: "Transcribe",
          generate: "Generate new version",
        }
      : {
          edit: "编辑会议资料",
          remove: "删除会议",
          recording: "录音详情",
          transcribe: "转录",
          generate: "生成新版本",
        };
  await expect(page.getByRole("button", { name: labels.edit, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: labels.remove, exact: true })).toBeVisible();
  await expect(page.getByText(language === "en" ? "Export" : "导出", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: labels.recording, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: labels.transcribe, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: labels.generate, exact: true })).toBeVisible();

  for (const button of [
    page.getByRole("button", { name: labels.edit, exact: true }),
    page.getByRole("button", { name: labels.remove, exact: true }),
    page.getByRole("button", { name: labels.transcribe, exact: true }),
    page.getByRole("button", { name: labels.generate, exact: true }),
  ]) {
    const size = await button.boundingBox();
    expect(size?.height, `${labels.transcribe} touch target`).toBeGreaterThanOrEqual(44);
  }
}

for (const language of ["en", "zh-CN"] as const) {
  test(`mobile memo review keeps ${language} context and first text visible`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await restoreMeeting(page, language);
    const metrics = await layoutMetrics(page);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport.width + 1);
    expect(metrics.regionsFit).toBe(true);
    expect(metrics.visibleMemo).toBeGreaterThanOrEqual(24);
    expect(metrics.memo?.y).toBeLessThan(metrics.player?.y ?? 0);
    await expectWorkspaceActions(page, language);

    await page.setViewportSize({ width: 320, height: 844 });
    const narrowMetrics = await layoutMetrics(page);
    expect(narrowMetrics.documentWidth).toBeLessThanOrEqual(narrowMetrics.viewport.width + 1);
    expect(narrowMetrics.regionsFit).toBe(true);
    await expectWorkspaceActions(page, language);
  });
}

test("200% viewport reflow keeps the workspace inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await restoreMeeting(page, "en");
  const metrics = await layoutMetrics(page);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.regionsFit).toBe(true);
  await expectWorkspaceActions(page, "en");
});
