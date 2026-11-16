import {expect, test, type Page} from "@playwright/test";

test.use({serviceWorkers: "block"});
type CreationFixtureWindow = Window & {creationFixture?: {inputs: Set<Element>; readCompleted: boolean}};

async function installLifecycleProbe(page: Page) {
  await page.addInitScript(() => {
    const state = {inputs: new Set<Element>(), readCompleted: false};
    (window as CreationFixtureWindow).creationFixture = state;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('input[aria-label="Attach audio"]')) state.inputs.add(node);
        for (const input of node.querySelectorAll('input[aria-label="Attach audio"]')) state.inputs.add(input);
      }
    }).observe(document, {childList: true, subtree: true});
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(query) {
      const request = get.call(this, query);
      if (this.name === "meetings" && this.transaction.mode === "readonly") {
        // Delay only read delivery, never transaction writes or returned data.
        request.addEventListener("success", event => {
          event.stopImmediatePropagation();
          setTimeout(() => {
            request.dispatchEvent(new Event("success"));
            state.readCompleted = true;
          }, 200);
        }, {capture: true, once: true});
      }
      return request;
    };
  });
}

async function create(page: Page, title: string, fromWorkspace: boolean) {
  const scope = page.locator(fromWorkspace ? ".sidebar" : "main");
  await scope.getByRole("button", {name: /^(New meeting|Create your first meeting)$/}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title", {exact: true}).fill(title);
  await page.evaluate(() => {
    const state = (window as CreationFixtureWindow).creationFixture!;
    state.inputs.clear(); state.readCompleted = false;
  });
  await dialog.getByRole("button", {name: "Create meeting", exact: true}).click();
  await page.waitForFunction(() => (window as CreationFixtureWindow).creationFixture!.readCompleted);
  await expect(page.getByRole("heading", {name: title, exact: true, level: 1})).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const fromWorkspace of [false, true])
  test(`new meeting mounts one attachment owner from ${fromWorkspace ? "another meeting" : "the library"}`, async ({page}) => {
    await installLifecycleProbe(page);
    await page.goto("./");
    if (fromWorkspace) await create(page, "Existing local meeting", false);
    await create(page, "Stable local meeting", fromWorkspace);
    expect(await page.evaluate(() => (window as CreationFixtureWindow).creationFixture!.inputs.size)).toBe(1);
    const audio = Buffer.alloc(44 + 16000);
    audio.write("RIFF"); audio.writeUInt32LE(audio.length-8,4); audio.write("WAVEfmt ",8);
    audio.writeUInt32LE(16,16); audio.writeUInt16LE(1,20); audio.writeUInt16LE(1,22);
    audio.writeUInt32LE(8000,24); audio.writeUInt32LE(16000,28); audio.writeUInt16LE(2,32); audio.writeUInt16LE(16,34);
    audio.write("data",36); audio.writeUInt32LE(audio.length-44,40);
    await page.getByLabel("Attach audio", {exact: true}).setInputFiles({name: "created.wav", mimeType: "audio/wav", buffer: audio});
    await expect(page.locator(".recording-info")).toContainText("created.wav");
    await page.reload();
    await expect(page.getByRole("heading", {name: "Stable local meeting", exact: true, level: 1})).toBeVisible();
    await expect(page.locator(".recording-info")).toContainText("created.wav");
  });
