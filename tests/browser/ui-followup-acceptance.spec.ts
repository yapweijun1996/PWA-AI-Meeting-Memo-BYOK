import {changeTopbarLanguage} from "./helpers/language";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sampleMeeting, type Meeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });
const external = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, context }) => {
  const requests: string[] = [];
  external.set(page, requests);
  await context.route("https://**/*", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
});
test.afterEach(async ({ page }) => {
  expect(external.get(page)).toEqual([]);
});

async function restore(page: Page, meeting: Meeting) {
  await page.goto("./");
  await page
    .getByLabel("Restore backup", { exact: true })
    .setInputFiles({
      name: "synthetic-ui.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(meeting)),
    });
  await expect(
    page.getByRole("heading", {
      name: `${meeting.title} (restored)`,
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
}

for (const language of ["en", "zh-CN"] as const)
  test(`settings tabs and footer remain usable across widths and large text (${language})`, async ({
    page,
  }, info) => {
    const chinese = language === "zh-CN";
    const names = chinese
      ? ["外观", "API 与模型", "存储", "关于"]
      : ["Appearance", "API & models", "Storage", "About"];
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("./#/settings");
      await page.evaluate(
        ({ locale, font }) => {
          localStorage.setItem("meeting-memo:ui-language-override", locale);
          localStorage.setItem("meeting-memo:font-size", font);
        },
        {
          locale: language,
          font: viewport.width === 320 ? "xxlarge" : "normal",
        },
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const key = page.getByLabel(
        chinese ? "OpenAI API 密钥" : "OpenAI API key",
        { exact: true },
      );
      await key.fill("synthetic-unsaved-navigation-key");
      for (const name of [names[2], names[3], names[0], names[1]]) {
        const tab = page.getByRole("tab", { name, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tabpanel")).toHaveCount(1);
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        );
        if (!fits)
          console.log(
            JSON.stringify({
              viewport,
              name,
              overflow: await page.locator("main").evaluate((element) =>
                [...element.querySelectorAll("*")]
                  .filter(
                    (node) =>
                      node.getBoundingClientRect().right > innerWidth + 1,
                  )
                  .slice(0, 12)
                  .map((node) => ({
                    tag: node.tagName,
                    class: node.className,
                    right: node.getBoundingClientRect().right,
                    width: node.getBoundingClientRect().width,
                  })),
              ),
            }),
          );
        expect(fits).toBe(true);
      }
      await expect(key).toHaveValue("synthetic-unsaved-navigation-key");
      await page.getByRole("tab", { name: names[1], exact: true }).focus();
      await page.keyboard.press("End");
      await expect(
        page.getByRole("tab", { name: names[3], exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("tab", { name: names[3], exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("tab", { name: names[0], exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      const axe = await new AxeBuilder({ page }).include("main").analyze();
      expect(axe.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`settings-${language}-${viewport.width}.png`),
      });
      if (viewport.width <= 760)
        await page
          .getByRole("button", {
            name: chinese ? "打开导航" : "Open navigation",
            exact: true,
          })
          .click();
      else {
        const expand = page.getByRole("button", {
          name: chinese ? "展开侧边栏" : "Expand sidebar",
          exact: true,
        });
        if (await expand.isVisible()) await expand.click();
      }
      const footer = page.locator(".sidebar-bottom");
      const needsScroll = await page
        .locator(".sidebar")
        .evaluate((element) => element.scrollHeight > element.clientHeight + 1);
      if (viewport.width === 320 && needsScroll) {
        await page.mouse.move(100, 280);
        await page.mouse.wheel(0, 1500);
        await expect
          .poll(() =>
            page.locator(".sidebar").evaluate((element) => element.scrollTop),
          )
          .toBeGreaterThan(0);
      }
      // Finish pointer scrolling before the keyboard-only tooltip assertion.
      // A stationary pointer over Settings can otherwise replace the focus hint.
      await page.mouse.move(0, 0);
      const storageNote = footer.getByRole("note");
      await storageNote.scrollIntoViewIfNeeded();
      await storageNote.focus();
      await expect(storageNote).toBeFocused();
      await expect(page.getByRole("tooltip")).toContainText(
        chinese
          ? "已保存在此设备 · 本地存储"
          : "Saved on this device · Local storage",
      );
      expect(
        await footer.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      const update = footer.locator(".pwa-sidebar-button");
      await expect(update).toBeInViewport();
      const hint = page.locator(".sidebar-empty-hint");
      if (await hint.isVisible())
        expect(
          (await hint.boundingBox())!.y + (await hint.boundingBox())!.height,
        ).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);
      await footer.screenshot({
        path: info.outputPath(`footer-${language}-${viewport.width}.png`),
      });
      if (viewport.width > 760) {
        await page
          .getByRole("button", {
            name: chinese ? "收起侧边栏" : "Collapse sidebar",
            exact: true,
          })
          .click();
        await expect(footer.locator(".local-storage-icon")).toBeVisible();
        await expect(footer.getByRole("note")).toContainText(
          chinese ? "本地存储" : "Saved locally",
        );
        await footer.screenshot({
          path: info.outputPath(
            `footer-collapsed-${language}-${viewport.width}.png`,
          ),
        });
      } else {
        if (viewport.width === 320 && needsScroll) {
          await page.mouse.move(100, 280);
          await page.mouse.wheel(0, -2000);
          await expect
            .poll(() =>
              page.locator(".sidebar").evaluate((element) => element.scrollTop),
            )
            .toBe(0);
        }
        await page.keyboard.press("Escape");
      }
    }
  });

test("Chinese large meeting can select review without sending a provider request", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const meeting = sampleMeeting();
  meeting.title = "Synthetic large meeting";
  meeting.history = Array.from({ length: 500 }, () => ({
    ...meeting.segments[0],
    id: crypto.randomUUID(),
    text: "x".repeat(20000),
    originalText: "x".repeat(20000),
  }));
  expect(Buffer.byteLength(JSON.stringify(meeting))).toBeGreaterThan(16 * 1024 * 1024);
  await restore(page, meeting);
  const route = new URL(page.url()).hash;
  await page.goto("./#/settings");
  await page
    .getByLabel("Memo output language", { exact: true })
    .selectOption("meeting");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Saved on this device", exact: true }),
  ).toBeVisible();
  await changeTopbarLanguage(page, "zh-CN");
  await page.goto(`./${route}`);
  await page.getByRole("tab", { name: /会议笔记/ }).click();
  await page.getByRole("button", { name: "生成会议笔记", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("dd")).toContainText([
    "OpenAI",
    "gpt-6-luna",
    "会议语言",
    "选取的片段",
  ]);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "使用选择性转录复核（Pi，可选）", exact: true })).toBeChecked();
  await expect(dialog).toContainText("总费用未知");
  await expect(
    dialog.getByRole("button", { name: "生成新版笔记", exact: true }),
  ).toBeDisabled();
  await dialog.screenshot({
    path: info.outputPath("chinese-large-meeting-review.png"),
  });
});

test("Chinese capacity warning explains how to stop safely before a request", async ({ page }) => {
  test.setTimeout(120000);
  const meeting = sampleMeeting();
  meeting.title = "Synthetic near-limit meeting";
  meeting.history = Array.from({ length: 1200 }, () => ({
    ...meeting.segments[0], id: crypto.randomUUID(), text: "x".repeat(20000), originalText: "x".repeat(20000),
  }));
  await restore(page, meeting);
  await changeTopbarLanguage(page, "zh-CN");
  await page.getByRole("tab", { name: /会议笔记/ }).click();
  await page.getByRole("button", { name: "生成会议笔记", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const review = dialog.getByRole("checkbox", { name: "使用选择性转录复核（Pi，可选）", exact: true });
  await expect(review).toBeChecked();
  await expect(dialog.getByRole("button", { name: "生成新版笔记", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("未发送下一次请求");
  await expect(dialog.getByRole("alert")).toContainText("已保存的回应仍保留");
  await expect(dialog.getByRole("alert")).toContainText("精简本地历史");
});

test("all 85 source revisions remain reachable in compact review cards", async ({
  page,
}, info) => {
  const meeting = sampleMeeting();
  meeting.title = "Synthetic 85-source review";
  meeting.segments = Array.from({ length: 85 }, (_, index) => ({
    ...meeting.segments[index % meeting.segments.length],
    id: crypto.randomUUID(),
    start: index,
    end: index + 0.8,
    text: `Evidence passage ${index + 1}.`,
    originalText: `Evidence passage ${index + 1}.`,
  }));
  const note = {
    id: crypto.randomUUID(),
    type: "summary" as const,
    text: "Keep the complete evidence, including every uncertain condition.",
    ownerId: null,
    dueDate: null,
    dueOriginal: null,
    sources: meeting.segments.map((segment) => ({
      id: segment.id,
      revision: segment.revision,
    })),
    review: "pending" as const,
  };
  meeting.memos = [
    {
      id: crypto.randomUUID(),
      model: "synthetic",
      createdAt: new Date().toISOString(),
      sourceRevision: meeting.revision,
      items: [note],
      originalItems: [structuredClone(note)],
    },
  ];
  await page.setViewportSize({ width: 1440, height: 900 });
  await restore(page, meeting);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Evidence Review", exact: true })
    .click();
  const card = page.locator(".memo-item").first();
  const refs = card.getByRole("group", {
    name: "Source references",
    exact: true,
  });
  await expect(refs.locator(".source-link")).toHaveCount(3);
  await refs
    .getByRole("button", { name: "Show all 85 sources", exact: true })
    .click();
  for (let index = 0; index < 5; index++)
    await refs
      .getByRole("button", { name: "Next sources", exact: true })
      .click();
  await expect(
    refs.getByRole("button", { name: "Passage 85 · r1", exact: true }),
  ).toBeVisible();
  await refs
    .getByRole("button", { name: "Passage 85 · r1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Evidence passage 85.");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await card
    .getByText("Read cited passages together", { exact: false })
    .click();
  const cited = card.locator(".cited-evidence");
  for (let index = 0; index < 4; index++)
    await cited
      .getByRole("button", { name: "Next passages", exact: true })
      .click();
  await expect(cited).toContainText("Evidence passage 85.");
  await card.screenshot({ path: info.outputPath("review-all-sources.png") });
  const editor = card.getByRole("textbox", {
    name: "summary note",
    exact: true,
  });
  await editor.fill(
    "Human-reviewed summary with all original citations retained.",
  );
  await card.getByRole("button", { name: "✓ Accept", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "✓ Accept", exact: true }),
  ).toHaveClass(/selected/);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Evidence Review", exact: true })
    .click();
  await expect(editor).toHaveValue(
    "Human-reviewed summary with all original citations retained.",
  );
  await card.getByText("Original generated item", { exact: true }).click();
  await expect(card.locator(".original-text")).toContainText(note.text);
  const preserved = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const saved = await new Promise<Meeting>((resolve, reject) => {
      const request = database.transaction("meetings").objectStore("meetings").getAll();
      request.onsuccess = () => resolve(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return { segments: saved.segments, speakers: saved.speakers, sources: saved.memos[0].items[0].sources, original: saved.memos[0].originalItems?.[0], jobs: saved.jobs };
  });
  expect(preserved).toEqual({ segments: meeting.segments, speakers: meeting.speakers, sources: note.sources, original: note, jobs: [] });
});
