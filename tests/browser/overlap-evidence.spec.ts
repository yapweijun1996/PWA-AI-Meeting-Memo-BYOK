import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createMeeting, segment, validateMeeting } from "../../src/domain/model";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { syntheticMp3, wavFile } from "./helpers/synthetic-recording";

async function exportZip(page: Page) {
  await page.locator(".export-menu summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: /Full backup with audio|Meeting backup \(/}).click();
  const archive = unzipSync(await readFile((await (await download).path())!));
  return validateMeeting(JSON.parse(strFromU8(archive["meeting.json"]!)));
}

for (const kind of ["blob", "parts"] as const) {
  test(`restores source-bound overlap through offline playback and re-export (${kind})`, async ({page, context}) => {
    test.setTimeout(150_000);
    const unexpected: string[] = [];
    await context.route(/^https:\/\//, route => {unexpected.push(new URL(route.request().url()).host); return route.abort();});
    await page.goto("/PWA-AI-Meeting-Memo-BYOK/");
    const input = kind === "parts"
      ? {name:"synthetic-overlap.mp3", mimeType:"audio/mpeg", buffer:syntheticMp3()}
      : {name:"synthetic-overlap.wav", mimeType:"audio/wav", buffer:wavFile(8)};
    await page.getByRole("button", {name: "New meeting",exact:true}).last().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Meeting title").fill("Synthetic recording");
    await dialog.getByLabel("Audio recording").setInputFiles(input);
    await dialog.getByRole("button", {name:"Create meeting",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Synthetic recording",exact:true})).toBeVisible();
    const saved = await exportZip(page);
    const hash = saved.audio!.hash;
    expect(Boolean(saved.audio!.chunked)).toBe(kind === "parts");
    const speaker = {id:crypto.randomUUID(),name:"Assigned voice",confirmed:true,sourceLabels:[]};
    const fragments = [segment("Opening words.",[speaker.id],0,0.15), segment("An unattributed sentence.",[],0.15,2), segment("A human assigned these words.",[speaker.id],3,5),
      segment("This untouched statement has no overlap.",[],6,7)];
    const evidence = {source:"Synthetic overlap detector",audioSha256:hash,intervals:[{start:0.2,end:1.5},{start:4,end:4.5}]};
    const fixture = validateMeeting({...createMeeting(),title:"Overlap check",speakers:[speaker],segments:fragments,
      audio:{...saved.audio!,present:false,duration:saved.audio!.duration ?? 8,overlapEvidence:evidence}});
    const zip = Buffer.from(zipSync({"meeting.json":strToU8(JSON.stringify(fixture))}));
    page.once("dialog", dialog => void dialog.accept());
    await page.locator(".nav-file input").setInputFiles({name:"overlap-backup.zip",mimeType:"application/zip",buffer:zip});
    const heading = page.getByRole("heading",{name:"Overlap check (restored)",exact:true});
    await expect(heading).toBeVisible();
    await expect(page.getByText("Reattach source",{exact:true})).toBeVisible();
    await page.getByLabel("Attach audio",{exact:true}).setInputFiles(input);
    const slider = page.getByRole("slider",{name:"Playback position",exact:true});
    await expect(slider).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(heading).toBeVisible();
    await page.getByRole("tab",{name:/Transcript/}).click();
    await expect(page.locator(".transcript-list [data-overlap-evidence=unattributed]")).toContainText("words unattributed");
    await expect(page.locator(".transcript-list [data-overlap-evidence=attributed]")).toHaveText("Overlapping speech detected · Synthetic overlap detector");
    await expect(page.getByText("Both neighboring passages are Assigned voice.")).toBeVisible();
    await expect(page.locator("article").filter({hasText:"This untouched statement"}).locator("[data-overlap-evidence]")).toHaveCount(0);
    await page.getByRole("tab",{name:/Speakers/}).click();
    await page.getByRole("button",{name:"Playback mode",exact:true}).click();
    const seek = async (position: string) => {
      await slider.fill(position);
      await expect(slider).toHaveValue(position);
    };
    await seek("1");
    await expect(page.locator(".playback-current-content [data-overlap-evidence=unattributed]")).toContainText("Synthetic overlap detector");
    await page.getByRole("button",{name:"Immersive playback",exact:true}).click();
    const immersive = page.getByRole("dialog",{name:"Immersive playback",exact:true});
    await expect(immersive.locator("[data-overlap-evidence=unattributed]")).toBeVisible();
    await immersive.getByRole("button",{name:"Exit immersive",exact:true}).click();
    await seek("2");
    await expect(page.locator(".playback-current-content [data-overlap-evidence]")).toHaveCount(0);
    await seek("4");
    await expect(page.locator(".playback-current-content [data-overlap-evidence=attributed]")).toBeVisible();
    const exported = await exportZip(page);
    expect(exported.audio!.overlapEvidence).toEqual(evidence);
    expect(exported.segments).toEqual(fragments);
    expect(unexpected).toEqual([]);
  });
}
