import { expect, test } from "@playwright/test";
import { sampleMeeting, segment } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

test("500 cited revisions remain reachable and survive reload", async ({ page, context }) => {
  await context.route("https://**/*", route => route.abort());
  await page.addInitScript(() => { window.confirm = () => true; });
  const meeting = sampleMeeting();
  meeting.title = "Synthetic 500-source memo";
  const speaker = meeting.speakers[0].id;
  meeting.segments = Array.from({ length: 500 }, (_, index) =>
    segment("Evidence fragment " + (index + 1), [speaker], index, index + 0.8));
  const item = {
    id: crypto.randomUUID(), type: "summary" as const, text: "Check all the cited evidence.",
    ownerId: null, dueDate: null, dueOriginal: null,
    sources: meeting.segments.map(({id, revision}) => ({id, revision})), review: "pending" as const,
  };
  meeting.memos = [{id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceRevision: meeting.revision, model: "synthetic", items: [item], originalItems: [structuredClone(item)]}];
  await page.goto("./");
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "synthetic-500-sources.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(meeting)),
  });
  await expect(page.getByRole("heading", { name: meeting.title + " (restored)", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: "Evidence Review", exact: true }).click();
  const card = page.locator(".memo-item").first();
  await expect(card).toContainText("Source · 500");
  await card.getByRole("button", { name: "Show all 500 sources", exact: true }).click();
  for (let index = 0; index < 33; index++) await card.getByRole("button", { name: "Next sources", exact: true }).click();
  await expect(card).toContainText("496–500 / 500");
  await card.getByRole("button", { name: "Passage 500 · r1", exact: true }).click();
  await expect(page.getByRole("dialog").locator(".evidence-text")).toContainText("Evidence fragment 500");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await card.getByText("Read cited passages together (500)", { exact: true }).click();
  for (let index = 0; index < 24; index++) await card.getByRole("button", { name: "Next passages", exact: true }).click();
  await expect(card).toContainText("481–500 / 500");
  await expect(card.locator(".cited-evidence-text")).toContainText("Evidence fragment 500");
  await page.reload();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: "Evidence Review", exact: true }).click();
  await expect(page.locator(".memo-item").first()).toContainText("Source · 500");
});
