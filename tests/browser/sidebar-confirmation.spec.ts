import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

type WorkerProbe = { messages: { type: string }[]; failRegistration: boolean };
const observations = new WeakMap<Page, { errors: string[]; external: string[] }>();

test.beforeEach(async ({ page }) => {
  const observed = { errors: [] as string[], external: [] as string[] };
  observations.set(page, observed);
  page.on("pageerror", error => observed.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") observed.errors.push(message.text()); });
  await page.route("https://**/*", route => { observed.external.push(route.request().url()); return route.abort(); });
  // Only the browser's registration boundary is synthetic. The production
  // PwaStatus component, blockers, writes, confirmation and update handler run.
  await page.addInitScript(() => {
    const probe: WorkerProbe = { messages: [], failRegistration: false };
    Object.defineProperty(window, "__sidebarWorkerProbe", { configurable: true, value: probe });
    const waiting = Object.assign(new EventTarget(), {
      state: "installed",
      postMessage(message: { type: string }) { probe.messages.push(message); },
    });
    const active = Object.assign(new EventTarget(), { state: "activated" });
    const registration = Object.assign(new EventTarget(), { waiting, active, installing: null, update: async () => {} });
    Object.defineProperties(navigator.serviceWorker, {
      register: { configurable: true, value: async () => registration },
      getRegistration: { configurable: true, value: async () => { if (probe.failRegistration) throw new Error("Synthetic registration unavailable"); return registration; } },
      ready: { configurable: true, get: () => Promise.resolve(registration) },
      controller: { configurable: true, get: () => active },
    });
  });
});

test.afterEach(async ({ page }, info) => {
  const observed = observations.get(page)!;
  await info.attach("observed-errors-and-external-requests", { body: JSON.stringify(observed), contentType: "application/json" });
  expect(observed.errors).toEqual([]);
  expect(observed.external).toEqual([]);
});

async function messages(page: Page) {
  return page.evaluate(() => (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe.messages);
}

test("collapsed update controls stay centered and describe their actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const sidebar = page.locator("aside.sidebar");
  const storage = sidebar.locator(".local-storage-icon");
  const opener = sidebar.getByRole("button", { name: "Open update confirmation", exact: true });
  const center = async (selector: typeof storage) => {
    const box = (await selector.boundingBox())!;
    return box.x + box.width / 2;
  };
  expect(Math.abs(await center(storage) - await center(opener.locator("svg")))).toBeLessThanOrEqual(1);
  await opener.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Update now");
  await opener.click();
  const confirm = sidebar.getByRole("button", { name: "Confirm update", exact: true });
  const cancel = sidebar.getByRole("button", { name: "Cancel", exact: true });
  await expect(confirm).toBeFocused();
  expect(Math.abs(await center(storage) - await center(confirm.locator("svg")))).toBeLessThanOrEqual(1);
  await expect(page.getByRole("tooltip")).toHaveText("Confirm update");
  await cancel.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Cancel");
  await cancel.click();
  await expect(opener).toBeFocused();
  expect(await messages(page)).toEqual([]);
});

test("maximum-text sidebar keeps confirmation and Cancel reachable after real wheel scrolling", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.setItem("meeting-memo:font-size", "xxlarge"));
  await page.goto("./");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const sidebar = page.locator(".sidebar"), controls = page.locator(".pwa-sidebar");
  await page.mouse.move(100, 280); await page.mouse.wheel(0, 1500);
  await expect.poll(() => sidebar.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const opener = controls.getByRole("button", { name: "Open update confirmation", exact: true });
  await opener.click();
  const confirm = controls.getByRole("button", { name: "Confirm update", exact: true });
  const cancel = controls.getByRole("button", { name: "Cancel", exact: true });
  await expect(confirm).toBeFocused();
  console.log(JSON.stringify({ engine: info.project.name, sidebar: await sidebar.boundingBox(), confirm: await confirm.boundingBox(), cancel: await cancel.boundingBox(), scroll: await sidebar.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight })) }));
  await page.screenshot({ path: info.outputPath("large-text-update-confirmation.png") });
  await expect(confirm).toBeInViewport(); await expect(cancel).toBeInViewport();
  for (const button of [confirm, cancel]) {
    const box = (await button.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(568);
  }
  expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await cancel.click();
  await expect(opener).toBeFocused(); expect(await messages(page)).toEqual([]);
  await expect(opener).toBeInViewport();
  await page.mouse.move(100, 280); await page.mouse.wheel(0, -2000);
  await expect.poll(() => sidebar.evaluate(element => element.scrollTop)).toBe(0);
});

test("sidebar confirmation stays at its anchored initiator and Cancel never activates", async ({ page }) => {
  await page.goto("./#/settings");
  await page.evaluate(() => window.scrollTo(0, 300));
  const sidebar = page.locator(".pwa-sidebar");
  const opener = sidebar.getByRole("button", { name: "Open update confirmation", exact: true });
  const before = (await opener.boundingBox())!;
  const scroll = await page.evaluate(() => window.scrollY);
  await opener.click();
  const confirm = sidebar.getByRole("button", { name: "Confirm update", exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeFocused();
  await expect(page.getByRole("button", { name: "Confirm update", exact: true })).toHaveCount(1);
  const after = (await confirm.boundingBox())!;
  expect(Math.abs(after.y + after.height - before.y - before.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThanOrEqual(1);
  expect(await messages(page)).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(sidebar.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await messages(page)).toEqual([]);
});

test("confirmation preserves bottom anchoring across language, rail, drawer and short-height states", async ({ page }, info) => {
  for (const view of [
    { width: 1440, height: 900, collapsed: false, language: "en" },
    { width: 768, height: 1024, collapsed: false, language: "zh-CN" },
    { width: 390, height: 844, collapsed: false, language: "en" },
    { width: 1280, height: 520, collapsed: false, language: "en" },
    { width: 1280, height: 520, collapsed: true, language: "zh-CN" },
    { width: 390, height: 520, collapsed: false, language: "zh-CN" },
  ]) {
    await page.setViewportSize(view);
    await page.goto("./#/settings");
    await page.locator(".topbar-language select").selectOption(view.language);
    const chinese = view.language === "zh-CN";
    if (view.width <= 760) {
      if (!await page.locator("aside.sidebar").evaluate(element => element.classList.contains("open"))) {
        await page.getByRole("button", { name: chinese ? "打开导航" : "Open navigation", exact: true }).click();
      }
    }
    else {
      const toggle = page.locator(".sidebar-toggle");
      if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      if (view.collapsed) await toggle.click();
    }
    const sidebar = page.locator("aside.sidebar");
    const controls = sidebar.locator(".pwa-sidebar");
    const opener = controls.getByRole("button", { name: chinese ? "打开更新确认" : "Open update confirmation", exact: true });
    const before = (await opener.boundingBox())!;
    await opener.click();
    const confirm = controls.getByRole("button", { name: chinese ? "确认更新" : "Confirm update", exact: true });
    await expect(confirm).toBeFocused();
    await expect(confirm).toBeVisible();
    const metrics = await confirm.evaluate(button => {
      const sidebar = button.closest("aside")!, parent = sidebar.getBoundingClientRect(), bounds = button.getBoundingClientRect();
      return { bottom: bounds.bottom, expected: parent.bottom - parseFloat(getComputedStyle(sidebar).paddingBottom), fits: sidebar.scrollHeight <= sidebar.clientHeight + 1 };
    });
    expect(Math.abs(metrics.bottom - before.y - before.height), JSON.stringify(view)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.bottom - metrics.expected), JSON.stringify(view)).toBeLessThanOrEqual(1);
    expect(metrics.fits, JSON.stringify(view)).toBe(true);
    const cancelBounds = (await controls.getByRole("button", { name: chinese ? "取消" : "Cancel", exact: true }).boundingBox())!;
    expect(cancelBounds.width).toBeGreaterThanOrEqual(44);
    expect(cancelBounds.height).toBeGreaterThanOrEqual(44);
    expect(await messages(page)).toEqual([]);
    if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath(`confirm-${view.width}x${view.height}-${view.collapsed ? "rail" : "expanded"}.png`) });
    await controls.getByRole("button", { name: chinese ? "取消" : "Cancel", exact: true }).click();
    await expect(opener).toBeFocused();
    expect(await messages(page)).toEqual([]);
  }
});

test("banner confirmation retains its own focus and never duplicates the sidebar confirmation", async ({ page }) => {
  await page.goto("./");
  const banner = page.locator(".notice.update");
  const opener = banner.getByRole("button", { name: "Update now", exact: true });
  await opener.click();
  await expect(banner.getByRole("button", { name: "Confirm update", exact: true })).toBeFocused();
  await expect(page.locator(".pwa-sidebar").getByRole("button", { name: "Confirm update", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm update", exact: true })).toHaveCount(1);
  await banner.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(opener).toBeFocused();
  expect(await messages(page)).toEqual([]);
});

test("sidebar blockers and registration failures stay local and confirmation rechecks drafts", async ({ page }, info) => {
  await page.goto("./#/settings");
  const controls = page.locator(".pwa-sidebar");
  const opener = controls.getByRole("button", { name: "Open update confirmation", exact: true });
  const model = page.getByLabel("Memo model ID");
  await model.fill("synthetic-unsaved-model");
  for (const tab of ["Storage", "About"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await opener.click();
    await expect(controls.getByRole("status")).toHaveText("Save your settings before updating.");
    expect(await messages(page)).toEqual([]);
  }
  await page.getByRole("tab", { name: "API & models", exact: true }).click();
  await expect(model).toHaveValue("synthetic-unsaved-model");
  await opener.click();
  await expect(controls.getByRole("status")).toHaveText("Save your settings before updating.");
  await expect(page.getByText("Save your settings before updating.", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Confirm update", exact: true })).toHaveCount(0);
  expect(await messages(page)).toEqual([]);
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved on this device", exact: true })).toBeVisible();
  await opener.click();
  await model.fill("second-unsaved-model");
  await controls.getByRole("button", { name: "Confirm update", exact: true }).click();
  await expect(controls.getByRole("status")).toHaveText("Save your settings before updating.");
  await expect(model).toHaveValue("second-unsaved-model");
  expect(await messages(page)).toEqual([]);
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved on this device", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe.failRegistration = true; });
  await opener.click();
  await controls.getByRole("button", { name: "Confirm update", exact: true }).click();
  const failure = "Update did not activate. Try again when connected.";
  await expect(controls.getByRole("status")).toHaveText(failure);
  await expect(page.getByText(failure, { exact: true })).toHaveCount(1);
  if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath("sidebar-failure-feedback.png") });
  expect(await messages(page)).toEqual([]);
  for (const viewport of [{ width: 1280, height: 520 }, { width: 390, height: 520 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width > 760) await page.locator(".sidebar-toggle").click();
    else if (!await page.locator("aside.sidebar").evaluate(element => element.classList.contains("open"))) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await expect(controls.getByRole("status")).toHaveText(failure);
    const geometry = await opener.evaluate(button => {
      const sidebar = button.closest("aside")!, rect = sidebar.getBoundingClientRect(), bounds = button.getBoundingClientRect();
      const feedback = sidebar.querySelector(".pwa-update-error")!.getBoundingClientRect();
      return { bottom: bounds.bottom, expected: rect.bottom - parseFloat(getComputedStyle(sidebar).paddingBottom), messageInside: feedback.top >= rect.top && feedback.bottom <= bounds.top };
    });
    expect(Math.abs(geometry.bottom - geometry.expected)).toBeLessThanOrEqual(1);
    expect(geometry.messageInside).toBe(true);
    await expect(controls.locator(".pwa-update-error > svg")).toBeVisible();
    if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath(`sidebar-failure-${viewport.width}x${viewport.height}.png`) });
  }
  await page.evaluate(() => { (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe.failRegistration = false; });
  await opener.click();
  expect(await messages(page)).toEqual([]);
  await controls.getByRole("button", { name: "Confirm update", exact: true }).click();
  await expect.poll(() => messages(page)).toEqual([{ type: "SKIP_WAITING" }]);
  await expect(opener).toBeDisabled();
});
