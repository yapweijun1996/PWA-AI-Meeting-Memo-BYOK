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
  await page.getByLabel("Display language / 显示语言").selectOption("zh-CN");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + hash);
  await page.getByRole("tab", { name: /会议笔记/ }).click();
  await page.getByRole("button", { name: "生成会议笔记", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("长纪要：");
  await expect(dialog).toContainText("总费用未知，每次请求均可能收费");
  await expect(dialog).toContainText("重新加载不会自动恢复请求");
  await expect(dialog).not.toContainText("???");
  await expect(
    dialog.getByRole("button", { name: "确认并发送", exact: true }),
  ).toBeDisabled();
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
    true,
  );
});
for (const failOnce of [false, true])
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
                    items: [
                      {
                        type: "summary",
                        text: "Synthetic multi-step candidate.",
                        owner_speaker_id: null,
                        due_date: null,
                        due_original: null,
                        source_segment_ids: [source],
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
    const fixture = {
      ...createMeeting({ title: "Bounded long memo" }),
      synthetic: true,
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
    await expect(dialog).toContainText(
      "extraction requests and one synthesis request",
    );
    expect(count).toBe(0);
    await dialog
      .getByRole("button", { name: "Confirm and send", exact: true })
      .click();
    if (failOnce) {
      await expect(page.getByLabel("Long memo progress")).toContainText(
        "blocked",
      );
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
        name: "Confirm and send",
        exact: true,
      });
      await expect(send).toBeDisabled();
      await dialog.getByRole("checkbox").check();
      await send.click();
    }
    await expect(page.getByLabel("summary note")).toHaveValue(
      "Synthetic multi-step candidate.",
    );
    await expect(page.getByLabel("Long memo progress")).toContainText(
      "completed",
    );
    const requests = count;
    await page.reload();
    await page.getByRole("tab", { name: /Meeting notes/ }).click();
    await expect(page.getByLabel("summary note")).toHaveValue(
      "Synthetic multi-step candidate.",
    );
    expect(count).toBe(requests);
    await page.locator("button.source-link").first().click();
    await expect(page.getByRole("dialog").locator(".evidence-text")).toHaveText(
      fixture.segments[0].text,
    );
  });
