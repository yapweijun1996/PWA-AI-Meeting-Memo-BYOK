import { expect, test, type Page } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });

async function setup(page: Page) {
  const meeting = sampleMeeting();
  const source = meeting.segments[0];
  const note = { id: crypto.randomUUID(), type: "action" as const, text: "Original action", ownerId: meeting.speakers[0].id, dueDate: "2026-12-01", dueOriginal: null, sources: [{ id: source.id, revision: source.revision }], review: "pending" as const };
  const second = { ...note, id: crypto.randomUUID(), text: "Second action" };
  meeting.memos = [{ id: crypto.randomUUID(), model: "synthetic", createdAt: new Date().toISOString(), sourceRevision: meeting.revision, items: [note, second], originalItems: [structuredClone(note), structuredClone(second)] }];
  await page.goto("./");
  // Wait for the application's versioned IndexedDB upgrade and startup cleanup.
  await expect(page.getByRole("heading", { name: /Your meetings/ })).toBeVisible();
  await expect(page.locator(".loading-library")).toHaveCount(0);
  await page.evaluate(async value => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Synthetic fixture database open was blocked."));
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction("meetings", "readwrite");
        tx.objectStore("meetings").put(value);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      } catch (error) { db.close(); reject(error); }
    };
  }), meeting);
  await page.goto(`./#/meetings/${meeting.id}`);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  return meeting;
}

async function holdMeetingWrites(page: Page, id: string) {
  await page.evaluate(async meetingId => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("meetings", "readwrite"), store = tx.objectStore("meetings");
      let held = true, started = false;
      (window as unknown as { releaseSyntheticWriteLock: () => void }).releaseSyntheticWriteLock = () => { held = false; };
      const keepAlive = () => { const get = store.get(meetingId); get.onerror = () => reject(get.error); get.onsuccess = () => { if (!started) { started = true; resolve(); } if (held) keepAlive(); }; };
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
      keepAlive();
    };
  }), id);
}

async function releaseMeetingWrites(page: Page) {
  await page.evaluate(() => (window as unknown as { releaseSyntheticWriteLock: () => void }).releaseSyntheticWriteLock());
}

test("keyboard review waits for a same-tab draft save and retains action fields", async ({ page }) => {
  const meeting = await setup(page);
  const article = page.locator(".memo-item").first();
  const note = article.getByLabel("action note"), accept = article.getByRole("button", { name: /Accept/ });
  await note.fill("Human edit before review");
  await holdMeetingWrites(page, meeting.id);
  await page.keyboard.press("Tab");
  await expect(note).toBeDisabled();
  await accept.focus();
  await page.keyboard.press("Enter");
  await releaseMeetingWrites(page);
  await expect(accept).toHaveClass(/selected/);
  await expect(page.getByRole("alert").filter({ hasText: /another tab/i })).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  const restored = page.locator(".memo-item").first();
  await expect(restored.getByLabel("action note")).toHaveValue("Human edit before review");
  await expect(restored.getByLabel("Action owner")).toHaveValue(meeting.speakers[0].id);
  await expect(restored.getByLabel("Action due date")).toHaveValue("2026-12-01");
  await expect(restored.getByRole("button", { name: /Accept/ })).toHaveClass(/selected/);
});

test("a genuine external write still causes a visible conflict without losing the draft", async ({ page, context }) => {
  const meeting = await setup(page);
  const article = page.locator(".memo-item").first();
  const note = article.getByLabel("action note");
  await note.fill("Unsaved human draft");
  const other = await context.newPage();
  await other.goto("./");
  await other.evaluate(async id => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction("meetings", "readwrite"), store = tx.objectStore("meetings"), get = store.get(id); get.onsuccess = () => store.put({ ...get.result, version: get.result.version + 1, title: "Other tab edit" }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), meeting.id);
  await article.getByRole("button", { name: /Accept/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /another tab/i })).toBeVisible();
  await expect(note).toHaveValue("Unsaved human draft");
  await other.close();
});

test("a second touch review cannot leave its draft blur blocked", async ({ page }) => {
  const meeting = await setup(page);
  const first = page.locator(".memo-item").nth(0), second = page.locator(".memo-item").nth(1);
  await holdMeetingWrites(page, meeting.id);
  await first.getByRole("button", { name: /Accept/ }).dispatchEvent("click");
  const secondAccept = second.getByRole("button", { name: /Accept/ });
  await secondAccept.dispatchEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 9 });
  await secondAccept.dispatchEvent("click");
  await expect(page.getByRole("alert").filter({ hasText: /current review to finish/i })).toBeVisible();
  await releaseMeetingWrites(page);
  await expect(first.getByRole("button", { name: /Accept/ })).toHaveClass(/selected/);
  const secondNote = second.getByLabel("action note");
  await secondNote.fill("Second draft survives");
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.locator(".memo-item").nth(1).getByLabel("action note")).toHaveValue("Second draft survives");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.locator(".memo-item").nth(1).getByLabel("action note")).toHaveValue("Second draft survives");
});

test("review retains an owner changed by its pending same-tab write", async ({ page }) => {
  const meeting = await setup(page);
  const article = page.locator(".memo-item").first();
  await holdMeetingWrites(page, meeting.id);
  await article.getByLabel("Action owner").selectOption(meeting.speakers[1].id);
  await expect(article.getByLabel("Action owner")).toBeDisabled();
  await article.getByRole("button", { name: /Accept/ }).click();
  await releaseMeetingWrites(page);
  await expect(article.getByRole("button", { name: /Accept/ })).toHaveClass(/selected/);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  const restored = page.locator(".memo-item").first();
  await expect(restored.getByLabel("Action owner")).toHaveValue(meeting.speakers[1].id);
  await expect(restored.getByRole("button", { name: /Accept/ })).toHaveClass(/selected/);
});

test("review waits for an in-flight source change and requires re-review", async ({ page }) => {
  const meeting = await setup(page);
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await holdMeetingWrites(page, meeting.id);
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).first().click();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  const article = page.locator(".memo-item").first();
  await article.getByRole("button", { name: /Accept/ }).click();
  await releaseMeetingWrites(page);
  await expect(page.getByRole("alert").filter({ hasText: /transcript changed while this review was waiting/i })).toBeVisible();
  await expect(article.getByRole("button", { name: /Accept/ })).not.toHaveClass(/selected/);
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.locator(".memo-item").first().getByText("pending", { exact: true })).toBeVisible();
});
