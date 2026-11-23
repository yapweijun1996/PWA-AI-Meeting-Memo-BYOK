import { readFile } from "node:fs/promises";
import { chooseStandardMemo, setup } from "./helpers/memo-pi";
import { test, expect } from "@playwright/test";
import { createMeeting, segment } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });

test("Chinese long memo confirmation is readable and sends nothing before confirmation", async ({
  page,
  context,
}) => {
  await context.route("https://**/*", (route) => route.abort());
  const fixture = {
    ...createMeeting({ title: "Chinese plan" }),
    segments: Array.from({ length: 650 }, (_, i) =>
      segment(`${i}: ${"word ".repeat(25)}`),
    ),
  };
  const base = "/PWA-AI-Meeting-Memo-BYOK/";
  await page.goto(base);
  await page
    .getByRole("button", { name: "New meeting", exact: true })
    .last()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill(fixture.title);
  await dialog.getByText("Start from a transcript instead").click();
  await dialog
    .getByLabel("Transcript", { exact: true })
    .fill(JSON.stringify(fixture));
  await dialog
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: fixture.title, exact: true }),
  ).toBeVisible();
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "已保存在此设备", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + hash);
  await page.getByRole("tab", { name: /会议笔记/ }).click();
  await page.getByRole("button", { name: "生成会议笔记", exact: true }).click();
  dialog = page.getByRole("dialog");
  await chooseStandardMemo(dialog);
  await expect(dialog).toContainText("长纪要：");
  await expect(dialog).toContainText("总费用未知，每次请求均可能收费");
  await expect(dialog).toContainText("重新加载不会自动恢复请求");
  await expect(dialog).not.toContainText("???");
  await expect(
    dialog.getByRole("button", { name: "生成新版笔记", exact: true }),
  ).toBeDisabled();
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
    true,
  );
});
for (const {failOnce, wordLevel} of [{failOnce: false, wordLevel: true}, {failOnce: true, wordLevel: false}])
  test(`long memo confirms the full plan and ${failOnce ? "requires reviewed recovery" : "preserves original citations"}`, async ({
    page,
    context,
  }) => {
    await context.route("https://**/*", (route) => route.abort());
    let count = 0;
    await page.route("https://api.openai.com/v1/responses", async (route) => {
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
      count++;
      if (failOnce && count === 2) {
        await route.abort();
        return;
      }
      const body = route.request().postDataJSON();
      expect(body.input.length).toBeLessThanOrEqual(80000);
      const input = JSON.parse(body.input);
      const source = input.facts
        ? input.facts[0].items[0].id
        : input.segments[0].id;
      const item = {
        type: "summary",
        text: "Synthetic multi-step candidate.",
        owner_speaker_id: null,
        due_date: null,
        due_original: null,
        source_segment_ids: wordLevel && !input.facts
          ? input.segments.slice(0, 5).map((s: {id: string}) => s.id)
          : [source],
      };
      if (input.facts && wordLevel) {
        expect(input.facts[0].items[0].quote).toEqual(Array(100).fill("Budget item."));
        expect(input.facts[0].items[0]).not.toHaveProperty("sources");
      }
      await route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: {
          status: "completed",
          usage: { input_tokens: 10, output_tokens: 10 },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    items: wordLevel && !input.facts ? Array.from({length: 6}, () => ({...item})) : [item],
                  }),
                },
              ],
            },
          ],
        },
      });
    });
    const fixture = {
      ...createMeeting({ title: "Bounded long memo" }),
      synthetic: true,
      segments: Array.from({ length: wordLevel ? 12584 : 650 }, (_, i) =>
        wordLevel
          ? {...segment("Budget item."), start: i / 4, end: (i + 1) / 4}
          : segment(`${i}: ${"word ".repeat(25)}`),
      ),
    };
    const base = "/PWA-AI-Meeting-Memo-BYOK/";
    await page.goto(base);
    let dialog;
    if (wordLevel) {
      // Full backup restore is the supported path for a meeting above the paste limit.
      page.once("dialog", (confirmation) => confirmation.accept());
      await page.getByLabel("Restore backup", {exact: true}).setInputFiles({
        name: "synthetic-incident.json", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
    } else {
      await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("Meeting title").fill(fixture.title);
      await dialog.getByText("Start from a transcript instead").click();
      await dialog.getByLabel("Transcript", { exact: true }).fill(JSON.stringify(fixture));
      await dialog.getByRole("button", { name: "Create meeting", exact: true }).click();
    }
    await expect(
      page.getByRole("heading", { name: wordLevel ? `${fixture.title} (restored)` : fixture.title, exact: true }),
    ).toBeVisible();
    const hash = new URL(page.url()).hash;
    await page.getByRole("link", { name: "Settings & API keys" }).click();
    await page
      .getByLabel("OpenAI API key", { exact: true })
      .fill("synthetic-pipeline-only");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(
      page.getByRole("button", { name: "Saved on this device" }),
    ).toBeVisible();
    await page.goto(base + hash);
    await page.getByRole("tab", { name: /Meeting notes/ }).click();
    await page
      .getByRole("button", { name: "Generate meeting notes", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await chooseStandardMemo(dialog);
    await expect(dialog).toContainText(
      "extraction requests and one synthesis request",
    );
    expect(count).toBe(0);
    await dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true }).check();
    await dialog
      .getByRole("button", { name: "Generate new notes", exact: true })
      .click();
    if (failOnce) {
      await expect(page.getByLabel("Long memo progress")).toContainText(
        "blocked",
      );
      const panel = page.locator(".memo-review-panel");
      const progress = page.getByLabel("Long memo progress");
      const panelBox = (await panel.boundingBox())!, progressBox = (await progress.boundingBox())!;
      expect(progressBox.y - panelBox.y - panelBox.height).toBeGreaterThanOrEqual(12);
      await expect(panel.getByRole("link", { name: "Connect your API key", exact: true })).toHaveCount(0);
      expect(count).toBe(2);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.reload();
      await expect(page.getByLabel("Long memo progress")).toContainText("1/");
      expect(count).toBe(2);
      await page
        .getByRole("button", { name: "Review generation plan", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      const send = dialog.getByRole("button", {
        name: "Generate new notes",
        exact: true,
      });
      await expect(send).toBeDisabled();
      await dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true }).check();
      await expect(send).toBeDisabled();
      await dialog.getByRole("checkbox",{name:/I reviewed the previous request outcome and billing/}).check();
      await send.click();
    }
    // Simple Mode presents saved notes as paragraphs; inspect the editable
    // review view explicitly rather than expecting an always-open editor.
    await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic multi-step candidate.");
    await page.getByRole("button", { name: "Evidence Review", exact: true }).click();
    await expect(page.getByLabel("summary note")).toHaveValue(
      "Synthetic multi-step candidate.",
    );
    await expect(page.getByLabel("Long memo progress")).toContainText(
      "completed",
    );
    if (wordLevel) {
      expect(count).toBe(4);
      const saved = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("meeting-memo-byok-v1");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const meetings = await new Promise<Array<{memoPipelines: Array<{results: unknown[]}>}>>((resolve, reject) => {
          const request = db.transaction("meetings").objectStore("meetings").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return meetings[0].memoPipelines[0].results.map(r => JSON.stringify(r).length);
      });
      expect(saved).toHaveLength(3);
      expect(saved.every(size => size > 8000)).toBe(true);
    }
    const requests = count;
    await page.reload();
    await page.getByRole("tab", { name: /Meeting notes/ }).click();
    await page.getByRole("button", { name: "Evidence Review", exact: true }).click();
    await expect(page.getByLabel("summary note")).toHaveValue(
      "Synthetic multi-step candidate.",
    );
    expect(count).toBe(requests);
    await page.locator("button.source-link").first().click();
    await expect(page.getByRole("dialog").locator(".evidence-text")).toHaveText(
      fixture.segments[0].text,
    );
  });

test("standard notes export the complete paid date quote from history after reload", async ({ page }) => {
  await setup(page);
  const quote = "after both teams approve ".repeat(9) + "in writing";
  let posts = 0;
  await page.route("https://api.openai.com/v1/responses", async route => {
    posts++;
    const source = JSON.parse(route.request().postDataJSON().input).segments[0].id;
    const item = { type: "action", text: "Request approval.", owner_speaker_id: null,
      due_date: null, due_original: quote, source_segment_ids: [source] };
    await route.fulfill({ json: { status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ items: [item] }) }] }] } });
  });
  await page.getByRole("button", { name: "Generate meeting notes", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await chooseStandardMemo(dialog);
  await dialog.getByRole("checkbox", { name: /I understand the selected data/ }).check();
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect(page.locator(".memo-reading-text")).toContainText("Request approval.");
  await page.reload();
  await page.locator("summary").filter({ hasText: "Processing history" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export recorded response", exact: true }).click();
  const body = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(JSON.parse(body.output[0].content[0].text).items[0].due_original).toBe(quote);
  expect(posts).toBe(1);
});
