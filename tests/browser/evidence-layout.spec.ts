import { expect, test } from "@playwright/test";
import { sampleMeeting, segment } from "../../src/domain/model";

test.use({ serviceWorkers: "block" });

test("many exact citations remain readable, paged and unchanged", async ({ page }) => {
  const meeting = sampleMeeting();
  const speaker = meeting.speakers[0].id;
  meeting.segments = Array.from({ length: 85 }, (_, index) => segment(index === 0 ? "探" : "索", [speaker], 36 + index * 0.1, 36.05 + index * 0.1));
  const historical = structuredClone(meeting.segments[84]);
  meeting.history = [historical];
  meeting.segments[84] = { ...historical, revision: 2, text: "已更正", parents: [`${historical.id}:1`] };
  const sources = meeting.segments.map((value, index) => ({ id: value.id, revision: index === 84 ? 1 : value.revision }));
  const item = { id: crypto.randomUUID(), type: "summary" as const, text: "Synthetic summary", ownerId: null, dueDate: null, dueOriginal: null, sources, review: "pending" as const };
  meeting.memos = [{ id: crypto.randomUUID(), model: "synthetic", createdAt: new Date().toISOString(), sourceRevision: meeting.revision, items: [item], originalItems: [structuredClone(item)] }];
  await page.goto("./");
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
  const article = page.locator(".memo-item").first();
  await expect(article.locator(".source-link")).toHaveCount(3);
  await expect(article.getByRole("button", { name: "Show all 85 sources" })).toBeVisible();
  await expect(article.locator(".evidence-preview").first()).toContainText("84 cited fragments");
  await article.getByRole("button", { name: /Open cited fragments in preview/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".evidence-text")).toHaveText("探");
  await expect(dialog.locator(".evidence-context mark")).toHaveCount(84);
  await expect(dialog.getByText(/time and audio controls refer to its first fragment/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await article.getByRole("button", { name: "Show all 85 sources" }).click();
  for (let i = 0; i < 5; i++) await article.getByRole("button", { name: "Next sources" }).click();
  await article.getByRole("button", { name: "Passage 85 · r1" }).click();
  await expect(dialog.locator(".evidence-text")).toHaveText(historical.text);
  await expect(dialog.getByText(/current passage differs from the saved cited revision/i)).toBeVisible();
  await expect(dialog.locator(".evidence-context")).toContainText("已更正");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 667 });
  const heading = page.locator(".memo-review-panel > .panel-toolbar > div");
  const generate = page.locator(".memo-review-panel > .panel-toolbar > button");
  await expect.poll(async () => {
    const titleBox = await heading.boundingBox(), buttonBox = await generate.boundingBox();
    return !!titleBox && !!buttonBox && titleBox.y + titleBox.height <= buttonBox.y + 1;
  }).toBe(true);
  const preview = article.locator(".evidence-preview-text").first();
  const previewStyle = await preview.evaluate(element => {
    const style = getComputedStyle(element);
    return { textAlign: style.textAlign, lineHeight: parseFloat(style.lineHeight), height: element.getBoundingClientRect().height, fontSize: parseFloat(style.fontSize) };
  });
  expect(previewStyle.textAlign).toBe("left");
  expect(previewStyle.fontSize).toBeGreaterThanOrEqual(14);
  expect(previewStyle.height).toBeLessThanOrEqual(previewStyle.lineHeight * 3 + 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await article.getByRole("button", { name: /Open cited fragments in preview/ }).first().click();
  await expect(dialog).toBeVisible();
  const currentPassage = dialog.getByRole("button", { name: "View current passage" });
  await currentPassage.scrollIntoViewIfNeeded();
  await expect(currentPassage).toBeInViewport();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  const stored = await page.evaluate(async id => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const get = db.transaction("meetings").objectStore("meetings").get(id); get.onsuccess = () => { const value = get.result; db.close(); resolve(value); }; get.onerror = () => reject(get.error); };
  }), meeting.id) as typeof meeting;
  expect(stored.memos[0].items[0].sources).toEqual(sources);
});
