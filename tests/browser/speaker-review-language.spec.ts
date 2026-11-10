import { expect, test } from "@playwright/test";
import { createMeeting, segment } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });

const base = "/PWA-AI-Meeting-Memo-BYOK/";

test("Chinese speaker review preserves anonymous identities and validates video links", async ({ page }) => {
  await page.goto(`${base}#/settings`);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await page.goto(base);
  await page.getByRole("button", { name: "新建会议", exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: "创建新会议" });
  await dialog.getByLabel("会议标题", { exact: true }).fill("中文说话人界面");
  await dialog.getByText("使用已有转录", { exact: true }).click();
  const firstId = crypto.randomUUID(), secondId = crypto.randomUUID();
  const fixture = { ...createMeeting(),
    speakers: [
      { id: firstId, name: "甲", confirmed: false, sourceLabels: ["fixture"] },
      { id: secondId, name: "乙", confirmed: false, sourceLabels: ["fixture"] },
    ],
    segments: [segment("我们先确认库存流程。", [firstId], 0.1, 0.4), segment("好的，我会核对第二步。", [secondId], 0.4, 0.8)],
  };
  await dialog
    .getByLabel("转录", { exact: true })
    .fill(JSON.stringify(fixture));
  await dialog.getByRole("button", { name: "创建会议", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "中文说话人界面", exact: true })).toBeVisible();
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  page.once("dialog", (confirmation) => void confirmation.accept());
  await page.getByLabel("附加录音", { exact: true }).setInputFiles({ name: "fixture.wav", mimeType: "audio/wav", buffer: wav });
  await expect(page.locator(".recording-info")).toContainText("fixture.wav");

  await page.getByRole("tab", { name: /说话人/ }).click();
  await page.getByRole("button", { name: "编辑说话人", exact: true }).click();
  await expect(page.getByLabel("样本长度", { exact: true })).toBeVisible();
  await expect(page.getByLabel("第 1 位说话人的姓名", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认姓名", exact: true }).first()).toBeVisible();
  await expect(page.locator(".speaker-queue-item")).toHaveCount(2);
  const playbackMode = page.getByRole("button", { name: "播放模式", exact: true });
  await expect(playbackMode).toBeEnabled();
  await playbackMode.click();
  await page.locator(".playback-reference summary").click();
  await expect(page.getByLabel("YouTube 链接", { exact: true })).toBeVisible();
  await expect(page.getByLabel("音频到视频的偏移（秒）", { exact: true })).toHaveValue("0");

  await page.getByLabel("YouTube 链接", { exact: true }).fill("https://example.com/not-a-youtube-video");
  await page.getByRole("button", { name: "保存参考", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请输入 HTTPS YouTube watch、youtu.be、embed 或 shorts 链接。");
});
