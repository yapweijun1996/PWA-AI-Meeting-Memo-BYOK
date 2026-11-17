import { expect, test } from "@playwright/test";
import { agentLocalFinalFixture } from "../fixtures/agent-local-final";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

for (const invalid of [false, true]) test(`restored final response ${invalid ? "rejects unsupported evidence" : "recovers"} without keys, consent or another request`, async ({ page }) => {
  const fixture = agentLocalFinalFixture({ fullHistory: true, invalid });
  let requests = 0;
  await page.context().route("https://**/*", route => { requests++; return route.abort(); });
  await page.goto("./");
  page.once("dialog", dialog => dialog.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({ name: "local-final.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole("heading", { name: fixture.title + " (restored)", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: "Generate new version", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Use selective transcript review (Pi, optional)", exact: true }).check();
  await expect(dialog).toContainText("100 of 100 requests recorded; 0 remaining");
  await expect(dialog).toContainText("Nothing is sent to a provider.");
  await expect(dialog.getByRole("checkbox", { name: /I understand|I reviewed/ })).toHaveCount(0);
  await expect(dialog.getByText("Add your key in Settings first")).toHaveCount(0);
  const recover = dialog.getByRole("button", { name: "Recover saved notes", exact: true });
  await expect(recover).toBeEnabled();
  await recover.click();
  if (invalid) await expect(page.getByRole("alert").first()).toContainText("did not read");
  else await expect(page.locator(".memo-reading-text")).toHaveText("Recovered from saved evidence.");
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("meeting-memo-byok-v1"); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<{ jobs: unknown[]; runs: unknown[]; memos: { items: {text: string}[] }[] }>(resolve => { const request = db.transaction("meetings").objectStore("meetings").getAll(); request.onsuccess = () => resolve(request.result[0]); }); }
    finally { db.close(); }
  });
  expect(saved.jobs).toEqual(fixture.jobs);
  expect(saved.runs).toEqual(fixture.runs);
  expect(saved.memos[0]).toEqual(fixture.memos[0]);
  expect(saved.memos).toHaveLength(invalid ? 1 : 2);
  expect(requests).toBe(0);
  await page.reload();
  expect(requests).toBe(0);
});
