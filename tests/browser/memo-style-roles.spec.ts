import { expect, test } from "@playwright/test";
import { sampleMeeting, type MemoItem } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

test("memo reading and editing retain fixed type while the surrounding font axis changes", async ({ page }) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("https://**/*", route => { external.push(route.request().url()); return route.abort(); });
  const meeting = sampleMeeting();
  meeting.title = "Synthetic fixed-size memo";
  const source = meeting.segments[0];
  const item: MemoItem = { id: crypto.randomUUID(), type: "summary", text: "Review this saved summary.", ownerId: null, dueDate: null, dueOriginal: null, sources: [{ id: source.id, revision: source.revision }], review: "pending" };
  const items: MemoItem[] = [item, { ...structuredClone(item), id: crypto.randomUUID(), type: "action", text: "Keep the reading paragraph available beside its editor." }];
  meeting.memos = [{ id: crypto.randomUUID(), model: "synthetic", createdAt: new Date().toISOString(), sourceRevision: meeting.revision, items, originalItems: structuredClone(items) }];
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /Your meetings/ })).toBeVisible();
  page.once("dialog", dialog => void dialog.accept());
  await page.locator(".nav-file input").setInputFiles({ name: "fixed-size-notes.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(meeting)) });
  await expect(page.getByRole("heading", { name: "Synthetic fixed-size memo (restored)", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: /^Edit note/ }).first().click();
  const editor = page.locator(".memo-document .memo-item textarea");
  const paragraph = page.locator(".memo-reading-text");
  await expect(editor).toBeVisible();
  await expect(paragraph).toBeVisible();
  const rootSizes = new Set<string>();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [theme, palette] of [["light", "forest"], ["dark", "ocean"]]) {
      for (const size of ["small", "normal", "large", "xlarge", "xxlarge"]) {
        await page.evaluate(({ theme, palette, size }) => {
          for (const [key, value] of [["meeting-memo:theme", theme], ["meeting-memo:palette", palette], ["meeting-memo:font-size", size]]) {
            localStorage.setItem(key, value);
            window.dispatchEvent(new StorageEvent("storage", { key }));
          }
        }, { theme, palette, size });
        await expect(page.locator("html")).toHaveAttribute("data-font-size", size);
        await expect(editor).toHaveCSS("font-size", "16px");
        await expect(paragraph).toHaveCSS("font-size", "16px");
        rootSizes.add(await page.locator("html").evaluate(element => getComputedStyle(element).fontSize));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  expect(rootSizes.size).toBe(5);
  await expect(editor).toHaveValue(item.text);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
