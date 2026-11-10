import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import {
  createMeeting,
  segment,
  validateMeeting,
  type Meeting,
} from "../../src/domain/model";
// A service-worker-controlled WebKit request can bypass page.route. Block workers
// in network-mock contexts so CI cannot accidentally make a live provider call.
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ context }) => {
  await context.route("https://**/*", (route) => route.abort());
});
const base = "/PWA-AI-Meeting-Memo-BYOK/";
async function create(page: Page, title = "ERP review") {
  await page
    .getByRole("button", { name: "New meeting", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill(title);
  await dialog.getByText("Start from a transcript instead").click();
  await dialog
    .getByLabel("Transcript", { exact: true })
    .fill(
      "Jamie: Review the current stock process.\nAlex: Finance needs to confirm the rule.",
    );
  await dialog
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

function longStructuredMeeting(): Meeting {
  const speakerIds = Array.from({ length: 5 }, () => crypto.randomUUID());
  const speakers = speakerIds.map((id, index) => ({
    id,
    name: `Long speaker ${index + 1}`,
    confirmed: false,
    sourceLabels: ["synthetic-long-transcript"],
  }));
  const segments = Array.from({ length: 360 }, (_, index) => {
    const speakerIndex = Math.floor(index / 20) % speakerIds.length;
    const marker =
      index === 0
        ? "FIRST_LONG_TRANSCRIPT_MARKER"
        : index === 359
          ? "LAST_LONG_TRANSCRIPT_MARKER"
          : `segment-${index}`;
    const text = `${marker} speaker-${speakerIndex + 1} ${"context for evidence ".repeat(
      4,
    )}segment-${index}`;
    const start = index % 41 === 0 ? null : index * 1.5;
    return segment(
      text,
      [speakerIds[speakerIndex]],
      start,
      start === null ? null : start + 1,
    );
  });
  return {
    ...createMeeting({
      title: "Long compact memo",
      languages: "English",
      attendees: speakers.map((speaker) => speaker.name),
    }),
    speakers,
    segments,
  };
}

function touchReviewMeeting(): Meeting {
  const speakerId = crypto.randomUUID();
  const source = segment("Touch source evidence.", [speakerId], 12, 14);
  const meeting = createMeeting({
    title: "Touch review source",
    date: "2026-11-05",
    timezone: "UTC",
    languages: "English",
    attendees: ["Touch speaker"],
  });
  const originalItem = {
    id: crypto.randomUUID(),
    type: "action" as const,
    text: "Original touch action.",
    ownerId: null,
    dueDate: "2026-11-20",
    dueOriginal: "by Friday",
    sources: [{ id: source.id, revision: source.revision }],
    review: "pending" as const,
  };
  return validateMeeting({
    ...meeting,
    synthetic: true,
    speakers: [
      {
        id: speakerId,
        name: "Touch speaker",
        confirmed: false,
        sourceLabels: ["synthetic-touch"],
      },
    ],
    segments: [source],
    memos: [
      {
        id: crypto.randomUUID(),
        createdAt: meeting.createdAt,
        sourceRevision: meeting.revision,
        model: "synthetic-touch",
        items: [originalItem],
        originalItems: [{ ...originalItem, sources: [...originalItem.sources] }],
      },
    ],
  });
}

test("memo submissions require confirmation, preserve evidence and mark source changes stale", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
      return;
    }
    requests++;
    const body = route.request().postDataJSON(),
      input = JSON.parse(body.input);
    expect(body.store).toBe(false);
    await route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    {
                      type: "action",
                      text: "Review inventory with finance.",
                      owner_speaker_id: null,
                      due_date: null,
                      due_original: null,
                      source_segment_ids: [input.segments[0].id],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto(base);
  await create(page);
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByLabel("action note")).toHaveValue(
    "Review inventory with finance.",
  );
  expect(requests).toBe(1);
  const accept = page.getByRole("button", { name: /Accept/ }).first();
  await page.getByLabel("action note").fill("Blur-only draft.");
  await accept.dispatchEvent("pointerdown", {
    bubbles: true,
    pointerId: 1,
    pointerType: "touch",
  });
  await accept.dispatchEvent("pointercancel", {
    bubbles: true,
    pointerId: 1,
    pointerType: "touch",
  });
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByLabel("action note")).toHaveValue("Blur-only draft.");
  await page.getByLabel("action note").fill("Pointer-leave draft.");
  await accept.dispatchEvent("pointerdown", {
    bubbles: true,
    pointerId: 2,
    pointerType: "touch",
  });
  // React synthesizes onPointerLeave from pointerout; a body target models leaving the button.
  const outside = await page
    .getByRole("tab", { name: /Transcript/ })
    .elementHandle();
  expect(outside).not.toBeNull();
  await accept.dispatchEvent("pointerout", {
    bubbles: true,
    pointerId: 2,
    pointerType: "touch",
    relatedTarget: outside!,
  });
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByLabel("action note")).toHaveValue(
    "Pointer-leave draft.",
  );
  await page.getByLabel("action note").fill("Human pointer review.");
  await accept.click();
  await expect(page.getByLabel("action note")).toHaveValue(
    "Human pointer review.",
  );
  await expect(accept).toHaveClass(/selected/);
  await expect(
    page.getByRole("alert").filter({ hasText: /another tab/i }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page
    .getByRole("button", { name: "Edit passage", exact: true })
    .first()
    .click();
  await page.getByLabel("Transcript text").fill("The source is corrected.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByText(/Source details changed/)).toBeVisible();
  await expect(page.getByLabel("action note")).toHaveValue(
    "Human pointer review.",
  );
  await page
    .getByRole("button", { name: "Passage 1 · r1", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Review the current stock process.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View current passage", exact: true })
    .click();
  await expect(
    page.getByText("The source is corrected.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByLabel("action note").fill("Human amended follow-up.");
  const keyboardAccept = page.getByRole("button", { name: /Accept/ }).first();
  await page.getByLabel("action note").focus();
  let keyboardAcceptFocused = false;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    if (
      await keyboardAccept.evaluate(
        (element) => element === document.activeElement,
      )
    ) {
      keyboardAcceptFocused = true;
      break;
    }
  }
  expect(keyboardAcceptFocused).toBe(true);
  await expect(keyboardAccept).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(keyboardAccept).toHaveClass(/selected/);
  await expect(page.getByText(/Source details changed/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Generate new version", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByLabel("action note")).toHaveValue(
    "Review inventory with finance.",
  );
  await expect(page.getByLabel("Memo version").locator("option")).toHaveCount(
    2,
  );
  await page.getByLabel("Memo version").selectOption({ index: 0 });
  await expect(page.getByLabel("action note")).toHaveValue(
    "Human amended follow-up.",
  );
  await page.getByText("Original generated item", { exact: true }).click();
  await expect(
    page
      .locator(".original-text")
      .getByText("Review inventory with finance.", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
});

test.describe("touch review persistence", () => {
  test.use({ hasTouch: true });

  test("touch Accept preserves edited text, due date, revision and original item", async ({
    page,
  }, info) => {
    const fixture = touchReviewMeeting();
    const originalItem = fixture.memos[0].originalItems![0];
    await page.goto(base);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator(".nav-file input").setInputFiles({
      name: "touch-review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await expect(
      page.getByRole("heading", {
        name: "Touch review source (restored)",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Meeting notes/ }).click();

    const note = page.getByLabel("action note");
    const due = page.getByLabel("Action due date");
    const accept = page.getByRole("button", { name: /Accept/ }).first();
    await expect(note).toHaveValue(originalItem.text);
    await expect(due).toHaveValue(originalItem.dueDate!);
    await note.fill("Touch human action.");
    await page.getByRole("tab", { name: /Transcript/ }).click();
    await page.getByRole("tab", { name: /Meeting notes/ }).click();
    await expect(note).toHaveValue("Touch human action.");
    await due.fill("2026-12-01");
    await expect(due).toHaveValue("2026-12-01");
    await expect(accept).toBeEnabled();
    await accept.scrollIntoViewIfNeeded();
    const box = await accept.boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
    );
    await expect(accept).toHaveClass(/selected/);
    await expect(note).toHaveValue("Touch human action.");
    await expect(due).toHaveValue("2026-12-01");
    await expect(
      page.getByRole("alert").filter({ hasText: /another tab/i }),
    ).toHaveCount(0);

    await page.reload();
    await page.getByRole("tab", { name: /Meeting notes/ }).click();
    await expect(page.getByLabel("action note")).toHaveValue(
      "Touch human action.",
    );
    await expect(page.getByLabel("Action due date")).toHaveValue(
      "2026-12-01",
    );
    await expect(
      page.getByRole("button", { name: /Accept/ }).first(),
    ).toHaveClass(/selected/);

    await page.getByText("Export", { exact: true }).click();
    const exported = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Meeting JSON (no audio)", exact: true })
      .click();
    const download = await exported;
    const exportedPath = info.outputPath("touch-review.json");
    await download.saveAs(exportedPath);
    const document = JSON.parse(await readFile(exportedPath, "utf8"));
    const exportedMemo = document.memos[0];
    expect(exportedMemo.originalItems).toEqual([originalItem]);
    expect(exportedMemo.items[0]).toMatchObject({
      id: originalItem.id,
      text: "Touch human action.",
      dueDate: "2026-12-01",
      review: "accepted",
      reviewedRevision: document.revision,
    });
  });
});

test("long speaker-aware memos compact transport input and restore original evidence", async ({
  page,
}, info) => {
  const fixture = longStructuredMeeting();
  const rawJson = JSON.stringify(fixture);
  expect(rawJson.length).toBeGreaterThan(120000);
  const first = fixture.segments[0];
  const last = fixture.segments.at(-1)!;
  let requests = 0;
  let capturedInput: {
    speakers: Array<{ id: string; name: string; confirmed: boolean }>;
    segments: Array<{
      id: string;
      text: string[];
      speakers: (number | string)[];
    }>;
  } | null = null;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
      return;
    }
    requests++;
    const body = route.request().postDataJSON() as {
      input: string;
      store: boolean;
    };
    expect(body.store).toBe(false);
    expect(body.input.length).toBeLessThanOrEqual(80000);
    expect(body.input).toContain("FIRST_LONG_TRANSCRIPT_MARKER");
    expect(body.input).toContain("LAST_LONG_TRANSCRIPT_MARKER");
    for (const speaker of fixture.speakers) {
      expect(body.input).toContain(speaker.id);
      expect(body.input).toContain(speaker.name);
    }
    const input = JSON.parse(body.input) as {
      speakers: Array<{ id: string; name: string; confirmed: boolean }>;
      segments: Array<{ id: string; text: string[]; speakers: (number | string)[] }>;
    };
    capturedInput = input;
    expect(input.speakers).toEqual(
      fixture.speakers.map(({ id, name, confirmed }) => ({
        id,
        name,
        confirmed,
      })),
    );
    expect(input.segments).toHaveLength(18);
    expect(input.segments[0].id).toBe("g0");
    expect(input.segments.at(-1)?.id).toBe("g17");
    expect(input.segments.every((group) => Array.isArray(group.text))).toBe(true);
    expect(input.segments.flatMap((group) => group.text)).toEqual(
      fixture.segments.map((source) => source.text),
    );
    for (const group of input.segments) {
      expect(group.speakers.every((speaker) => typeof speaker === "number")).toBe(true);
      const firstSource = fixture.segments.find(
        (source) => source.text === group.text[0],
      );
      expect(firstSource).toBeDefined();
      const speakerIndices = group.speakers as number[];
      expect(
        speakerIndices.map((index) => input.speakers[index]?.id),
      ).toEqual(firstSource!.speakerIds);
    }
    await route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    {
                      type: "summary",
                      text: "Long transcript summary with first and last evidence.",
                      owner_speaker_id: null,
                      due_date: null,
                      due_original: null,
                      source_segment_ids: [
                        input.segments[0].id,
                        input.segments.at(-1)!.id,
                      ],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "New meeting", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill(fixture.title);
  await dialog.getByText("Start from a transcript instead").click();
  await dialog.getByLabel("Transcript", { exact: true }).fill(rawJson);
  await dialog
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: fixture.title, exact: true }),
  ).toBeVisible();
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-long-memo-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByLabel("summary note")).toHaveValue(
    "Long transcript summary with first and last evidence.",
  );
  await expect(page.locator(".memo-item")).toContainText("pending");
  await expect(
    page.getByRole("button", { name: "Needs review", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
  expect(capturedInput).not.toBeNull();

  const tailSource = page
    .locator("button.source-link")
    .filter({ hasText: "Passage 360" });
  await expect(tailSource).toHaveCount(1);
  await tailSource.click();
  const evidence = page.getByRole("dialog");
  await expect(evidence.locator(".evidence-text")).toHaveText(last.text);
  const evidenceMetadata = evidence
    .locator("p.muted.small")
    .filter({ hasText: "08:58" });
  await expect(evidenceMetadata).toHaveCount(1);
  await expect(evidenceMetadata).toContainText("08:58");
  await expect(evidenceMetadata).toContainText("Long speaker 3");
  await evidence.getByRole("button", { name: "Close dialog" }).click();

  await page.getByText("Export", { exact: true }).click();
  const exported = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Meeting JSON (no audio)", exact: true })
    .click();
  const download = await exported;
  const exportedPath = info.outputPath("long-compact-memo.json");
  await download.saveAs(exportedPath);
  const document = JSON.parse(await readFile(exportedPath, "utf8"));
  expect(document.speakers).toEqual(fixture.speakers);
  expect(document.segments).toEqual(fixture.segments);
  expect(document.history).toEqual([]);
  expect(document.runs).toEqual([]);
  const memo = document.memos[0];
  expect(memo.originalItems).toEqual(memo.items);
  const sources = memo.items[0].sources;
  expect(sources[0]).toEqual({ id: first.id, revision: first.revision });
  expect(sources).toEqual([
    ...fixture.segments
      .slice(0, 20)
      .map(({ id, revision }) => ({ id, revision })),
    ...fixture.segments
      .slice(-20)
      .map(({ id, revision }) => ({ id, revision })),
  ]);
  const originalIds = new Set(fixture.segments.map((s) => s.id));
  expect(
    sources.every((source: { id: string }) => originalIds.has(source.id)),
  ).toBe(true);
  expect(
    sources.some((source: { id: string }) => source.id.startsWith("g")),
  ).toBe(false);
  expect(JSON.stringify(document)).not.toContain('"g0"');

  await page.reload();
  await expect(
    page.getByRole("heading", { name: fixture.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByLabel("summary note")).toHaveValue(
    "Long transcript summary with first and last evidence.",
  );
  expect(requests).toBe(1);
});

test("uncertain requests are recorded and never automatically resubmitted", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
      return;
    }
    calls++;
    return route.abort("connectionfailed");
  });
  await page.goto(base);
  await create(page);
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("may have been charged");
  await page.getByText("Processing history", { exact: false }).click();
  await expect(
    page.getByText("Memo · outcome unknown", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.waitForTimeout(400);
  expect(calls).toBe(1);
});

test("recording, transcript, reviewed memo, exports and full backup form one workflow", async ({
  page,
}, info) => {
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    const input = JSON.parse(route.request().postDataJSON().input);
    await route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    {
                      type: "summary",
                      text: "A greeting was exchanged.",
                      owner_speaker_id: null,
                      due_date: null,
                      due_original: null,
                      source_segment_ids: [input.segments[0].id],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    });
  });
  await page.route(
    "https://openrouter.ai/api/v1/audio/transcriptions",
    async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "authorization,content-type",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
          },
        });
        return;
      }
      expect(route.request().headers().authorization).toBe(
        "Bearer synthetic-router-only",
      );
      await route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: {
          duration: 1,
          words: [
            { word: "Hello", start: 0.1, end: 0.4, speaker: 0 },
            { word: "Yes", start: 0.5, end: 0.9, speaker: 1 },
          ],
        },
      });
    },
  );
  await page.goto(base);
  await create(page);
  const wav = Buffer.alloc(32044);
  wav.write("RIFF");
  wav.writeUInt32LE(32036, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({
    name: "synthetic-silence.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(
    page.getByText("synthetic-silence.wav", { exact: true }).first(),
  ).toBeVisible();
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenRouter API key", { exact: true })
    .fill("synthetic-router-only");
  await page.getByLabel("Transcription provider").selectOption("openrouter");
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit speakers", exact: true }).click();
  await expect(page.getByLabel("Name for speaker 1")).toHaveValue("Speaker 1");
  await page.locator(".speaker-queue-select").filter({ hasText: "Speaker 2" }).click();
  await expect(page.getByLabel("Name for speaker 2")).toHaveValue("Speaker 2");
  await expect(page.locator(".speaker-queue-item")).toHaveCount(2);
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(page.getByText("Hello", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByLabel("summary note")).toHaveValue(
    "A greeting was exchanged.",
  );
  await page.getByLabel("summary note").fill("Human reviewed greeting.");
  await page.getByRole("button", { name: "✓ Accept", exact: true }).click();
  for (const [label, extension] of [
    ["MD notes", "md"],
    ["TXT notes", "txt"],
    ["Meeting JSON (no audio)", "json"],
  ]) {
    await page.getByText("Export", { exact: true }).click();
    const exported = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const document = await exported,
      exportedPath = info.outputPath(`reviewed.${extension}`);
    await document.saveAs(exportedPath);
    await expect(page.locator(".export-menu")).toHaveJSProperty("open", false);
    const text = await readFile(exportedPath, "utf8");
    expect(text).toContain("Human reviewed greeting.");
    expect(text).toContain("accepted");
    expect(text).not.toContain("synthetic-test-only");
    expect(text).not.toContain("synthetic-router-only");
    if (extension === "json") {
      const document = JSON.parse(text);
      expect(document.audio.present).toBe(false);
      expect(document.memos[0].originalItems[0].text).toBe(
        "A greeting was exchanged.",
      );
      expect(document.memos[0].items[0].text).toBe("Human reviewed greeting.");
    }
  }
  await page.getByText("Export", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Full backup with audio" }).click();
  const file = await downloaded,
    path = info.outputPath("audio-backup.zip");
  await file.saveAs(path);
  const backupFiles = unzipSync(await readFile(path));
  const backupDocument = strFromU8(backupFiles["meeting.json"]);
  expect(backupDocument).not.toContain("synthetic-test-only");
  expect(backupDocument).not.toContain("synthetic-router-only");
  page.on("dialog", (d) => void d.accept());
  await page.locator(".nav-file input").setInputFiles(path);
  await expect(
    page.getByRole("heading", { name: "ERP review (restored)", exact: true }),
  ).toBeVisible();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(page.getByText("Hello", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByLabel("summary note")).toHaveValue(
    "Human reviewed greeting.",
  );
  await expect(
    page.getByRole("button", { name: "✓ Accept", exact: true }),
  ).toHaveClass(/selected/);
  await page.getByText("Original generated item", { exact: true }).click();
  await expect(
    page
      .locator(".original-text")
      .getByText("A greeting was exchanged.", { exact: true }),
  ).toBeVisible();
});

test("preserves zero-width speech evidence across reload without resubmitting", async ({
  page,
}) => {
  let speechRequests = 0;
  await page.route(
    "https://openrouter.ai/api/v1/audio/transcriptions",
    async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "authorization,content-type",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
          },
        });
        return;
      }
      speechRequests++;
      await route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: {
          duration: 1,
          words: [
            { word: "Before", start: 0.1, end: 0.4, speaker: 0 },
            { word: "Instant", start: 0.4, end: 0.4, speaker: 0 },
            { word: "After", start: 0.5, end: 0.9, speaker: 1 },
          ],
        },
      });
    },
  );
  await page.goto(base);
  await create(page, "Zero-width timing");
  const wav = Buffer.alloc(32044);
  wav.write("RIFF");
  wav.writeUInt32LE(32036, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({
    name: "synthetic-zero-width.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenRouter API key", { exact: true })
    .fill("synthetic-router-only");
  await page.getByLabel("Transcription provider").selectOption("openrouter");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  // Completion intentionally navigates to Speakers. Wait for that boundary
  // before selecting Transcript, rather than racing the final runJob callback.
  await expect(page.getByRole("tab", { name: /Speakers/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(page.getByText("Before", { exact: true })).toBeVisible();
  await expect(page.getByText("Instant", { exact: true })).toBeVisible();
  await expect(page.getByText("After", { exact: true })).toBeVisible();
  const timeLinks = page.locator("button.time-link");
  await expect(timeLinks).toHaveCount(3);
  await expect(timeLinks.nth(0)).toBeEnabled();
  await expect(timeLinks.nth(1)).toBeDisabled();
  await expect(timeLinks.nth(2)).toBeEnabled();
  expect(speechRequests).toBe(1);
  await page.reload();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(page.getByText("Instant", { exact: true })).toBeVisible();
  await expect(page.locator("button.time-link")).toHaveCount(3);
  await expect(page.locator("button.time-link").nth(1)).toBeDisabled();
  expect(speechRequests).toBe(1);
});

test("a foreground timeout remains uncertain and never resubmits on reload", async ({
  page,
}) => {
  let calls = 0;
  await page.clock.install();
  await page.route("https://api.openai.com/v1/responses", () => {
    calls++;
  });
  await page.goto(base);
  await create(page);
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect.poll(() => calls).toBe(1);
  await page.clock.fastForward(9 * 60 * 1000 + 1);
  await expect(page.getByRole("alert")).toContainText("may have been charged");
  await page.getByText("Processing history", { exact: false }).click();
  await expect(
    page.getByText("Memo · outcome unknown", { exact: true }),
  ).toBeVisible();
  await page.reload();
  expect(calls).toBe(1);
});

test("cancelling a submitted request records billing uncertainty", async ({
  page,
}) => {
  await page.route("https://api.openai.com/v1/responses", () => {});
  await page.goto(base);
  await create(page);
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("may have been charged");
  await page.getByText("Processing history", { exact: false }).click();
  await expect(
    page.getByText("Memo · outcome unknown", { exact: true }),
  ).toBeVisible();
});

test("a rejected HTTP request is failed with unconfirmed billing, not marked unsent", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    calls++;
    await route.fulfill({
      status: 401,
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {},
    });
  });
  await page.goto(base);
  await create(page);
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("HTTP 401");
  await page.getByText("Processing history", { exact: false }).click();
  await expect(page.getByText("Memo · failed", { exact: true })).toBeVisible();
  await expect(page.getByText(/possibly charged|可能已收费/)).toBeVisible();
  expect(calls).toBe(1);
});

test("a completed background request cannot replace a different meeting view", async ({
  page,
}) => {
  let release: () => void = () => {};
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    const input = JSON.parse(route.request().postDataJSON().input);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      json: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    {
                      type: "summary",
                      text: "Original meeting notes",
                      owner_speaker_id: null,
                      due_date: null,
                      due_original: null,
                      source_segment_ids: [input.segments[0].id],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto(base);
  await create(page, "Original meeting");
  const hash = new URL(page.url()).hash,
    id = hash.split("/").at(-1)!;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop waiting", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Your meetings/ }).click();
  await create(page, "Different meeting");
  release();
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          new Promise<string>((resolve) => {
            const open = indexedDB.open("meeting-memo-byok-v1");
            open.onsuccess = () => {
              const db = open.result,
                read = db
                  .transaction("meetings")
                  .objectStore("meetings")
                  .get(id);
              read.onsuccess = () => {
                resolve(read.result?.jobs.at(-1)?.state || "");
                db.close();
              };
            };
          }),
        id,
      ),
    )
    .toBe("completed");
  await expect(
    page.getByRole("heading", { name: "Different meeting", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).not.toBe(hash);
});

test("default OpenAI speech and selected OpenRouter memo use their own model and key", async ({
  page,
}) => {
  let speechCalls = 0,
    memoCalls = 0;
  await page.route(
    "https://api.openai.com/v1/audio/transcriptions",
    async (route) => {
      speechCalls++;
      expect(route.request().headers().authorization).toBe(
        "Bearer synthetic-openai-only",
      );
      expect(route.request().postData()).toContain("gpt-transcribe");
      await route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: { text: "A plain transcript." },
      });
    },
  );
  await page.route("https://openrouter.ai/api/v1/responses", async (route) => {
    memoCalls++;
    expect(route.request().headers().authorization).toBe(
      "Bearer synthetic-router-only",
    );
    const body = route.request().postDataJSON();
    expect(body.model).toBe("openai/gpt-6-luna");
    expect(body.provider.allow_fallbacks).toBe(false);
    const input = JSON.parse(body.input);
    await route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    {
                      type: "summary",
                      text: "A summary.",
                      owner_speaker_id: null,
                      due_date: null,
                      due_original: null,
                      source_segment_ids: [input.segments[0].id],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto(base);
  await create(page);
  const wav = Buffer.alloc(32044);
  wav.write("RIFF");
  wav.writeUInt32LE(32036, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  await page
    .getByLabel("Attach audio", { exact: true })
    .setInputFiles({ name: "test.wav", mimeType: "audio/wav", buffer: wav });
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await expect(page.getByLabel("Transcription provider")).toHaveValue(
    "openrouter",
  );
  await expect(page.getByLabel("Memo provider")).toHaveValue("openai");
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-openai-only");
  await page
    .getByLabel("OpenRouter API key", { exact: true })
    .fill("synthetic-router-only");
  await page.getByLabel("Memo provider").selectOption("openrouter");
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  expect(speechCalls + memoCalls).toBe(0);
  await page.reload();
  await expect(
    page.getByLabel("OpenRouter API key", { exact: true }),
  ).toHaveValue("synthetic-router-only");
  await expect(page.getByLabel("Memo provider")).toHaveValue("openrouter");
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("api.openai.com");
  await expect(page.getByRole("dialog")).toContainText("gpt-transcribe");
  expect(speechCalls).toBe(0);
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(
    page.getByText("A plain transcript.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("OpenRouter");
  await expect(page.getByRole("dialog")).toContainText("openai/gpt-6-luna");
  expect(memoCalls).toBe(0);
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByLabel("summary note")).toHaveValue("A summary.");
  expect(speechCalls).toBe(1);
  expect(memoCalls).toBe(1);
});

test("processing indicator stays bounded on desktop and mobile and supports reduced motion", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://api.openai.com/v1/audio/transcriptions", () => {
    requests++;
  });
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(base);
  await create(page);
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({
    name: "test.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("synthetic audio"),
  });
  await expect(page.getByText("test.wav", { exact: true }).first()).toBeVisible();
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect.poll(() => requests).toBe(1);
  const card = page.getByRole("region", { name: "Processing request" });
  const indicator = card.locator(".processing-indicator");
  await expect(card.getByRole("status")).toContainText(
    "Processing your request",
  );
  await expect(card.getByRole("status")).toContainText("Keep this page open");
  await expect(
    page.getByText("Request submitted. Keep this page open."),
  ).toHaveCount(0);
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const indicatorBox = await indicator.boundingBox(),
      cardBox = await card.boundingBox();
    expect(indicatorBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(indicatorBox!.width).toBeLessThanOrEqual(44);
    expect(indicatorBox!.height).toBeLessThanOrEqual(44);
    expect(indicatorBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
    expect(indicatorBox!.x + indicatorBox!.width).toBeLessThanOrEqual(
      cardBox!.x + cardBox!.width,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      card.getByRole("button", { name: "Stop waiting" }),
    ).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(indicator.locator("svg")).toHaveCSS("animation-name", "none");
  await card.getByRole("button", { name: "Stop waiting" }).click();
  await expect(page.getByRole("alert")).toContainText("may have been charged");
  expect(requests).toBe(1);
});

test("safe error guidance explains a provider duration rejection without exposing response data", async ({
  page,
}) => {
  let calls = 0;
  await page.route(
    "https://api.openai.com/v1/audio/transcriptions",
    async (route) => {
      calls++;
      await route.fulfill({
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        json: {
          error: {
            message:
              "audio duration 1830 seconds is longer than 1400 seconds; private-provider-detail",
            code: "invalid_value",
            param: null,
          },
        },
      });
    },
  );
  await page.goto(base);
  await create(page);
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({
    name: "test.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("synthetic audio"),
  });
  await expect(page.getByText("test.wav", { exact: true }).first()).toBeVisible();
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page
    .getByLabel("Transcription model ID")
    .fill("gpt-4o-transcribe-diarize");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "duration or length limit",
  );
  await expect(page.getByRole("alert")).not.toContainText(
    "private-provider-detail",
  );
  await page.getByText("Processing history", { exact: false }).click();
  await expect(page.getByText(/possibly charged|可能已收费/)).toBeVisible();
  await page.reload();
  await page.getByText("Processing history", { exact: false }).click();
  await expect(page.getByText(/duration or length limit/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "private-provider-detail",
  );
  expect(calls).toBe(1);
});

test("long OpenAI diarization shows an advisory before a paid submission", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 1500,
    });
  });
  let calls = 0;
  await page.route("https://api.openai.com/v1/audio/transcriptions", () => {
    calls++;
  });
  await page.goto(base);
  await create(page);
  const wav = Buffer.alloc(32044);
  wav.write("RIFF");
  wav.writeUInt32LE(32036, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  await page
    .getByLabel("Attach audio", { exact: true })
    .setInputFiles({ name: "test.wav", mimeType: "audio/wav", buffer: wav });
  await expect(page.getByText("test.wav", { exact: true }).first()).toBeVisible();
  const player = page.locator("audio");
  await expect(player).toBeAttached();
  // WebKit may not decode this minimal synthetic WAV; dispatch the stubbed metadata event for the advisory test.
  await player.evaluate((element) =>
    element.dispatchEvent(new Event("loadedmetadata")),
  );
  await expect(page.locator(".recording-info")).toContainText("25:00");
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page
    .getByLabel("Transcription model ID")
    .fill("gpt-4o-transcribe-diarize");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await expect(page.locator(".recording-info")).toContainText("25:00");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Some users have reported duration limits",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm and send" }),
  ).toBeEnabled();
  expect(calls).toBe(0);
});
