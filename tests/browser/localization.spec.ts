import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

test("Chinese navigation and creation dialog are accessible on a narrow screen", async ({
  page,
}) => {
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/#/settings");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("button", { name: "新建会议", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "创建新会议" });
  await expect(dialog).toBeVisible();
  await expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "关闭对话框" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
});

test("Chinese history retains request billing uncertainty after reload", async ({
  page,
}) => {
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/#/settings");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(
    page.getByRole("button", { name: "已保存在此设备" }),
  ).toBeVisible();
  const meeting = sampleMeeting();
  const message =
    "The connection ended without a confirmed result. This request may have been charged. Check your provider account before retrying.";
  meeting.jobs.push({
    id: crypto.randomUUID(),
    stage: "speech",
    state: "outcome_unknown",
    billing: "possibly_charged",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    requestId: null,
    message,
    inputRevision: meeting.revision,
  });
  const restoreConfirmation = page.waitForEvent("dialog");
  await page.locator(".nav-file input").setInputFiles({
    name: "sample-meeting.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(meeting)),
  });
  await (await restoreConfirmation).accept();
  await expect(
    page.getByRole("heading", {
      name: `${meeting.title} (restored)`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("处理记录").click();
  await expect(page.getByText(/此请求可能已收费/)).toBeVisible();
  await expect(page.locator(".job-entry").first()).toContainText("可能已收费");
  await expect(page.locator(".job-entry").first()).toContainText(
    "连接结束时没有确认结果",
  );
  const restoredId = new URL(page.url()).hash.match(
    /#\/meetings\/([^/?]+)/,
  )?.[1];
  expect(restoredId).toBeTruthy();
  if (!restoredId) throw new Error("Restored meeting ID is missing");
  await page.reload();
  await page.getByText("处理记录").click();
  await expect(page.getByText(/此请求可能已收费/)).toBeVisible();
  await expect(page.locator(".job-entry").first()).toContainText(
    "连接结束时没有确认结果",
  );
  const stored = await page.evaluate(
    async (id) =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("meeting-memo-byok-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const read = database
            .transaction("meetings")
            .objectStore("meetings")
            .get(id);
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            resolve(read.result.jobs[0].message);
            database.close();
          };
        };
      }),
    restoredId,
  );
  expect(stored).toBe(message);
});

test("topbar language choice persists and Malay fallback is explicit", async ({ page }) => {
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
  const language = page.getByLabel("Display language", { exact: true });
  await expect(language).toHaveValue("en");
  const picker = page.locator(".topbar-language");
  await expect(picker.locator("svg")).toBeVisible();
  expect((await picker.boundingBox())!.width).toBe(44);
  await language.click();
  await expect(language).toBeFocused();
  await language.selectOption("ms");
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");
  await expect(page.getByRole("link", { name: /Mesyuarat anda/ })).toBeVisible();
  await expect(language.locator("option[value=ms]")).toContainText("partial");
  await page.reload();
  await expect(page.getByLabel("Display language", { exact: true })).toHaveValue("ms");
});

test("help guide remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "How it works" }).click();
  const guide = page.getByRole("dialog", { name: "A little clarity, step by step" });
  await expect(guide.locator(".help-steps li")).toHaveCount(3);
  await expect(guide.getByRole("button", { name: "Explore a synthetic example" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
});
