import {changeTopbarLanguage} from "./helpers/language";
import {expect, test, type Page} from "@playwright/test";
import {sampleMeeting, type Meeting} from "../../src/domain/model";

test.use({serviceWorkers: "block"});
async function records(page: Page): Promise<Meeting[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {return await new Promise<Meeting[]>((resolve,reject) => {
      const request = db.transaction("meetings").objectStore("meetings").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });} finally {db.close();}
  });
}

for (const language of ["en", "zh-CN"])
  test(`history cleanup ${language} requires confirmation and preserves old evidence through reload`, async ({page, context}) => {
    await context.route("https://**/*", route => route.abort());
    const m = sampleMeeting();
    m.title = "Synthetic history cleanup";
    const prior = structuredClone(m.segments[0]);
    m.segments[0] = {...prior, revision: prior.revision + 1, text: "Human correction"};
    m.revision++;
    m.history = [prior, structuredClone(m.segments[0]), structuredClone(prior)];
    m.undo = [{title: m.title, date: m.date, timezone: m.timezone, speakers: structuredClone(m.speakers), segments: [prior, ...m.segments.slice(1)]}];
    const item = {id: crypto.randomUUID(), type: "summary" as const, text: "Reviewed note remains", ownerId: null, dueDate: null, dueOriginal: null, sources: [{id: prior.id, revision: prior.revision}], review: "accepted" as const};
    m.memos = [{id: crypto.randomUUID(), sourceRevision: m.revision - 1, model: "synthetic", createdAt: new Date().toISOString(), items:[item], originalItems:[{...item,text:"Original generated note"}]}];
    await page.goto("./");
    page.once("dialog", dialog => dialog.accept());
    await page.getByLabel("Restore backup", {exact:true}).setInputFiles({name:"cleanup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(m))});
    await expect(page.getByRole("heading", {name:m.title+" (restored)",exact:true})).toBeVisible();
    if (language === "zh-CN") await changeTopbarLanguage(page, language);
    const before = (await records(page))[0];
    await page.getByRole("button", {name:/^(Edit meeting details|编辑会议资料)$/}).click();
    const details = page.getByRole("dialog", {name:/^(Meeting details|会议资料)$/});
    await details.getByLabel(/^(Title|标题)$/).fill("Unsaved metadata draft");
    const trigger = page.getByRole("button", {name:/^(Reduce local history|精简本地历史)$/});
    await trigger.click();
    let dialog = page.getByRole("dialog", {name:/^(Reduce local history|精简本地历史)$/});
    await expect(dialog).toContainText(language === "en" ? "cannot be undone" : "无法恢复");
    await expect(dialog).toContainText("MiB");
    await dialog.getByRole("button", {name:/^(Cancel|取消)$/}).click();
    await expect(dialog).toHaveCount(0);
    expect((await records(page))[0]).toEqual(before);
    await expect(details.getByLabel(/^(Title|标题)$/)).toHaveValue("Unsaved metadata draft");
    await expect(trigger).toBeFocused();
    await trigger.click();
    dialog = page.getByRole("dialog", {name:/^(Reduce local history|精简本地历史)$/});
    await dialog.getByRole("button", {name:/^(Confirm cleanup|确认清理)$/}).click();
    await expect(dialog).toHaveCount(0);
    const after = (await records(page))[0];
    expect(after.undo).toEqual([]);
    expect(after.history).toEqual([prior]);
    expect(after.segments).toEqual(before.segments);
    expect(after.memos).toEqual(before.memos);
    expect(after.runs).toEqual(before.runs);
    expect(after.revision).toBe(before.revision);
    expect(after.version).toBe(before.version + 1);
    await page.reload();
    expect((await records(page))[0]).toEqual(after);
    await page.getByRole("button", {name:/^(Edit meeting details|编辑会议资料)$/}).click();
    await expect(trigger).toBeEnabled(); // A unique old revision remains; it is not deleted.
    await trigger.click();
    await expect(page.getByRole("dialog", {name:/^(Reduce local history|精简本地历史)$/}).getByRole("button", {name:/^(Confirm cleanup|确认清理)$/})).toBeDisabled();
    expect((await records(page))[0]).toEqual(after);
  });
