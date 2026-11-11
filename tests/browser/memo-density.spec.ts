import { expect, test } from "@playwright/test";
import { sampleMeeting, segment } from "../../src/domain/model";
import type { MemoItem } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

test("simple notes read as a compact document and retain editable exact evidence", async ({ page }, info) => {
  const meeting = sampleMeeting();
  meeting.title = "Synthetic readable notes";
  meeting.segments = Array.from({ length: 20 }, (_, index) => segment(`原话 ${index + 1}：先核对库存，再安排下一次讨论。`, [meeting.speakers[0].id], index * 5, index * 5 + 4));
  const items: MemoItem[] = meeting.segments.map((source, index) => ({ id: crypto.randomUUID(), type: "discussion", text: index % 5 === 0 ? `重点 ${index + 1}：库存流程需要核对，follow-up 在下周讨论。` : `重点 ${index + 1}：先核对库存，再讨论。`, ownerId: null, dueDate: null, dueOriginal: null, sources: [{ id: source.id, revision: source.revision }], review: "pending" }));
  items.push({ ...structuredClone(items[0]), id: crypto.randomUUID(), type: "action", text: "整理待讨论的问题。" });
  meeting.memos = [{ id: crypto.randomUUID(), model: "synthetic", createdAt: new Date().toISOString(), sourceRevision: meeting.revision, items, originalItems: structuredClone(items) }];
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /Your meetings/ })).toBeVisible();
  page.once("dialog", dialog => void dialog.accept());
  await page.locator(".nav-file input").setInputFiles({ name: "readable-notes.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(meeting)) });
  await expect(page.getByRole("heading", { name: "Synthetic readable notes (restored)", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  const document = page.locator(".memo-document");
  await expect(document.locator(".memo-item")).toHaveCount(21);
  await expect(document.locator("textarea")).toHaveCount(0);
  await expect(document.getByRole("button", { name: "Insert heading", exact: true })).toHaveCount(0);
  const first = document.locator(".memo-item").first();
  expect((await first.boundingBox())!.height).toBeLessThan(100);
  await expect.poll(async () => page.evaluate(() => { const sidebar = window.document.querySelector(".sidebar")!.getBoundingClientRect(); const main = window.document.querySelector(".main-shell")!.getBoundingClientRect(); return main.left >= sidebar.right - 1; })).toBe(true);
  await first.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath("notes-desktop.png") });
  for (const width of [640, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect.poll(async () => page.evaluate(() => window.document.querySelector(".sidebar")!.getBoundingClientRect().right <= 1)).toBe(true);
  await first.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath("notes-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  const source = first.getByRole("button", { name: /^View original words ·/ });
  await source.click();
  const drawer = page.locator("dialog.evidence-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".evidence-text")).toHaveText(meeting.segments[0].text);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(source).toBeFocused();
  await first.getByRole("button", { name: /^Edit note ·/ }).click();
  const input = first.getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill("人工修改后需要重新核对证据。");
  await expect(input).not.toHaveAttribute("data-unsaved-edit", "true");
  await expect(first.getByText(/previous citations have not verified it/)).toBeVisible();
  await first.getByRole("button", { name: /^Finish editing ·/ }).click();
  await expect(first.getByRole("textbox")).toHaveCount(0);
  await expect(first.getByRole("button", { name: /^Edit note ·/ })).toBeFocused();
});
