import { expect, test } from "@playwright/test";

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
  await dialog
    .getByLabel("转录", { exact: true })
    .fill("甲: 我们先确认库存流程。\n乙: 好的，我会核对第二步。\n甲: 谢谢。");
  await dialog.getByRole("button", { name: "创建会议", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "中文说话人界面", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /说话人/ }).click();
  await expect(page.getByLabel("样本长度", { exact: true })).toBeVisible();
  await expect(page.getByLabel("第 1 位说话人的姓名", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认姓名", exact: true }).first()).toBeVisible();
  await expect(page.locator(".speaker-review-card").filter({ hasText: "需要确认姓名" })).toHaveCount(2);
  await expect(page.getByLabel("YouTube 链接", { exact: true })).toBeVisible();
  await expect(page.getByLabel("音频到视频的偏移（秒）", { exact: true })).toHaveValue("0");

  await page.getByLabel("YouTube 链接", { exact: true }).fill("https://example.com/not-a-youtube-video");
  await page.getByRole("button", { name: "保存参考", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请输入 HTTPS YouTube watch、youtu.be、embed 或 shorts 链接。");
});
