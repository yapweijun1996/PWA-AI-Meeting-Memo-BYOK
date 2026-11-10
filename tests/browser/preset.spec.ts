import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("recommended preset starts without a request and leaves saved custom settings intact", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://**/*", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/#/settings");
  await expect(page.getByLabel("Transcription provider")).toHaveValue(
    "openrouter",
  );
  await expect(page.getByLabel("Transcription model ID")).toHaveValue(
    "elevenlabs/scribe-v2",
  );
  await expect(page.getByLabel("Memo model ID")).toHaveValue("gpt-6-luna");
  await page.getByLabel("Transcription provider").selectOption("openai");
  await page.getByLabel("Transcription model ID").fill("custom-model");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Transcription model ID")).toHaveValue(
    "custom-model",
  );
  await page.getByRole("button", { name: "Use recommended preset" }).click();
  await expect(page.getByLabel("Transcription model ID")).toHaveValue(
    "elevenlabs/scribe-v2",
  );
  await page.getByLabel("Speech rate · USD per minute").fill("0.12");
  await page
    .getByLabel("Pricing source URL")
    .fill("https://example.com/pricing");
  await page.getByLabel("Date checked").fill("2026-11-05");
  await page
    .getByRole("button", { name: "Bind rate to selected speech model" })
    .click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("tab", { name: "API 与模型" }).click();
  await expect(page.getByRole("heading", { name: "费用估算" })).toBeVisible();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(
    page.getByRole("button", { name: "已保存在此设备" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "费用估算" })).toBeVisible();
  await expect(page.getByLabel("定价来源网址")).toHaveValue(
    "https://example.com/pricing",
  );
  await expect(
    page.getByText("费率适用模型 openrouter / elevenlabs/scribe-v2"),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("link", { name: /您的会议/ }).click();
  await page
    .getByRole("button", { name: "新建会议", exact: true })
    .last()
    .click();
  const meeting = page.getByRole("dialog", { name: "创建新会议" });
  await meeting.getByLabel("会议标题").fill("Existing content 123");
  await meeting.getByText("使用已有转录").click();
  await meeting
    .getByLabel("转录", { exact: true })
    .fill("Existing transcript 123");
  await meeting.getByRole("button", { name: "创建会议" }).click();
  await expect(
    page.getByRole("heading", { name: "Existing content 123", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Existing transcript 123", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /转录/ })).toBeVisible();
  await page.getByRole("button", { name: "编辑段落" }).click();
  await expect(
    page.getByRole("dialog", { name: "编辑此段落" }).getByLabel("转录文字"),
  ).toHaveValue("Existing transcript 123");
  await page.getByRole("button", { name: "保存更正" }).click();
  await expect(page.getByRole("dialog", { name: "编辑此段落" })).toHaveCount(0);
  await expect(
    page
      .getByRole("article")
      .getByText("Existing transcript 123", { exact: true }),
  ).toBeVisible();
  const meetingHash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "设置与 API 密钥" }).click();
  await page.getByRole("tab", { name: "外观" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("en");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate((hash) => {
    location.hash = hash;
  }, meetingHash);
  await expect(
    page.getByText("Existing transcript 123", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(0);
});

test("records reported speech cost separately from the dated pre-send estimate", async ({
  page,
}) => {
  // This test covers the estimate contract using duration supplied by media metadata;
  // normalize the browser event so codec support does not decide the billing assertion.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 1,
    });
  });
  await page.route("https://**/*", (route) => route.abort());
  await page.route(
    "https://openrouter.ai/api/v1/audio/transcriptions",
    (route) =>
      route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: {
          text: "Synthetic speech",
          usage: { seconds: 1, cost: 0, input_tokens: 0 },
        },
      }),
  );
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/#/settings");
  await page
    .getByLabel("OpenRouter API key", { exact: true })
    .fill("synthetic");
  await page.getByLabel("Speech rate · USD per minute").fill("0.12");
  await page
    .getByLabel("Pricing source URL")
    .fill("https://example.com/pricing");
  await page.getByLabel("Date checked").fill("2026-11-05");
  await page
    .getByRole("button", { name: "Bind rate to selected speech model" })
    .click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
  await page
    .getByRole("button", { name: "New meeting", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Cost test");
  await dialog.getByText("Start from a transcript instead").click();
  await dialog.getByLabel("Transcript", { exact: true }).fill("Synthetic text");
  await dialog
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Cost test", exact: true }),
  ).toBeVisible();
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
  const recordingInfo = page.locator(".recording-info");
  await expect(
    recordingInfo.getByText("test.wav", { exact: true }),
  ).toBeVisible();
  await page.locator("audio").dispatchEvent("loadedmetadata");
  await expect(recordingInfo).toContainText("00:01");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("About US$0.002");
  await expect(page.getByRole("dialog")).toContainText("2026-11-05");
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(
    page.getByText("Synthetic speech", { exact: true }),
  ).toBeVisible();
  await page.getByText("Processing history").click();
  await expect(
    page.getByText(/Provider-reported charge: US\$0.000000/),
  ).toBeVisible();
  await expect(page.getByText(/Estimate:.*US\$0.002/)).toBeVisible();
  await page.reload();
  await page.getByText("Processing history").click();
  await expect(
    page.getByText(/Provider-reported charge: US\$0.000000/),
  ).toBeVisible();
});
