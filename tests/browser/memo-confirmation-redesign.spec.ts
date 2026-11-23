import {changeTopbarLanguage} from "./helpers/language";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

async function prepare(page: Page, language: "en" | "zh-CN", withKey = true, model?: string) {
  await page.context().route("https://**/*", route => route.abort());
  await page.addInitScript(() => { window.confirm = () => true; });
  if (withKey) {
    await page.goto("./#/settings");
    await page.getByLabel("OpenAI API key", { exact: true }).fill("synthetic-confirmation-only");
    if (model) await page.getByLabel("Memo model ID").fill(model);
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved on this device", exact: true })).toBeVisible();
  }
  await page.goto("./");
  const meeting = sampleMeeting();
  meeting.title = "Synthetic confirmation review";
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "synthetic-confirmation.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(meeting)),
  });
  await expect(page.getByRole("heading", { name: meeting.title + " (restored)", exact: true })).toBeVisible();
  if (language === "zh-CN") await changeTopbarLanguage(page, "zh-CN");
  await page.getByRole("tab", { name: language === "zh-CN" ? /会议笔记/ : /Meeting notes/ }).click();
  const connectKey = page.locator(".memo-review-panel").getByRole("link", { name: language === "zh-CN" ? "连接 API 密钥" : "Connect your API key", exact: true });
  if (withKey) await expect(connectKey).toHaveCount(0);
  else await expect(connectKey).toBeVisible();
  await page.getByRole("button", { name: language === "zh-CN" ? "生成会议笔记" : "Generate meeting notes", exact: true }).click();
  return meeting;
}

for (const language of ["en", "zh-CN"] as const) {
  test("confirmation explains checks and requires fresh cost consent (" + language + ")", async ({ page }, info) => {
    let outside = 0;
    page.on("request", request => { if (request.url().startsWith("https://")) outside++; });
    const meeting = await prepare(page, language);
    await page.getByRole("dialog").screenshot({ path: info.outputPath("confirmation-before-or-after.png") });
    const chinese = language === "zh-CN";
    const dialog = page.getByRole("dialog", { name: chinese ? "生成新版会议笔记" : "Generate new meeting notes" });
    for (const heading of chinese ? ["生成设置", "生成前检查", "可选复核", "费用与处理"] : ["Generation settings", "Pre-generation checks", "Optional review", "Cost & processing"]) {
      await expect(dialog.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    await expect(dialog).toContainText("gpt-6-luna");
    await expect(dialog).toContainText(String(meeting.segments.length));
    await expect(dialog).toContainText(chinese ? "可能产生费用" : "may incur");
    const acknowledge = dialog.getByRole("checkbox", { name: chinese ? "我了解所选数据将被发送，并可能产生 API 费用。" : "I understand the selected data will be sent and may incur API charges.", exact: true });
    const generate = dialog.getByRole("button", { name: chinese ? "生成新版笔记" : "Generate new notes", exact: true });
    const pi = dialog.getByRole("checkbox", { name: chinese ? "使用选择性转录复核（Pi，可选）" : "Use selective transcript review (Pi, optional)", exact: true });
    await expect(pi).toBeChecked();
    await expect(acknowledge).not.toBeChecked();
    await expect(generate).toBeDisabled();
    for (const viewport of [{width: 1440, height: 900}, {width: 768, height: 1024}, {width: 390, height: 844}, {width: 320, height: 568}]) {
      await page.setViewportSize(viewport);
      await expect(dialog).toBeInViewport();
      await expect(generate).toBeInViewport();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const box = (await dialog.boundingBox())!, button = (await generate.boundingBox())!;
      expect(button.x).toBeGreaterThanOrEqual(box.x);
      expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width + 1);
      if (viewport.width === 390) await dialog.screenshot({ path: info.outputPath("confirmation-" + language + ".png") });
    }
    expect((await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await acknowledge.check();
    await expect(generate).toBeEnabled();
    await pi.uncheck();
    await expect(acknowledge).not.toBeChecked();
    await expect(generate).toBeDisabled();
    await expect(dialog).toContainText(chinese ? "标准纪要" : "Standard memo");
    await pi.check();
    await expect(dialog).toContainText(chinese ? "总费用未知" : "total cost is unknown");
    await expect(acknowledge).not.toBeChecked();
    await dialog.getByRole("button", { name: chinese ? "取消" : "Cancel", exact: true }).click();
    await page.getByRole("button", { name: chinese ? "生成会议笔记" : "Generate meeting notes", exact: true }).click();
    await expect(acknowledge).not.toBeChecked();
    await expect(generate).toBeDisabled();
    await dialog.getByRole("button", { name: chinese ? "查看说话人" : "Review speakers", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("tab", { name: chinese ? /说话人/ : /Speakers/ })).toHaveAttribute("aria-selected", "true");
    expect(outside).toBe(0);
  });
}

test("missing provider key remains a blocker even after cost acknowledgment", async ({ page }) => {
  await prepare(page, "en", false);
  const dialog = page.getByRole("dialog", { name: "Generate new meeting notes" });
  await expect(dialog).toContainText("Add your key in Settings first");
  await dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Generate new notes", exact: true })).toBeDisabled();
});

test("dark theme and largest text retain visible consent and actions on a narrow screen", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await prepare(page, "en");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.fontSize = "xxlarge";
  });
  const dialog = page.getByRole("dialog", { name: "Generate new meeting notes" });
  const acknowledge = dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true });
  const generate = dialog.getByRole("button", { name: "Generate new notes", exact: true });
  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  await expect(acknowledge).toBeInViewport();
  await expect(generate).toBeInViewport();
  const dialogBox = (await dialog.boundingBox())!;
  for (const button of [cancel, generate]) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);
  }
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await dialog.screenshot({ path: info.outputPath("dark-large-text.png") });
  await dialog.getByText("Technical details", { exact: true }).scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

for (const action of ["Review transcript", "Review fields"] as const) {
  test(`${action} opens the relevant transcript view`, async ({ page }) => {
    await prepare(page, "en");
    await page.getByRole("dialog").getByRole("button", { name: action, exact: true }).click();
    const tab = page.getByRole("tab", { name: /Transcript/ });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(tab).toBeFocused();
    const pendingOnly = page.getByRole("checkbox", { name: "Needs review", exact: true });
    if (action === "Review transcript") await expect(pendingOnly).toBeChecked();
    else await expect(pendingOnly).not.toBeChecked();
  });
}

test("an open confirmation follows credential availability changed by another tab", async ({ page, context }) => {
  let providerPosts = 0;
  context.on("request", request => {
    if (request.method() === "POST" && request.url().startsWith("https:")) providerPosts++;
  });
  await prepare(page, "en", false);
  const dialog = page.getByRole("dialog", { name: "Generate new meeting notes" });
  await dialog.getByRole("checkbox", { name: /I understand the selected data/ }).check();
  const generate = dialog.getByRole("button", { name: "Generate new notes", exact: true });
  await expect(generate).toBeDisabled();
  const settings = await context.newPage();
  await settings.goto("./#/settings");
  const field = settings.getByLabel("OpenAI API key", { exact: true });
  async function saveFixture(value: string) {
    await field.fill(value);
    await settings.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Saved on this device", exact: true })).toBeVisible();
  }
  await saveFixture("synthetic-confirmation-only");
  await expect(generate).toBeEnabled();
  await saveFixture("");
  await expect(generate).toBeDisabled();
  await expect(dialog).toContainText("Add your key in Settings first");
  expect(providerPosts).toBe(0);
});


test("an unsupported memo model keeps standard generation and fresh cost consent", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().startsWith("https:")) outside.push(request.url()); });
  await prepare(page, "en", true, "custom-memo-model");
  const dialog = page.getByRole("dialog", { name: "Generate new meeting notes" });
  await expect(dialog).toContainText("custom-memo-model");
  await expect(dialog.getByRole("checkbox", { name: /Use selective transcript review/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Generate new notes" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I understand the selected data/ }).check();
  await expect(dialog.getByRole("button", { name: "Generate new notes" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(outside).toEqual([]);
});
