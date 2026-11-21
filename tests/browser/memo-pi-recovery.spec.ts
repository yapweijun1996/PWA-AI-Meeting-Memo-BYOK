import { expect, test, type Page, type Route } from "@playwright/test";
import { confirm, memo, readPiMeeting, setup, sse, stream, tool } from "./helpers/memo-pi";

test.use({ serviceWorkers: "block" });

const openAI = "https://api.openai.com/v1/responses";
const openRouter = "https://openrouter.ai/api/v1/chat/completions";
const marker = "Synthetic selective review result";

async function startReview(page: Page, respond: (route: Route, attempt: number) => Promise<void>, provider: "openai" | "openrouter" = "openai") {
  const attempts: number[] = [];
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4180") return route.fallback();
    if (url.href !== (provider === "openai" ? openAI : openRouter) || route.request().method() !== "POST") {
      unexpected.push(url.origin + url.pathname);
      return route.abort();
    }
    const attempt = attempts.length + 1;
    attempts.push(attempt);
    await respond(route, attempt);
  });
  await setup(page, 2, provider);
  const dialog = await confirm(page);
  expect(attempts).toHaveLength(0);
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  return { attempts, unexpected };
}

async function expectReviewedRetry(page: Page) {
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  const dialog = await confirm(page);
  await expect(dialog.getByRole("checkbox", { name: /I reviewed the previous request outcome and billing/ })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Generate new notes", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
}

for (const failure of ["HTTP 500", "disconnect", "truncated stream", "oversize stream"] as const) {
  test(`${failure} keeps one uncertain receipt and requires reviewed consent after reload`, async ({ page }) => {
    const { attempts, unexpected } = await startReview(page, async route => {
      if (failure === "HTTP 500")
        return route.fulfill({ status: 500, json: { error: { message: "Synthetic server error" } } });
      if (failure === "disconnect") return route.abort("connectionreset");
      const body = failure === "oversize stream"
        ? ":" + "x".repeat(4 * 1024 * 1024)
        : sse([memo("synthetic-passage")]).split("event: response.completed")[0];
      await route.fulfill({ contentType: "text/event-stream", body });
    });
    await expect.poll(async () => (await readPiMeeting(page)).memoAgents?.[0]?.state).toBe("blocked");
    const saved = await readPiMeeting(page);
    expect(saved.jobs).toHaveLength(1);
    const [job] = saved.jobs;
    expect(job).toMatchObject({ state: "outcome_unknown", billing: "possibly_charged", usage: null, stepIndex: 0 });
    expect(saved.memoAgents![0].jobIds).toEqual([job.id]);
    expect(saved.memos).toHaveLength(0);
    if (failure === "truncated stream") expect(job.assistantRecord).toContain(marker);
    await page.reload();
    await expectReviewedRetry(page);
    expect((await readPiMeeting(page)).jobs).toEqual(saved.jobs);
    expect(attempts).toHaveLength(1);
    expect(unexpected).toEqual([]);
  });
}

test("reload with a submitted request in flight keeps its attempt and blocks automatic resubmission", async ({ page }) => {
  const { attempts, unexpected } = await startReview(page, async () => {
    // Leave the intercepted POST unanswered until navigation destroys its document.
  });
  await expect.poll(() => attempts.length).toBe(1);
  const before = await readPiMeeting(page);
  expect(before.jobs).toHaveLength(1);
  expect(before.jobs[0].state).toBe("in_flight");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Selective review fixture", exact: true })).toBeVisible();
  // A hard navigation can leave the receipt in flight; the owner resolves it explicitly.
  const interruption = page.getByRole("button", { name: "Review interruption", exact: true });
  if (await interruption.isVisible()) {
    page.once("dialog", dialog => dialog.accept());
    await interruption.click();
  }
  await expect.poll(async () => (await readPiMeeting(page)).jobs[0]?.state).toBe("outcome_unknown");
  await expectReviewedRetry(page);
  const after = await readPiMeeting(page);
  expect(after.jobs.map(job => job.id)).toEqual([before.jobs[0].id]);
  expect(after.memoAgents![0].jobIds).toEqual(before.memoAgents![0].jobIds);
  expect(attempts).toHaveLength(1);
  expect(unexpected).toEqual([]);
  expect(["paused", "blocked"]).toContain(after.memoAgents![0].state);
});

test("duplicate tool call IDs retain the paid response and stop before another POST", async ({ page }) => {
  const { attempts, unexpected } = await startReview(page, route => stream(route, [tool("duplicate"), tool("duplicate")]));
  await expect.poll(async () => (await readPiMeeting(page)).memoAgents?.[0]?.state).toBe("blocked");
  const saved = await readPiMeeting(page);
  expect(saved.jobs).toHaveLength(1);
  expect(saved.jobs[0].state).toBe("completed");
  const record = JSON.parse(saved.jobs[0].assistantRecord!);
  expect(record.content).toHaveLength(2);
  expect(record.content[0].id).toEqual(record.content[1].id);
  expect(saved.memoAgents![0].consulted).toEqual([]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Selective review progress" })).toContainText("1 requests recorded");
  expect(attempts).toHaveLength(1);
  expect(unexpected).toEqual([]);
});

test("repeated lookups with fresh IDs pause after three rounds without new evidence", async ({ page }) => {
  const { attempts, unexpected } = await startReview(page, (route, attempt) =>
    attempt <= 4 ? stream(route, [tool(`repeat-${attempt}`)]) : route.abort());
  await expect.poll(async () => (await readPiMeeting(page)).memoAgents?.[0]?.state).toBe("blocked");
  const saved = await readPiMeeting(page);
  expect(saved.jobs).toHaveLength(4);
  expect(saved.jobs.every(job => job.state === "completed" && job.assistantRecord)).toBe(true);
  expect(saved.memoAgents![0].consulted).toHaveLength(2);
  expect(saved.memoAgents![0].failure?.kind).toBe("limit");
  await page.reload();
  await expect(page.getByRole("region", { name: "Selective review progress" })).toContainText("4 requests recorded");
  expect(attempts).toHaveLength(4);
  expect(unexpected).toEqual([]);
});

test("a bounded completed response in unsupported wire format remains available for recovery", async ({ page }) => {
  const { attempts, unexpected } = await startReview(page, route => route.fulfill({
    json: { id: "synthetic-complete", object: "response", status: "completed", output: [memo("synthetic-passage")] },
  }));
  await expect.poll(async () => (await readPiMeeting(page)).jobs[0]?.state).toMatch(/^(completed|outcome_unknown)$/);
  const saved = await readPiMeeting(page);
  expect(saved.jobs).toHaveLength(1);
  expect(attempts).toHaveLength(1);
  expect(unexpected).toEqual([]);
  // An adapter may preserve the original in the receipt or expose the documented raw export.
  if (!saved.jobs[0].assistantRecord?.includes(marker)) {
    const recovery = page.getByRole("alert", { name: "Unsaved review response" });
    await expect(recovery).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await recovery.getByRole("button", { name: "Export unsaved response" }).click();
    const reader = await (await downloaded).createReadStream();
    const chunks = [];
    for await (const chunk of reader!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toContain(marker);
  }
  expect(attempts).toHaveLength(1);
});

test("truncated OpenRouter output never promotes provisional usage to a terminal receipt", async ({ page }) => {
  const provisional = { id: "synthetic-partial", model: "openai/gpt-6-luna", provider: "OpenAI",
    choices: [{ index: 0, delta: { role: "assistant", content: "Partial synthetic note" }, finish_reason: null }],
    usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 } };
  const { attempts, unexpected } = await startReview(page, route => route.fulfill({
    contentType: "text/event-stream", body: `data: ${JSON.stringify(provisional)}\n\n`,
  }), "openrouter");
  await expect.poll(async () => (await readPiMeeting(page)).memoAgents?.[0]?.state).toBe("blocked");
  const saved = await readPiMeeting(page);
  expect(attempts).toHaveLength(1);
  expect(unexpected).toEqual([]);
  expect(saved.jobs).toHaveLength(1);
  expect(saved.jobs[0].state).toBe("outcome_unknown");
  expect(saved.jobs[0].usage).toBeNull();
});

test("different response item IDs cannot authorize two lookups with the same provider call ID", async ({ page }) => {
  const repeated = tool("shared-call-id");
  const { attempts, unexpected } = await startReview(page, (route, attempt) =>
    attempt === 1 ? stream(route, [
      repeated,
      { ...repeated, id: "fc-separate-item", arguments: JSON.stringify({ startIndex: 1, count: 1 }) },
    ]) : route.abort());
  await expect.poll(async () => (await readPiMeeting(page)).memoAgents?.[0]?.state).toBe("blocked");
  const saved = await readPiMeeting(page);
  expect(saved.jobs[0].assistantRecord).toContain("fc-separate-item");
  expect(unexpected).toEqual([]);
  expect(attempts).toHaveLength(1);
  expect(saved.memoAgents![0].consulted).toHaveLength(0);
});

test("a stream disconnect after headers keeps the earlier tool response and stops the new turn", async ({ page }) => {
  // Playwright fulfills a whole body at once. Fail only the browser's second response reader.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.headers.get("x-synthetic-stream") !== "disconnect") return response;
      const broken = response.body!.pipeThrough(new TransformStream({
        flush() { throw new TypeError("Synthetic connection lost while reading the body"); },
      }));
      return new Response(broken, { status: response.status, headers: response.headers });
    };
  });
  const { attempts, unexpected } = await startReview(page, (route, attempt) => {
    if (attempt === 1) return stream(route, [tool()]);
    return route.fulfill({ contentType: "text/event-stream", headers: {
      "x-synthetic-stream": "disconnect", "access-control-expose-headers": "x-synthetic-stream",
    }, body: sse([memo("synthetic-passage")]) });
  });
  await expect.poll(async () => (await readPiMeeting(page)).memoAgents?.[0]?.state).toBe("blocked");
  const saved = await readPiMeeting(page);
  expect(saved.jobs.map(job => job.state)).toEqual(["completed", "outcome_unknown"]);
  expect(saved.jobs[0].assistantRecord).toContain("read_transcript_range");
  expect(saved.jobs[1].assistantRecord).toContain("Synthetic connection lost");
  await page.reload();
  await expectReviewedRetry(page);
  expect((await readPiMeeting(page)).jobs).toEqual(saved.jobs);
  expect(attempts).toHaveLength(2);
  expect(unexpected).toEqual([]);
});

test("a late Pi response remains exportable while navigating without its deleted meeting", async ({ page, context }) => {
  let held: Route | undefined;
  const { attempts, unexpected } = await startReview(page, async route => { held = route; });
  await expect.poll(() => attempts.length).toBe(1);
  const meetingUrl = page.url();
  const meetingId = meetingUrl.split("/").at(-1)!;
  await page.getByRole("link", { name: "All meetings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your meetings." })).toBeVisible();

  const other = await context.newPage();
  await other.goto(meetingUrl);
  other.once("dialog", dialog => dialog.accept());
  await other.getByRole("button", { name: "Delete meeting", exact: true }).click();
  await expect(other.getByRole("heading", { name: "Your meetings." })).toBeVisible();
  await stream(held!, [tool("recover-after-delete")]);
  const recovery = page.getByRole("alert", { name: "Unsaved review response" });
  await expect(recovery.getByRole("button", { name: "Export unsaved response" })).toBeVisible();

  // A stale bookmark may still point at the deleted workspace.
  await page.evaluate(url => { location.hash = new URL(url).hash; }, meetingUrl);
  await expect(page.getByRole("link", { name: "Back to meetings" })).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Export unsaved response" })).toBeVisible();
  await page.getByRole("link", { name: "Back to meetings" }).click();
  await expect(page.getByRole("heading", { name: "Your meetings." })).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  await page.getByRole("button", { name: "Explore a synthetic example" }).click();
  await expect(page.getByRole("link", { name: "All meetings", exact: true })).toBeVisible();
  await expect(recovery.getByRole("button", { name: /release this page copy/ })).toHaveCount(0);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  const downloaded = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "Export unsaved response" }).click();
  const reader = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const chunk of reader!) chunks.push(Buffer.from(chunk));
  const receipt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(receipt).toMatchObject({ format: "meeting-memo-agent-receipt", meetingId });
  expect(receipt.job.assistantRecord).toContain("recover-after-delete");
  await recovery.getByRole("button", { name: /release this page copy/ }).click();
  await expect(recovery).toHaveCount(0);
  expect(await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  expect(attempts).toEqual([1]);
  expect(unexpected).toEqual([]);
});
