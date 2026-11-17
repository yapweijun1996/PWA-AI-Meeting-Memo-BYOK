import {changeTopbarLanguage} from "./helpers/language";
import { expect, test } from "@playwright/test";

test.use({serviceWorkers: "block"});

for (const [preference, instruction] of [
  ["interface", "Write the notes in Simplified Chinese"],
  ["meeting", "Write the notes in the meeting language"],
  ["en", "Write the notes in English"],
  ["zh-CN", "Write the notes in Simplified Chinese"],
  ["ms", "Write the notes in Malay"],
] as const)
  test(`memo language ${preference} persists and controls the confirmed request`, async ({page, context}) => {
    await context.route("https://**/*", route => route.abort());
    let calls = 0;
    let instructions = "";
    await page.route("https://api.openai.com/v1/responses", async route => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({status: 204, headers: {
          "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        }});
        return;
      }
      calls++;
      const body = route.request().postDataJSON();
      instructions = body.instructions;
      const input = JSON.parse(body.input);
      await route.fulfill({headers: {"Access-Control-Allow-Origin": "*"}, json: {
        status: "completed", output: [{type: "message", content: [{type: "output_text", text: JSON.stringify({items: [{
          type: "summary", text: "Synthetic language result", owner_speaker_id: null,
          due_date: null, due_original: null, source_segment_ids: [input.segments[0].id],
        }]})}]}],
      }});
    });
    await page.goto("./#/settings");
    const language = page.getByLabel("Memo output language", {exact: true});
    await expect(language).toHaveValue("interface");
    await language.selectOption(preference);
    await page.getByLabel("OpenAI API key", {exact: true}).fill("synthetic-language-only");
    await page.getByRole("button", {name: "Save settings", exact: true}).click();
    await expect(page.getByRole("button", {name: "Saved on this device", exact: true})).toBeVisible();
    await page.reload();
    await expect(language).toHaveValue(preference);
    expect(calls).toBe(0);
    await page.getByRole("button", {name: "New meeting", exact: true}).click();
    const create = page.getByRole("dialog");
    await create.getByLabel("Meeting title").fill("Memo language fixture");
    await create.getByText("Start from a transcript instead").click();
    await create.getByLabel("Transcript", {exact: true}).fill("Jamie: Review the evidence before approving the budget.");
    await create.getByRole("button", {name: "Create meeting", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Memo language fixture", exact: true})).toBeVisible();
    if (preference === "interface") await changeTopbarLanguage(page, "zh-CN");
    await page.getByRole("tab", {name: /Meeting notes|会议笔记/}).click();
    await page.getByRole("button", {name: /^(Generate meeting notes|生成会议笔记)$/}).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText(preference === "interface" ? "简体中文" : ({meeting: "Meeting language", en: "English", "zh-CN": "Simplified Chinese", ms: "Malay"} as const)[preference]);
    expect(calls).toBe(0);
    await confirmation.getByRole("checkbox", {name: /^(I understand the selected data will be sent and may incur API charges\.|我了解所选数据将被发送，并可能产生 API 费用。)$/}).check();
    await confirmation.getByRole("button", {name: /^(Generate new notes|生成新版笔记)$/}).click();
    await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic language result");
    expect(instructions).toContain(instruction);
    expect(calls).toBe(1);
    await page.reload();
    await page.getByRole("tab", {name: /Meeting notes|会议笔记/}).click();
    await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic language result");
    expect(calls).toBe(1);
  });
