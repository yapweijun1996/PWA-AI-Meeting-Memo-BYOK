import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

async function seed(page: Page, titles: string[]) {
  await page.goto("./");
  await expect(page.locator(".sidebar-recent")).toBeVisible();
  const meetings = titles.map(title => ({ ...sampleMeeting(), id: crypto.randomUUID(), title }));
  await page.evaluate(async items => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("meeting-memo-byok-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("meetings", "readwrite");
      items.forEach(item => tx.objectStore("meetings").put(item));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), meetings);
}

async function rectangles(page: Page, selector: string) {
  return page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, height: rect.height };
  }));
}

test("storage cards pack naturally as the report grows and the viewport changes", async ({ page }, info) => {
  await page.route("https://**/*", route => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, ["Synthetic storage fixture"]);
  await page.goto("./#/settings");
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await expect(page.locator(".settings-grid")).toHaveClass(/\bmasonry\b/);
  const cards = ".settings-grid > .settings-panel";
  const monitor = page.getByRole("region", { name: "Storage monitor" });
  await monitor.getByRole("button", { name: "Scan storage" }).click();
  await expect(monitor.getByRole("button", { name: "Scan again" })).toBeVisible();
  await expect.poll(async () => {
    const [local, report, speaker] = await rectangles(page, cards);
    return Math.abs(local.left - speaker.left) < 1 && Math.abs(local.top - report.top) < 1
      && speaker.top >= local.bottom + 19 && speaker.top <= local.bottom + 25;
  }).toBe(true);
  const before = await rectangles(page, cards);
  expect(before[1].height).toBeGreaterThan(before[0].height);
  await monitor.getByText("What is in the meeting document").click();
  await expect(monitor.getByText("Transcript passages")).toBeVisible();
  await expect.poll(async () => (await rectangles(page, cards))[1].height).toBeGreaterThan(before[1].height);
  await expect.poll(async () => {
    const [local, , speaker] = await rectangles(page, cards);
    return speaker.top - local.bottom;
  }).toBeLessThanOrEqual(25);
  await page.screenshot({ path: info.outputPath("storage-masonry-desktop.png") });
  expect((await new AxeBuilder({ page }).include(".settings-grid").analyze()).violations).toEqual([]);

  for (const width of [1020, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const [local, report, speaker] = await rectangles(page, cards);
      if (width <= 390) return Math.abs(local.left - report.left) < 1 && report.top >= local.bottom + 15
        && Math.abs(report.left - speaker.left) < 1 && speaker.top >= report.bottom + 15 && speaker.top <= report.bottom + 21;
      return Math.abs(local.left - speaker.left) < 1 && speaker.top >= local.bottom + 19 && speaker.top <= local.bottom + 25;
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.fontSize = "xxlarge"; });
  await expect.poll(async () => {
    const [local, , speaker] = await rectangles(page, cards);
    return speaker.top >= local.bottom + 19 && speaker.top <= local.bottom + 25;
  }).toBe(true);
});

test("library cards share masonry behavior without changing sort or keyboard order", async ({ page, browserName }) => {
  await page.route("https://**/*", route => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  const titles = ["A short", "B " + "long meeting title ".repeat(6), "C short", "D short"];
  await seed(page, titles);
  await page.reload();
  await expect(page.locator(".meeting-grid")).toHaveClass(/\bmasonry\b/);
  await page.getByRole("combobox", { name: "Sort meetings" }).selectOption("title");
  await expect(page.locator(".meeting-card h3")).toHaveText(titles.map(title => title.trim()));
  const cards = ".meeting-grid > .meeting-card";
  await expect.poll(async () => {
    const [first, second, , fourth] = await rectangles(page, cards);
    return second.height > first.height + 20 && Math.abs(fourth.left - first.left) < 1
      && fourth.top >= first.bottom + 15 && fourth.top <= first.bottom + 21;
  }).toBe(true);
  await page.locator(cards).first().focus();
  await page.keyboard.press(browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
  await expect(page.locator(cards).nth(1)).toBeFocused();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(async () => {
    const boxes = await rectangles(page, cards);
    return boxes.every((box, index) => index === 0 || (box.top >= boxes[index - 1].bottom + 11 && box.top <= boxes[index - 1].bottom + 17));
  }).toBe(true);
  await page.getByRole("textbox", { name: "Search meetings" }).fill("short");
  await expect(page.locator(cards)).toHaveCount(3);
});

test("storage masonry adapts without ResizeObserver", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "ResizeObserver", { value: undefined, configurable: true }); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, ["Fallback fixture"]);
  await page.goto("./#/settings");
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  const monitor = page.getByRole("region", { name: "Storage monitor" });
  await monitor.getByRole("button", { name: "Scan storage" }).click();
  await expect(monitor.getByRole("button", { name: "Scan again" })).toBeVisible();
  await expect.poll(async () => {
    const [local, report, speaker] = await rectangles(page, ".settings-grid > .settings-panel");
    return report.height > local.height && speaker.top >= local.bottom + 19 && speaker.top <= local.bottom + 25;
  }).toBe(true);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(async () => {
    const [, report, speaker] = await rectangles(page, ".settings-grid > .settings-panel");
    return speaker.top >= report.bottom + 15 && speaker.top <= report.bottom + 21;
  }).toBe(true);
});

test("a long storage report remains contained without stretching neighboring cards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, Array.from({ length: 50 }, (_, index) => `Synthetic meeting ${index + 1}`));
  await page.goto("./#/settings");
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  const monitor = page.getByRole("region", { name: "Storage monitor" });
  await monitor.getByRole("button", { name: "Scan storage" }).click();
  await expect(monitor.locator(".storage-meetings > li")).toHaveCount(50);
  await expect.poll(async () => {
    const [local, report, speaker] = await rectangles(page, ".settings-grid > .settings-panel");
    const grid = (await rectangles(page, ".settings-grid"))[0];
    return report.height > 5000 && grid.bottom >= report.bottom && speaker.top >= local.bottom + 19
      && speaker.top <= local.bottom + 25 && report.left >= local.right;
  }).toBe(true);
});
