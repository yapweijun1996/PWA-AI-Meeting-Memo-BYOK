import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const title = "Synthetic recovery rehearsal";
const correction = "Preserve the local correction.";

async function visibleBuild(page, release) {
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page.getByRole("tab", { name: "About", exact: true }).click();
  const label = await page.getByRole("tabpanel", { name: "About" }).getByText(/^Build /).innerText();
  const build = label.replace(/^Build /, "");
  assert.match(build, /^[a-zA-Z0-9._-]{1,128}$/);
  const source = await readFile(release.directory + "/" + release.entry.slice(release.base.length), "utf8");
  assert(['"', "'", "`"].some(quote => source.includes(quote + build + quote)), "Displayed build must identify the loaded entry module");
  return build;
}

async function backup(page) {
  await page.getByText("Export", { exact: true }).click();
  // Older releases label every ZIP as a full backup, including transcript-only meetings.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^(?:Meeting backup \(no audio\)|Full backup with audio)$/ }).click(),
  ]);
  const path = await download.path();
  const entries = unzipSync(await readFile(path));
  return { path, meeting: JSON.parse(strFromU8(entries["meeting.json"])) };
}

async function inspectReceipt(page) {
  const history = page.locator(".history-panel");
  await history.locator("summary").click();
  const row = history.locator(".job-entry");
  await expect(row).toHaveCount(1);
  await expect(row.locator("strong")).toHaveText("Memo · outcome unknown");
  await expect(row).toContainText(/billing:\s*possibly charged/);
  await expect(row).toContainText("Check your provider account before retrying.");
}

// The worker controls the page. Intercept fetch in the page itself so the
// synthetic submission cannot pass through WebKit's worker routing.
export async function installRecoveryInterceptor(context) {
  await context.addInitScript(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const target = new globalThis.URL(input?.url ?? String(input), globalThis.location.href);
      if (target.origin === globalThis.location.origin || target.protocol === "blob:") return original(input, init);
      if (target.href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        const count = Number(globalThis.sessionStorage.getItem("rehearsal-attempts")) || 0;
        globalThis.sessionStorage.setItem("rehearsal-attempts", String(count + 1));
      }
      return Promise.reject(new TypeError("Synthetic connection closed"));
    };
  });
}

export async function prepareRecoveryMeeting(page, release, url) {
  const build = await visibleBuild(page, release);
  await page.goto(url);
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill(title);
  await dialog.getByText("Start from a transcript instead").click();
  await dialog.getByLabel("Transcript", { exact: true }).fill("A: Preserve the initial passage.");
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const meetingUrl = page.url();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page.getByRole("button", { name: "Edit passage", exact: true }).click();
  await page.getByLabel("Transcript text").fill(correction);
  await page.getByRole("button", { name: "Save correction" }).click();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: "Generate meeting notes", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /Use selective transcript review/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /I understand the selected data/ }).check();
  await dialog.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check your provider account before retrying.");
  await inspectReceipt(page);
  const archive = await backup(page);
  assert.equal(archive.meeting.jobs.length, 1);
  const [job] = archive.meeting.jobs;
  assert.deepEqual([job.stage, job.state, job.billing], ["memo", "outcome_unknown", "possibly_charged"]);
  await page.goto(url);
  return { build, meetingUrl, archive };
}

export async function verifyForwardRecovery(page, release, fixture) {
  const build = await visibleBuild(page, release);
  assert.notEqual(build, fixture.build, "The replacement must show its own build identity");
  await page.goto(fixture.meetingUrl);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText(correction, { exact: true })).toBeVisible();
  await inspectReceipt(page);
  const current = await backup(page);
  for (const field of ["id", "schemaVersion", "revision", "segments", "history", "jobs"]) {
    assert.deepEqual(current.meeting[field], fixture.archive.meeting[field], `Forward recovery changed ${field}`);
  }
  page.once("dialog", dialog => void dialog.accept());
  await page.locator(".nav-file input").setInputFiles({
    name: "synthetic-release-backup.zip", mimeType: "application/zip", buffer: await readFile(fixture.archive.path),
  });
  await expect(page.getByRole("heading", { name: title + " (restored)", exact: true })).toBeVisible();
  assert.notEqual(page.url(), fixture.meetingUrl);
  await expect(page.getByText(correction, { exact: true })).toBeVisible();
  await inspectReceipt(page);
  const restored = await backup(page);
  assert.notEqual(restored.meeting.id, current.meeting.id);
  for (const field of ["schemaVersion", "revision", "segments", "history", "jobs"]) {
    assert.deepEqual(restored.meeting[field], fixture.archive.meeting[field], `Restore changed ${field}`);
  }
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: "Generate meeting notes", exact: true }).click();
  const retry = page.getByRole("dialog");
  await retry.getByRole("checkbox", { name: /I understand the selected data/ }).check();
  await expect(retry.getByRole("checkbox", { name: /I reviewed the previous request outcome and billing/ })).not.toBeChecked();
  await expect(retry.getByRole("button", { name: "Generate new notes", exact: true })).toBeDisabled();
  await retry.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.sessionStorage.getItem("rehearsal-attempts")), "1");
  return build;
}
