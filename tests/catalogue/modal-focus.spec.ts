import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { build } from "vite";

let fixtureCode: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: path.resolve("vite.catalogue.config.ts"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: { entry: path.resolve("tests/catalogue/modal-focus-fixture.tsx"), formats: ["es"] },
      rollupOptions: { input: path.resolve("tests/catalogue/modal-focus-fixture.tsx") },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  expect(outputs).toHaveLength(1);
  const bundle = outputs[0];
  if (!("output" in bundle)) throw new Error("Expected an in-memory fixture bundle");
  const scripts = bundle.output.filter(output => output.type === "chunk");
  expect(scripts).toHaveLength(1);
  fixtureCode = scripts[0].code;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/__modal-focus-fixture__/**", route => route.fulfill({
    contentType: route.request().url().endsWith(".js") ? "text/javascript" : "text/html",
    body: route.request().url().endsWith(".js") ? fixtureCode : '<!doctype html><html lang="en"><title>Modal focus fixture</title><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>',
  }));
  await page.goto("/__modal-focus-fixture__/");
});

async function open(page: Page, name: string) {
  const opener = page.getByRole("button", { name: `Open ${name}`, exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
  return opener;
}

test("StrictMode replay preserves initial focus and restores the opener across reopen and button close", async ({ page }) => {
  const opener = await open(page, "basic");
  await expect(page.getByRole("button", { name: "Initial control", exact: true })).toBeFocused();
  await expect.poll(() => page.locator("body").getAttribute("data-effect-setups")).toBe("2");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Initial control", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("explicit caller focus wins over the shared fallback", async ({ page }) => {
  await open(page, "explicit");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Caller focus target" })).toBeFocused();
});

for (const name of ["removed", "replaced"]) {
  test(`does not focus a ${name} opener or its replacement`, async ({ page }) => {
    const opener = await open(page, name);
    const original = await opener.elementHandle();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => original!.evaluate(element => element.isConnected)).toBe(false);
    // Observe after the fallback frame, without assigning any competing focus.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator("body")).toBeFocused();
    if (name === "replaced") await expect(opener).not.toBeFocused();
  });
}

test("replacement dialog owns focus while the previous modal unmounts", async ({ page }) => {
  await open(page, "transition");
  await page.getByRole("button", { name: "Replace dialog" }).click();
  await expect(page.getByRole("dialog", { name: "transition", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "replacement", exact: true }).getByRole("button", { name: "Initial control" })).toBeFocused();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("dialog", { name: "replacement", exact: true }).getByRole("button", { name: "Initial control" })).toBeFocused();
});

test("topmost sibling modal returns to the still-open outer dialog before its opener", async ({ page }) => {
  const opener = await open(page, "outer");
  const innerOpener = page.getByRole("button", { name: "Open inner" });
  await expect(innerOpener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Inner initial control" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "inner", exact: true })).toHaveCount(0);
  await expect(innerOpener).toBeFocused();
  await page.getByRole("dialog", { name: "outer", exact: true }).getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});
