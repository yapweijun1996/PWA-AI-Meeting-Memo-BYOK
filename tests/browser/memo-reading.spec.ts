import { expect, test } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });

test("simple notes autosave, retain exact evidence and undo without claiming verification", async ({ page }) => {
  const meeting = sampleMeeting();
  const source = meeting.segments[0];
  const item = { id: crypto.randomUUID(), type: "summary" as const, text: "Original summary", ownerId: null, dueDate: null, dueOriginal: null, sources: [{ id: source.id, revision: source.revision }], review: "pending" as const };
  const action = { ...item, id: crypto.randomUUID(), type: "action" as const, text: "Action", dueDate: "2026-12-01" };
  meeting.memos = [{ id: crypto.randomUUID(), model: "fixture", createdAt: new Date().toISOString(), sourceRevision: meeting.revision, items: [item, action], originalItems: [structuredClone(item), structuredClone(action)] }];
  await page.goto("./");
  await expect(page.locator(".loading-library")).toHaveCount(0);
  await page.evaluate(async value => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction("meetings", "readwrite"); tx.objectStore("meetings").put(value); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), meeting);
  await page.goto(`./#/meetings/${meeting.id}`);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByRole("button", { name: "Simple Mode" })).toHaveAttribute("aria-pressed", "true");
  const input = page.getByRole("textbox", { name: "summary note" });
  await input.fill("First change");
  await input.fill("Final change");
  await expect(input).not.toHaveAttribute("data-unsaved-edit", "true");
  await expect(page.getByText(/previous citations have not verified it/)).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(input).toHaveValue("Final change");
  await page.getByRole("button", { name: /undo/i }).click();
  await expect(input).toHaveValue("Original summary");
  await expect(page.getByText(/previous citations have not verified it/)).toBeVisible();
  await page.evaluate(async meetingId => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("meetings", "readwrite"), store = tx.objectStore("meetings");
      let held = true, started = false;
      (window as unknown as { releaseMemoLock: () => void }).releaseMemoLock = () => { held = false; };
      const keep = () => { const get = store.get(meetingId); get.onsuccess = () => { if (!started) { started = true; resolve(); } if (held) keep(); }; get.onerror = () => reject(get.error); };
      tx.oncomplete = () => db.close(); keep();
    };
  }), meeting.id);
  await input.fill("Intermediate change");
  await expect(page.getByText("Saving…", { exact: true })).toBeVisible();
  await input.fill("Original summary");
  await expect(input).toHaveAttribute("data-unsaved-edit", "true");
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(input).toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseMemoLock: () => void }).releaseMemoLock());
  await expect(input).not.toHaveAttribute("data-unsaved-edit", "true");
  await expect(input).toHaveValue("Original summary");
  await input.focus();
  await page.getByRole("button", { name: "Insert heading" }).first().click();
  await expect(input).toHaveValue("# Original summary");
  await expect(input).not.toHaveAttribute("data-unsaved-edit", "true");
  await page.getByRole("button", { name: /undo/i }).click();
  await expect(input).toHaveValue("Original summary");
  await input.fill("");
  await expect(input).toHaveAttribute("data-unsaved-edit", "true");
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(input).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await input.fill("Original summary");
  await page.evaluate(async meetingId => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("meetings", "readwrite"), store = tx.objectStore("meetings");
      let held = true, started = false;
      (window as unknown as { releaseMemoLock: () => void }).releaseMemoLock = () => { held = false; };
      const keep = () => { const get = store.get(meetingId); get.onsuccess = () => { if (!started) { started = true; resolve(); } if (held) keep(); }; get.onerror = () => reject(get.error); };
      tx.oncomplete = () => db.close(); keep();
    };
  }), meeting.id);
  const due = page.getByLabel("Action due date");
  await due.fill("2027-01-01");
  await expect(page.getByText("Saving…", { exact: true })).toBeVisible();
  await due.fill("2026-12-01");
  await expect(due).toHaveAttribute("data-unsaved-edit", "true");
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await expect(due).toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseMemoLock: () => void }).releaseMemoLock());
  await expect(due).not.toHaveAttribute("data-unsaved-edit", "true");
  await expect(due).toHaveValue("2026-12-01");
  await page.getByText("View original words").first().click();
  await expect(page.getByText(/citation order, not ranked/).first()).toBeVisible();
  const sourceButton = page.locator(".simple-evidence-preview").first();
  await sourceButton.click();
  const drawer = page.locator("dialog.evidence-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/evidence-drawer/);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(sourceButton).toBeFocused();
  await input.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  const assistantButton = page.getByRole("button", { name: "Improve selected text with AI" });
  await assistantButton.click();
  await page.getByRole("dialog").getByRole("button", { name: "Check original sources" }).click();
  await expect(drawer).toHaveClass(/evidence-drawer/);
  await drawer.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("button", { name: "Check original sources" })).toBeFocused();
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  const stored = await page.evaluate(async id => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const get = db.transaction("meetings").objectStore("meetings").get(id); get.onsuccess = () => { db.close(); resolve(get.result); }; get.onerror = () => reject(get.error); };
  }), meeting.id) as typeof meeting;
  expect(stored.memos[0].items[0].sources).toEqual(item.sources);
  await page.evaluate(async meetingId => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("meetings", "readwrite"), store = tx.objectStore("meetings");
      let held = true, started = false;
      (window as unknown as { releaseMemoLock: () => void }).releaseMemoLock = () => { held = false; };
      const keep = () => { const get = store.get(meetingId); get.onsuccess = () => { if (!started) { started = true; resolve(); } if (held) keep(); }; get.onerror = () => reject(get.error); };
      tx.oncomplete = () => db.close(); keep();
    };
  }), meeting.id);

  await page.evaluate(id => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onsuccess = () => { const db = request.result, tx = db.transaction("meetings", "readwrite"), store = tx.objectStore("meetings"), get = store.get(id); get.onsuccess = () => store.put({ ...get.result, version: get.result.version + 1 }); tx.oncomplete = () => db.close(); };
  }, meeting.id);
  await input.fill("Will fail due to another tab");
  await expect(page.getByText("Saving…", { exact: true })).toBeVisible();
  await input.fill("Original summary");
  await page.evaluate(() => (window as unknown as { releaseMemoLock: () => void }).releaseMemoLock());
  await expect(input).not.toHaveAttribute("data-unsaved-edit", "true");
  await expect(input).toHaveValue("Original summary");
  await expect(page.getByRole("alert").filter({ hasText: /another tab/i })).toBeVisible();

});
