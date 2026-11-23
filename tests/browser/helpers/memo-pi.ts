import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { createMeeting, segment, type Meeting } from "../../../src/domain/model";

export const key = "sk-synthetic-browser-agent-key";
export const tool = (id = "call-read") => ({
  type: "function_call",
  id: `fc-${id}`,
  call_id: id,
  name: "read_transcript_range",
  arguments: JSON.stringify({ startIndex: 0, count: 2 }),
  status: "completed",
});
export const memo = (source: string) => ({
  type: "message",
  id: "message-final",
  role: "assistant",
  status: "completed",
  content: [
    {
      type: "output_text",
      text: JSON.stringify({
        items: [
          {
            type: "summary",
            text: "Synthetic selective review result",
            owner_speaker_id: null,
            due_date: null,
            due_original: null,
            source_segment_ids: [source],
          },
        ],
      }),
    },
  ],
});
export const sse = (items: Record<string, unknown>[]) => {
  const event = (type: string, values: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...values })}\n\n`;
  return (
    event("response.created", {
      response: { id: "synthetic-response", status: "in_progress" },
    }) +
    items
      .map((item, index) =>
        event("response.output_item.done", { output_index: index, item }),
      )
      .join("") +
    event("response.completed", {
      response: {
        id: "synthetic-response",
        status: "completed",
        output: items,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 10 },
        },
      },
    })
  );
};
export async function stream(route: Route, items: Record<string, unknown>[]) {
  await route.fulfill({
    contentType: "text/event-stream",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: sse(items),
  });
}
export function piBrowserOrigin() {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("The Pi browser tests require a configured app URL.");
  return new URL(baseURL).origin;
}

export async function setupPiSettings(page: Page, provider: "openai" | "openrouter" = "openai") {
  const appOrigin = piBrowserOrigin();
  await page.context().route("**/*", route =>
    new URL(route.request().url()).origin === appOrigin ? route.fallback() : route.abort(),
  );
  await page.goto("./#/settings");
  await page.getByLabel(provider === "openai" ? "OpenAI API key" : "OpenRouter API key", { exact: true }).fill(key);
  await page.getByLabel("Memo provider", { exact: true }).selectOption(provider);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Saved on this device", exact: true }),
  ).toBeVisible();
}

export async function setup(page: Page, passageCount = 2, provider: "openai" | "openrouter" = "openai") {
  await setupPiSettings(page, provider);
  await page.goto("./#/");
  const fixture = {
    ...createMeeting({ title: "Selective review fixture" }),
    segments: passageCount === 2 ? [
      segment("Review the evidence before approving the budget."),
      segment("Keep unresolved conditions visible."),
    ] : Array.from({ length: passageCount }, (_, index) => segment(`Source ${index}: retain this independently reviewed condition.`)),
  };
  await page
    .getByRole("button", { name: "Create your first meeting", exact: true })
    .click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Meeting title").fill(fixture.title);
  await create.getByText("Start from a transcript instead").click();
  await create
    .getByLabel("Transcript", { exact: true })
    .fill(JSON.stringify(fixture));
  await create
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: fixture.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  return fixture;
}

export async function chooseStandardMemo(dialog: Locator) {
  const review = dialog.getByRole("checkbox", { name: /Use selective transcript review|使用选择性转录复核/ });
  if (await review.count()) await review.uncheck();
}

export async function confirm(page: Page) {
  await page
    .getByRole("button", { name: /^(Generate meeting notes|Regenerate)$/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("checkbox", {
      name: "Use selective transcript review (Pi, optional)",
      exact: true,
    }),
  ).toBeChecked();
  await expect(dialog).toContainText("total cost is unknown");
  await dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true }).check();
  return dialog;
}
export async function readPiMeeting(page: Page): Promise<Meeting> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Meeting>((resolve, reject) => {
        const request = db.transaction("meetings").objectStore("meetings").getAll();
        request.onsuccess = () => request.result.length === 1
          ? resolve(request.result[0])
          : reject(new Error("Expected one synthetic meeting"));
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}
