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
async function setup(page: Page) {
  await page.context().route("https://**/*", (route) => route.abort());
  await page.goto("./#/settings");
  await page.getByLabel("OpenAI API key", { exact: true }).fill(key);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Saved on this device", exact: true }),
  ).toBeVisible();
  await page.goto("./#/");
  const fixture = {
    ...createMeeting({ title: "Selective review fixture" }),
    segments: [
      segment("Review the evidence before approving the budget."),
      segment("Keep unresolved conditions visible."),
    ],
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
  await expect(dialog).toContainText("6 further paid requests");
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
  ).toContainText("2/6 requests recorded");
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
  await expect(next).toContainText("5 further paid requests");
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
  await page
    .getByRole("combobox", { name: "Display language", exact: true })
    .selectOption("zh-CN");
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
