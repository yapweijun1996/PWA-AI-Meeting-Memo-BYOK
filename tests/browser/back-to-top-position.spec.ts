import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`back to top clears a changing player at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("#/settings");
    await expect(page.getByRole("tab", { name: "Appearance" })).toBeVisible();
    await page.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "2000px";
      document.body.append(filler);
      window.scrollTo(0, 900);
    });
    const button = page.getByRole("button", { name: "Back to top" });
    await expect(button).toBeVisible();
    await page.evaluate(() => {
      const player = document.createElement("div");
      player.className = "audio-player";
      player.style.height = "130px";
      player.dataset.testid = "player-fixture";
      document.body.append(player);
    });
    const player = page.getByTestId("player-fixture");
    const assertClear = async () => {
      await expect.poll(async () => {
        const [buttonRect, playerRect] = await Promise.all([button.boundingBox(), player.boundingBox()]);
        return buttonRect && playerRect ? playerRect.y - (buttonRect.y + buttonRect.height) : -1;
      }).toBeGreaterThanOrEqual(10);
    };
    await assertClear();
    await player.evaluate((element) => { element.style.height = "190px"; });
    await assertClear();
    await player.evaluate((element) => element.remove());
    await expect.poll(() => button.evaluate((element) => element.style.bottom)).toBe("");
    await button.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(700);
  });
}

test("back to top clears the real meeting player", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("#/");
  await page.locator("main").getByRole("button", { name: /^(New meeting|Create your first meeting)$/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Player layout test");
  const wav = Buffer.alloc(8044);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(8000, 40);
  await dialog.getByLabel("Audio recording").setInputFiles({ name: "layout.wav", mimeType: "audio/wav", buffer: wav });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  const player = page.locator(".audio-player");
  await expect(player).toBeVisible();
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.style.height = "2000px";
    document.querySelector("main")!.append(filler);
    window.scrollTo(0, 900);
  });
  const button = page.getByRole("button", { name: "Back to top" });
  await expect(button).toBeVisible();
  await expect.poll(async () => {
    const [a, b] = await Promise.all([button.boundingBox(), player.boundingBox()]);
    return a && b ? b.y - (a.y + a.height) : -1;
  }).toBeGreaterThanOrEqual(10);
  await button.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(700);
});
