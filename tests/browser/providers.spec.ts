import { test, expect, type Page } from "@playwright/test";
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
  await page.getByRole("button", { name: "Save session keys" }).click();
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
  await page.getByRole("button", { name: "✓ Accept", exact: true }).click();
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
    "Review inventory with finance.",
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
  await page.getByRole("button", { name: "✓ Accept", exact: true }).click();
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
  expect(requests).toBe(2);
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
  await page.getByRole("button", { name: "Save session keys" }).click();
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

test("audio upload, diarization normalization and full-audio backup work through the browser", async ({
  page,
}, info) => {
  await page.route("https://api.deepgram.com/v1/listen?**", async (route) => {
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
      "Token synthetic-deepgram-only",
    );
    await route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        metadata: { duration: 1, request_id: "synthetic-request" },
        results: {
          channels: [
            {
              alternatives: [
                {
                  words: [
                    { word: "Hello", start: 0.1, end: 0.4, speaker: 0 },
                    { word: "Yes", start: 0.5, end: 0.9, speaker: 1 },
                  ],
                },
              ],
            },
          ],
        },
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
    .getByLabel("Deepgram API key", { exact: true })
    .fill("synthetic-deepgram-only");
  await page.getByRole("button", { name: "Save session keys" }).click();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByLabel("Name for speaker 1")).toHaveValue("Speaker 1");
  await expect(page.getByLabel("Name for speaker 2")).toHaveValue("Speaker 2");
  await expect(page.getByText("Needs a name", { exact: true })).toHaveCount(2);
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(page.getByText("Hello", { exact: true })).toBeVisible();
  await page.getByText("Export", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Full backup with audio" }).click();
  const file = await downloaded,
    path = info.outputPath("audio-backup.zip");
  await file.saveAs(path);
  page.on("dialog", (d) => void d.accept());
  await page.locator(".nav-file input").setInputFiles(path);
  await expect(
    page.getByRole("heading", { name: "ERP review (restored)", exact: true }),
  ).toBeVisible();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByText("Hello", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Save session keys" }).click();
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
  await page.getByRole("button", { name: "Save session keys" }).click();
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
