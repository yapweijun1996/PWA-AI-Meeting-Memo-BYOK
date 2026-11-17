import {paletteChoices} from "./helpers/appearance";
import {expect, test} from "@playwright/test";

test.use({serviceWorkers: "block"});

for (const palette of paletteChoices)
  test(`restores saved dark ${palette} before the application module executes`, async ({page}) => {
    await page.addInitScript(({palette}) => {
      localStorage.setItem("meeting-memo:theme", "dark");
      localStorage.setItem("meeting-memo:palette", palette);
    }, {palette});
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/assets\/index-[^/]+\.js$/, async route => {
      await gate;
      await route.continue();
    });
    try {
      await page.goto("./", {waitUntil: "commit"});
      await expect.poll(() => page.locator("html").evaluate(element => getComputedStyle(element).getPropertyValue("--bg-app").trim())).not.toBe("");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
      const colors = await page.evaluate(() => ({
        meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
        background: getComputedStyle(document.documentElement).getPropertyValue("--bg-app").trim(),
        appExecuted: !!document.querySelector("#root")?.children.length,
      }));
      expect(colors.background).toBe("#15191f");
      expect(colors.meta).toBe(colors.background);
      expect(colors.appExecuted).toBe(false);
    } finally { release(); }
    await expect(page.getByRole("heading", {name: /Your meetings/})).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });


for (const denied of [false, true])
  test(`early appearance falls back safely when storage is ${denied ? "denied" : "invalid"}`, async ({page}) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({denied}) => {
      if (denied) Object.defineProperty(window, "localStorage", {get: () => { throw new DOMException("Denied", "SecurityError"); }});
      else {
        localStorage.setItem("meeting-memo:theme", "unrecognised");
        localStorage.setItem("meeting-memo:palette", '<script id="injected">invalid</script>');
      }
    }, {denied});
    await page.goto("./");
    await expect(page.getByRole("heading", {name: /Your meetings/})).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-palette", "forest");
    await expect(page.locator("#injected")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
