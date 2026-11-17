import {changeTopbarLanguage} from "./helpers/language";
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createMeeting, segment } from "../../src/domain/model";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
const key = "sk-synthetic-browser-agent-key";
const tool = (id = "call-read") => ({
  type: "function_call",
  id: `fc-${id}`,
  call_id: id,
  name: "read_transcript_range",
  arguments: JSON.stringify({ startIndex: 0, count: 2 }),
  status: "completed",
});
const memo = (source: string) => ({
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
const sse = (items: Record<string, unknown>[]) => {
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
async function stream(route: Route, items: Record<string, unknown>[]) {
  await route.fulfill({
    contentType: "text/event-stream",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: sse(items),
  });
}
async function setup(page: Page, passageCount = 2, provider: "openai" | "openrouter" = "openai") {
  await page.context().route("https://**/*", (route) => route.abort());
  await page.goto("./#/settings");
  await page.getByLabel(provider === "openai" ? "OpenAI API key" : "OpenRouter API key", { exact: true }).fill(key);
  await page.getByLabel("Memo provider", { exact: true }).selectOption(provider);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Saved on this device", exact: true }),
  ).toBeVisible();
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

test("review completes request 100 and preserves every response beyond the old step-index boundary", async ({ page }) => {
  test.setTimeout(120000);
  const fixture = await setup(page, 100);
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async route => {
    const turn = calls++;
    await stream(route, turn < 99 ? Array.from({ length: 1 }, (_, offset) => ({
      ...tool(`read-${turn}-${offset}`),
      arguments: JSON.stringify({ startIndex: turn + offset, count: 1 }),
    })) : [memo(fixture.segments[98].id)]);
  });
  const dialog = await confirm(page);
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic selective review result", { timeout: 90000 });
  const saved = await backup(page);
  expect(calls).toBe(100);
  expect(saved.jobs).toHaveLength(100);
  expect(saved.jobs.every(job => job.assistantRecord && job.state === "completed")).toBe(true);
  expect(saved.memoAgents[0].consulted).toHaveLength(99);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic selective review result");
  expect(calls).toBe(100);
});
async function confirm(page: Page) {
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
  ).not.toBeChecked();
  await dialog
    .getByRole("checkbox", {
      name: "Use selective transcript review (Pi, optional)",
      exact: true,
    })
    .check();
  await expect(dialog).toContainText("total cost is unknown");
  await dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true }).check();
  return dialog;
}
async function backup(page: Page) {
  return page.evaluate(async () => {
    const name = "meeting-memo-byok-v1";
    return new Promise<{
      jobs: {
        assistantRecord?: string;
        state: string;
        reportedCostUsd?: number | null;
      }[];
      memoAgents: { state: string; consulted: unknown[]; context: unknown[] }[];
      memos: unknown[];
    }>((resolve) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => {
        const database = open.result;
        const request = database
          .transaction("meetings")
          .objectStore("meetings")
          .getAll();
        request.onsuccess = () => {
          resolve(request.result[0]);
          database.close();
        };
      };
    });
  });
}

test("a large meeting can complete selective review without losing source evidence", async ({ page }) => {
  test.setTimeout(120000);
  await page.context().route("https://**/*", route => route.abort());
  await page.addInitScript(() => { window.confirm = () => true; });
  await page.goto("./#/settings");
  await page.getByLabel("OpenAI API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved on this device", exact: true })).toBeVisible();
  await page.goto("./");
  const fixture = {
    ...createMeeting({ title: "Large selective review" }),
    synthetic: true,
    segments: [segment("Review the evidence before approving the budget."), segment("Keep unresolved conditions visible.")],
  };
  fixture.history = Array.from({ length: 500 }, () => ({
    ...fixture.segments[0], id: crypto.randomUUID(), text: "x".repeat(20000), originalText: "x".repeat(20000),
  }));
  expect(Buffer.byteLength(JSON.stringify(fixture))).toBeGreaterThan(16 * 1024 * 1024);
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "large-synthetic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole("heading", { name: "Large selective review (restored)", exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async route => {
    calls++;
    await stream(route, calls === 1 ? [tool()] : [memo(fixture.segments[0].id)]);
  });
  const dialog = await confirm(page);
  expect(calls).toBe(0);
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic selective review result", { timeout: 30000 });
  expect(calls).toBe(2);
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const meeting = await new Promise<{ history: unknown[]; jobs: { assistantRecord?: string }[]; memos: { items: { sources: unknown[] }[] }[] }>((resolve, reject) => {
      const request = db.transaction("meetings").objectStore("meetings").getAll();
      request.onsuccess = () => resolve(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { history: meeting.history.length, receipts: meeting.jobs.filter(job => job.assistantRecord).length, sources: meeting.memos[0].items[0].sources };
  });
  expect(saved).toEqual({ history: 500, receipts: 2, sources: [{ id: fixture.segments[0].id, revision: fixture.segments[0].revision }] });
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic selective review result");
  expect(calls).toBe(2);
});

test("opt-in review uses real Pi tools under CSP, preserves receipts and does not resume after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await setup(page);
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.store).toBe(false);
    expect(body.model).toBe("gpt-6-luna");
    if (calls === 1) {
      expect(JSON.stringify(body)).not.toContain(fixture.segments[0].text);
      await stream(route, [tool()]);
    } else {
      expect(JSON.stringify(body)).toContain(fixture.segments[0].text);
      await stream(route, [memo(fixture.segments[0].id)]);
    }
  });
  const dialog = await confirm(page);
  expect(calls).toBe(0);
  expect(
    (await new AxeBuilder({ page }).include("dialog[open]").analyze())
      .violations,
  ).toEqual([]);
  await expect(dialog).toContainText("up to 100 requests per review");
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Generate new notes", exact: true })
    .click();
  await expect(page.locator(".memo-reading-text")).toHaveText(
    "Synthetic selective review result",
  );
  await expect(
    page.getByRole("region", { name: "Selective review progress" }),
  ).toContainText("2 requests recorded");
  const saved = await backup(page);
  expect(saved.jobs).toHaveLength(2);
  expect(
    saved.jobs.every(
      (job) => job.assistantRecord && job.reportedCostUsd === null,
    ),
  ).toBe(true);
  expect(saved.memoAgents[0].consulted).toHaveLength(2);
  expect(JSON.stringify(saved)).not.toContain(key);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.locator(".memo-reading-text")).toHaveText(
    "Synthetic selective review result",
  );
  expect(calls).toBe(2);
  expect(errors).toEqual([]);
});

test("unknown paid outcome stops, survives reload and requires reviewed authorization before continuation", async ({
  page,
}) => {
  const fixture = await setup(page);
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    if (++calls === 1)
      await route.fulfill({
        status: 429,
        json: { error: { message: "Synthetic rate refusal" } },
      });
    else
      await stream(
        route,
        calls === 2 ? [tool()] : [memo(fixture.segments[0].id)],
      );
  });
  let dialog = await confirm(page);
  await dialog
    .getByRole("button", { name: "Generate new notes", exact: true })
    .click();
  await expect
    .poll(async () => (await backup(page)).jobs[0]?.state)
    .toBe("outcome_unknown");
  expect(calls).toBe(1);
  await page.reload();
  expect(calls).toBe(1);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  dialog = await confirm(page);
  const send = dialog.getByRole("button", {
    name: "Generate new notes",
    exact: true,
  });
  await expect(send).toBeDisabled();
  await dialog
    .getByRole("checkbox", {
      name: /I reviewed the previous request outcome and billing/,
    })
    .check();
  await send.click();
  await expect(page.locator(".memo-reading-text")).toHaveText(
    "Synthetic selective review result",
  );
  expect(calls).toBe(3);
  const saved = await backup(page);
  expect(saved.jobs[0].state).toBe("outcome_unknown");
  expect(saved.jobs).toHaveLength(3);
});

async function rejectFirstResponseSave(page: Page) {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (
        this.name === "meetings" &&
        !sessionStorage.getItem("synthetic-agent-quota-fired") &&
        value.jobs?.some(
          (job: { assistantRecord?: string }) => job.assistantRecord,
        )
      ) {
        sessionStorage.setItem("synthetic-agent-quota-fired", "true");
        throw new DOMException(
          "Synthetic response quota failure",
          "QuotaExceededError",
        );
      }
      return put.call(this, value, ...args);
    };
  });
}

test("quota failure retains an exportable response and local retry never repeats the paid request", async ({
  page,
}) => {
  await rejectFirstResponseSave(page);
  const fixture = await setup(page);
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    calls++;
    await stream(
      route,
      calls === 1 ? [tool()] : [memo(fixture.segments[0].id)],
    );
  });
  const dialog = await confirm(page);
  await dialog
    .getByRole("button", { name: "Generate new notes", exact: true })
    .click();
  const recovery = page.getByRole("alert", { name: "Unsaved review response" });
  await expect(recovery).toBeVisible();
  expect(calls).toBe(1);
  await expect(recovery).toHaveAttribute("data-unsaved-edit", "true");
  await expect(
    page.getByRole("button", { name: "Delete meeting", exact: true }),
  ).toBeDisabled();
  const currentUrl = page.url();
  await page.evaluate(() => {
    location.hash = "/settings";
  });
  await expect(page).toHaveURL(currentUrl);
  const download = page.waitForEvent("download");
  await recovery
    .getByRole("button", { name: "Export unsaved response", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain(
    "unsaved-review-response.json",
  );
  await recovery
    .getByRole("button", { name: "Retry local save only", exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  expect(calls).toBe(1);
  await expect
    .poll(async () => (await backup(page)).jobs[0]?.state)
    .toBe("completed");
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  const next = await confirm(page);
  await expect(next).toContainText("up to 100 requests per review");
  await next
    .getByRole("button", { name: "Generate new notes", exact: true })
    .click();
  await expect(page.locator(".memo-reading-text")).toHaveText(
    "Synthetic selective review result",
  );
  expect(calls).toBe(2);
});

test("request byte budget stops locally before another receipt or provider submission", async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    calls++;
    await stream(route, [
      {
        type: "message",
        id: "message-long",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Synthetic bounded response. ".repeat(12000),
          },
        ],
      },
      tool(),
    ]);
  });
  const dialog = await confirm(page);
  await dialog
    .getByRole("button", { name: "Generate new notes", exact: true })
    .click();
  await expect
    .poll(async () => (await backup(page)).memoAgents?.[0]?.state)
    .toBe("blocked");
  expect(calls).toBe(1);
  const saved = await backup(page);
  expect(saved.jobs).toHaveLength(1);
  expect(saved.jobs[0].state).toBe("completed");
  expect(saved.jobs[0].assistantRecord).toContain("Synthetic bounded response");
  await page.reload();
  expect(calls).toBe(1);
});

test("Chinese selective confirmation captures the resolved memo language and remains usable at 390px", async ({
  page,
}) => {
  const fixture = await setup(page);
  let calls = 0;
  await changeTopbarLanguage(page, "zh-CN");
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON();
    expect(JSON.stringify(body)).toContain(
      "Write the notes in Simplified Chinese",
    );
    await stream(
      route,
      ++calls === 1 ? [tool()] : [memo(fixture.segments[0].id)],
    );
  });
  await page.getByRole("button", { name: "生成会议笔记", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("checkbox", {
      name: "使用选择性转录复核（Pi，可选）",
      exact: true,
    })
    .check();
  await expect(dialog).toContainText("总费用未知");
  await expect(dialog).toContainText("简体中文");
  expect(calls).toBe(0);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include("dialog[open]").analyze())
      .violations,
  ).toEqual([]);
  await dialog.getByRole("checkbox", { name: "我了解所选数据将被发送，并可能产生 API 费用。", exact: true }).check();
  await dialog.getByRole("button", { name: "生成新版笔记", exact: true }).click();
  await expect(page.locator(".memo-reading-text")).toHaveText(
    "Synthetic selective review result",
  );
  expect(calls).toBe(2);
  await expect(
    page.getByRole("region", { name: "选择性复核进度" }),
  ).toContainText("已完成");
});

test("Stop waiting aborts the active Pi request and reload never resubmits it", async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  let held: Route | undefined;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    calls++;
    held = route;
  });
  const dialog = await confirm(page);
  await dialog
    .getByRole("button", { name: "Generate new notes", exact: true })
    .click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
  await expect
    .poll(async () => (await backup(page)).jobs[0]?.state)
    .toBe("outcome_unknown");
  await held?.abort().catch(() => undefined);
  await page.reload();
  expect(calls).toBe(1);
  await expect(
    page.getByRole("region", { name: "Selective review progress" }),
  ).toContainText("paused");
});

test("local response recovery waits for a real cross-tab processing lock without repeating its request", async ({
  page,
  context,
}) => {
  await rejectFirstResponseSave(page);
  await setup(page);
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    calls++;
    await stream(route, [tool()]);
  });
  const dialog = await confirm(page);
  await dialog
    .getByRole("button", { name: "Generate new notes", exact: true })
    .click();
  const recovery = page.getByRole("alert", { name: "Unsaved review response" });
  await expect(recovery).toBeVisible();
  expect(calls).toBe(1);
  test.skip(
    !(await page.evaluate(() => !!navigator.locks)),
    "This engine does not expose Web Locks; CAS fallback is covered by unit contracts.",
  );
  const meetingId = new URL(page.url()).hash.split("/").at(-1)!;
  const other = await context.newPage();
  await other.goto(page.url());
  await other.evaluate((meetingId) => {
    const target = window as Window & {
      recoveryLockHeld?: boolean;
      releaseRecoveryLock?: () => void;
    };
    void navigator.locks.request(`meeting-memo-job:${meetingId}`, async () => {
      target.recoveryLockHeld = true;
      await new Promise<void>((resolve) => {
        target.releaseRecoveryLock = resolve;
      });
      target.recoveryLockHeld = false;
    });
  }, meetingId);
  await expect
    .poll(() =>
      other.evaluate(
        () =>
          !!(window as Window & { recoveryLockHeld?: boolean })
            .recoveryLockHeld,
      ),
    )
    .toBe(true);
  await recovery
    .getByRole("button", { name: "Retry local save only", exact: true })
    .click();
  await expect(
    page
      .getByText("Another tab is processing this meeting.", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(recovery).toBeVisible();
  expect(calls).toBe(1);
  await other.evaluate(() =>
    (
      window as Window & { releaseRecoveryLock?: () => void }
    ).releaseRecoveryLock?.(),
  );
  await expect
    .poll(() =>
      other.evaluate(
        () =>
          !!(window as Window & { recoveryLockHeld?: boolean })
            .recoveryLockHeld,
      ),
    )
    .toBe(false);
  await recovery
    .getByRole("button", { name: "Retry local save only", exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  expect(calls).toBe(1);
  await expect
    .poll(async () => (await backup(page)).jobs[0]?.state)
    .toBe("completed");
  await other.close();
});

for (const width of [390, 1440]) {
  test(`OpenRouter Pi route is confirmed, persisted and completed at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await setup(page, 2, "openrouter");
    let calls = 0;
    await page.route("https://openrouter.ai/api/v1/chat/completions", async route => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ model: "openai/gpt-6-luna", reasoning: { effort: "medium" }, max_tokens: 16384, provider: { only: ["openai"], order: ["openai"], allow_fallbacks: false, require_parameters: true } });
      const first = calls++ === 0;
      const delta = first ? { tool_calls: [{ index: 0, id: "call-router", type: "function", function: { name: "read_transcript_range", arguments: '{"startIndex":0,"count":2}' } }] } : { content: memo(fixture.segments[0].id).content[0].text };
      await route.fulfill({ contentType: "text/event-stream", headers: { "Access-Control-Allow-Origin": "*" }, body: `data: ${JSON.stringify({ id: "synthetic-router", model: "openai/gpt-6-luna", provider: "OpenAI", choices: [{ index: 0, delta, finish_reason: first ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\ndata: [DONE]\n\n` });
    });
    const dialog = await confirm(page);
    await expect(dialog.getByRole("combobox", { name: "Reasoning effort", exact: true })).toHaveValue("high");
    await expect(dialog.getByRole("combobox", { name: "Output token limit", exact: true })).toHaveValue("32768");
    await dialog.getByRole("combobox", { name: "Reasoning effort", exact: true }).selectOption("medium");
    await dialog.getByRole("combobox", { name: "Output token limit", exact: true }).selectOption("16384");
    await expect(dialog.getByRole("button", { name: "Generate new notes", exact: true })).toBeDisabled();
    await expect(dialog).toContainText("not benchmark-verified");
    await expect(dialog).toContainText("Automatic provider fallback is disabled");
    expect(calls).toBe(0);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect((await dialog.getByRole("combobox", { name: "Reasoning effort", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(42);
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual([]);
    await dialog.getByRole("combobox", { name: "Reasoning effort", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`router-${width}.png`) });
    await dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true }).check();
    await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
    await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic selective review result");
    expect(calls).toBe(2);
    expect((await backup(page)).memoAgents[0]).toMatchObject({ state: "completed", route: { version: 1, profile: "openrouter-luna-v1", reasoning: "medium", maxOutputTokens: 16384 } });
    await page.reload();
    await page.getByRole("tab", { name: /Meeting notes/ }).click();
    await expect(page.locator(".memo-reading-text")).toHaveText("Synthetic selective review result");
    expect(calls).toBe(2);
  });
}

test("failed OpenRouter route stops once and reload preserves the locked parameters", async ({ page }) => {
  await setup(page, 2, "openrouter");
  let calls = 0;
  await page.route("https://openrouter.ai/api/v1/chat/completions", async route => {
    calls++;
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"message":"Synthetic unavailable route"}}' });
  });
  let dialog = await confirm(page);
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selective review progress" })).toContainText("Review the recorded outcome");
  expect(calls).toBe(1);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  dialog = await confirm(page);
  await expect(dialog.getByRole("combobox", { name: "Reasoning effort", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("combobox", { name: "Output token limit", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Generate new notes", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(calls).toBe(1);
});


test("an exhausted Pi review blocks generating request 101 after reload while ordinary generation stays selectable", async ({ page }) => {
  test.setTimeout(120000);
  await setup(page, 101);
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async route => {
    const turn = calls++;
    await stream(route, [{ ...tool(`cap-${turn}`), arguments: JSON.stringify({ startIndex: turn, count: 1 }) }]);
  });
  let dialog = await confirm(page);
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selective review progress" })).toContainText("100 requests recorded", { timeout: 90000 });
  await expect(page.getByRole("region", { name: "Selective review progress" })).toContainText("100-request limit");
  expect(calls).toBe(100);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  dialog = await confirm(page);
  await expect(dialog).toContainText("100 of 100 requests recorded; 0 remaining");
  await expect(dialog.getByRole("alert")).toContainText("100-request limit");
  await expect(dialog.getByRole("button", { name: "Generate new notes", exact: true })).toBeDisabled();
  expect(calls).toBe(100);
  await dialog.getByRole("checkbox", { name: "Use selective transcript review (Pi, optional)", exact: true }).uncheck();
  await dialog.getByRole("checkbox", { name: "I understand the selected data will be sent and may incur API charges.", exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Generate new notes", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(calls).toBe(100);
});
