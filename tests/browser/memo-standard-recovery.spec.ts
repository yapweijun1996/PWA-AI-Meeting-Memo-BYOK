import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Meeting } from "../../src/domain/model";
import { captureExtraction, planMemo } from "../../src/providers/memo-plan";
import { chooseStandardMemo, key, readPiMeeting, setup } from "./helpers/memo-pi";

test.use({ serviceWorkers: "block" });

const resultText = "The recovered decision is ready for human review.";
const panel = (page: Page) => page.getByRole("alert", { name: "Unsaved review response" });
const unloadAllowed = (page: Page) => page.evaluate(() =>
  window.dispatchEvent(new Event("beforeunload", { cancelable: true })));

async function seedExtractedPlan(page: Page) {
  const meeting = await readPiMeeting(page);
  const plan = planMemo(meeting, "openai", "gpt-6-luna", "decision")!;
  expect(plan.chunks.length).toBeGreaterThan(1);
  plan.results = plan.chunks.map(chunk => {
    const source = meeting.segments.find(segment => segment.id === chunk[0])!;
    return captureExtraction(meeting, [{
      id: crypto.randomUUID(), type: "decision", text: source.text,
      ownerId: null, dueDate: null, dueOriginal: null, review: "pending",
      sources: [{ id: source.id, revision: source.revision }],
    }]);
  });
  plan.state = "paused";
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("meetings", "readwrite");
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.objectStore("meetings").put(value);
      });
    } finally { db.close(); }
  }, { ...meeting, memoPipelines: [plan] });
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
}

async function submit(page: Page, stage: "single" | "extraction" | "synthesis" = "single") {
  await setup(page, stage === "single" ? 2 : 1500);
  if (stage === "synthesis") await seedExtractedPlan(page);

  await page.evaluate(() => {
    sessionStorage.setItem("reject-standard-body", "yes");
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: Meeting, ...args) {
      if (this.name === "meetings" && sessionStorage.getItem("reject-standard-body") &&
          value.jobs.some(job => job.memoResponse !== undefined)) {
        sessionStorage.setItem("standard-body-rejected", "yes");
        throw new DOMException("Synthetic receipt quota", "QuotaExceededError");
      }
      return put.call(this, value, ...args);
    };
  });

  const requests: Route[] = [];
  await page.route("https://api.openai.com/v1/responses", async route => {
    expect(route.request().method()).toBe("POST");
    requests.push(route);
    if (requests.length > 1) await route.abort();
  });
  await page.getByRole("button", { name: stage === "synthesis" ? "Review generation plan" : "Generate meeting notes", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  if (stage !== "synthesis") await chooseStandardMemo(dialog);
  if (stage !== "single") await expect(dialog).toContainText("extraction requests and one synthesis request");
  await expect(dialog.getByRole("checkbox", { name: /Use selective transcript review/ })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: /I understand the selected data/ }).check();
  expect(requests).toHaveLength(0);
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  const input = JSON.parse(requests[0].request().postDataJSON().input);
  const citation = stage === "synthesis" ? input.facts[0].items[0].id : input.segments[0].id;
  const item = { type: "decision", text: resultText, source_segment_ids: [citation],
    owner_speaker_id: null, due_date: null, due_original: key };
  const body = JSON.stringify({ id: "standard-response", status: "completed", echo: key, output: [
    { type: "message", content: [{ type: "output_text", text: JSON.stringify({ items: [item] }) }] },
  ] }).replaceAll(key, "\\u0073" + key.slice(1));
  return { requests, respond: () => requests[0].fulfill({ status: 200, contentType: "application/json", body }) };
}

async function exportResponse(page: Page) {
  const recovery = panel(page);
  await expect(recovery.getByRole("button", { name: /release this page copy/ })).toHaveCount(0);
  expect(await unloadAllowed(page)).toBe(false);
  const download = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "Export unsaved response" }).click();
  const raw = await readFile((await (await download).path())!, "utf8");
  expect(raw).not.toContain(key);
  const receipt = JSON.parse(raw);
  expect(receipt.kind).toBe("standard");
  expect(receipt).not.toHaveProperty("agentId");
  const response = JSON.parse(receipt.job.memoResponse);
  expect(response.echo).toBe("[redacted provider key]");
  expect(JSON.parse(response.output[0].content[0].text).items[0]).toMatchObject({
    text: resultText, due_original: response.echo,
  });
  expect(await unloadAllowed(page)).toBe(false);
  return receipt.job.memoResponse as string;
}

for (const stage of ["single", "extraction", "synthesis"] as const) {
  test(`local save applies the paid standard ${stage} response without another POST`, async ({ page }) => {
    const { requests, respond } = await submit(page, stage);
    if (stage === "single") await page.getByRole("link", { name: "All meetings", exact: true }).click();
    await respond();
    if (stage === "single") await page.getByRole("link", { name: "Unsaved review response", exact: true }).click();
    const retry = panel(page).getByRole("button", { name: "Retry local save only" });
    await expect(retry).toBeVisible();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("standard-body-rejected"))).toBe("yes");
    const body = await exportResponse(page);
    await retry.click();
    await expect(page.getByText("Synthetic receipt quota", { exact: true })).toBeVisible();
    await expect(retry).toBeEnabled();
    await page.evaluate(() => sessionStorage.removeItem("reject-standard-body"));
    await retry.click();
    await expect(panel(page)).toHaveCount(0);
    const saved = await readPiMeeting(page);
    expect(saved.jobs).toHaveLength(1);
    expect(saved.jobs[0].memoResponse).toBe(body);
    if (stage === "extraction") {
      const extracted = saved.memoPipelines![0].results[0];
      expect(extracted?.items[0].text).toContain(resultText);
      expect(extracted?.quotes[0].text).toBe(saved.segments[0].text);
      expect(saved.memoPipelines![0].state).toBe("paused");
      expect(saved.memos).toHaveLength(0);
    } else {
      expect(saved.memos).toHaveLength(1);
      expect(saved.memos[0].items[0].text).toContain(resultText);
      expect(saved.memos[0].originalItems).toEqual(saved.memos[0].items);
      expect(saved.memos[0].items[0].sources[0]).toEqual({ id: saved.segments[0].id, revision: saved.segments[0].revision });
      if (stage === "synthesis") expect(saved.memoPipelines![0].memoId).toBe(saved.memos[0].id);
      await page.getByRole("tab", { name: /Meeting notes/ }).click();
      await expect(page.locator(".memo-reading-text")).toContainText(resultText);
    }
    expect(await unloadAllowed(page)).toBe(true);
    await page.reload();
    const reloaded = await readPiMeeting(page);
    expect(reloaded.jobs).toEqual(saved.jobs);
    expect(reloaded.jobs[0].state).toBe("completed");
    expect(reloaded.memos).toEqual(saved.memos);
    expect(reloaded.memoPipelines).toEqual(saved.memoPipelines);
    expect(requests).toHaveLength(1);
  });
}

for (const timing of ["before", "after"] as const) {
  test(`a meeting deleted ${timing} the response still permits export and acknowledgement from the library`, async ({ page, context }) => {
    const { requests, respond } = await submit(page);
    const meetingUrl = page.url();
    await page.getByRole("link", { name: "All meetings", exact: true }).click();
    if (timing === "after") {
      await respond();
      await expect(page.getByRole("link", { name: "Unsaved review response" })).toBeVisible();
    }
    const other = await context.newPage();
    await other.goto(meetingUrl);
    other.once("dialog", dialog => dialog.accept());
    await other.getByRole("button", { name: "Delete meeting", exact: true }).click();
    await expect(other.getByRole("heading", { name: "Your meetings." })).toBeVisible();
    if (timing === "before") await respond();
    await expect(panel(page)).toBeVisible();
    await exportResponse(page);
    await panel(page).getByRole("button", { name: /release this page copy/ }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(await unloadAllowed(page)).toBe(true);
    expect(requests).toHaveLength(1);
  });
}

test.describe("mobile receipt", () => {
  test.use({ isMobile: true, hasTouch: true });
  test("controls remain reachable and acknowledgement releases the guard", async ({ page, browserName }) => {
    await page.setViewportSize(browserName === "webkit" ? { width: 390, height: 844 } : { width: 412, height: 915 });
    const { requests, respond } = await submit(page);
    await respond();
    const recovery = panel(page);
    await expect(recovery).toBeVisible();
    await exportResponse(page);
    const controls = recovery.getByRole("button");
    await expect(controls).toHaveCount(3);
    for (const button of await controls.all()) {
      await button.click({ trial: true });
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    expect(await recovery.evaluate(el => el.scrollWidth <= el.clientWidth + 1 &&
      document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await recovery.getByRole("button", { name: /release this page copy/ }).click();
    await expect(recovery).toHaveCount(0);
    expect(await unloadAllowed(page)).toBe(true);
    expect(requests).toHaveLength(1);
  });
});
