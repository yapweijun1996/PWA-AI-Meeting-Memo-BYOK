import { nextKeyboardControl } from "./helpers/keyboard";
import {changeTopbarLanguage} from "./helpers/language";
import { expect, test, type Page, type Route } from "@playwright/test";
import { sampleMeeting, type Meeting } from "../../src/domain/model";
import { encodePcm16Wav } from "../../src/audio/wav";
import { chooseStandardMemo, memo, readPiMeeting, setup } from "./helpers/memo-pi";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

type WorkerProbe = {
  messages: { type: string }[];
  failRegistration: boolean;
  delayRegistration?: Promise<void>;
  releaseRegistration?: () => void;
  registrationRequested?: boolean;
  releaseFactWrite?: () => void;
  factWriteCommitted?: boolean;
  postedBeforeFactCommit?: boolean;
  releaseLocalPreparation?: () => void;
};
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
      postMessage(message: { type: string }) {
        probe.messages.push(message);
        if (probe.releaseFactWrite && !probe.factWriteCommitted) probe.postedBeforeFactCommit = true;
      },
    });
    const active = Object.assign(new EventTarget(), { state: "activated" });
    const registration = Object.assign(new EventTarget(), { waiting, active, installing: null, update: async () => {} });
    Object.defineProperties(navigator.serviceWorker, {
      register: { configurable: true, value: async () => registration },
      getRegistration: { configurable: true, value: async () => {
        if (probe.failRegistration) throw new Error("Synthetic registration unavailable");
        if (probe.delayRegistration) {
          probe.registrationRequested = true;
          await probe.delayRegistration;
        }
        return registration;
      } },
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

test("collapsed update controls stay centered and describe their actions", async ({ page, browserName }) => {
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
  await page.keyboard.press("Enter");
  const confirm = sidebar.getByRole("button", { name: "Confirm update", exact: true });
  const cancel = sidebar.getByRole("button", { name: "Cancel", exact: true });
  await expect(confirm).toBeFocused();
  // A delayed pointer exit from the collapsing sidebar must not dismiss a keyboard-owned tip.
  for (const trigger of [page.getByRole("button", { name: "Expand sidebar", exact: true }), confirm]) {
    await trigger.evaluate(element => {
      element.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body, pointerType: "mouse" }));
    });
    await expect(confirm).toHaveAttribute("aria-describedby", /app-tooltip/);
  }
  expect(Math.abs(await center(storage) - await center(confirm.locator("svg")))).toBeLessThanOrEqual(1);
  await expect(page.getByRole("tooltip")).toHaveText("Confirm update");
  await page.keyboard.press(nextKeyboardControl(browserName));
  await expect(cancel).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText("Cancel");
  await page.keyboard.press("Enter");
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

test("sidebar confirmation stays at its anchored initiator and Cancel never activates", async ({ page, browserName }) => {
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
  await page.keyboard.press(nextKeyboardControl(browserName));
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
    // Same-hash navigation retains the previous mobile drawer between matrix cases.
    const closeNavigation = page.getByRole("button", { name: /^(Close navigation|关闭导航)$/ });
    if (await closeNavigation.isVisible()) {
      const bounds = (await closeNavigation.boundingBox())!;
      await closeNavigation.click({ position: { x: bounds.width - 12, y: 12 } });
      await expect(page.locator("aside.sidebar")).not.toHaveClass(/\bopen\b/);
    }
    await changeTopbarLanguage(page, view.language);
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
    await controls.getByRole("button", { name: "Dismiss update message", exact: true }).click();
    await expect(controls.getByRole("status")).toBeEmpty();
    await expect(opener).toBeFocused();
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

for (const boundary of ["installation", "controller change"] as const) {
  test(`a transcript correction survives a late ${boundary} during update`, async ({ page }) => {
    await page.goto("./");
    await page.getByRole("button", { name: "How it works" }).click();
    await page.getByRole("button", { name: "Explore a synthetic example" }).click();
    const edit = page.getByRole("button", { name: "Edit passage", exact: true }).first();
    await expect(edit).toBeVisible();

    // The sidebar knows about the first worker. Confirmation may find a replacement installing.
    if (boundary === "installation") {
      await page.evaluate(async () => {
        const registration = (await navigator.serviceWorker.getRegistration())!;
        Object.assign(registration, { installing: registration.waiting, waiting: null });
      });
    }
    const controls = page.locator(".pwa-sidebar");
    const update = controls.getByRole("button", { name: "Open update confirmation" });
    const confirm = controls.getByRole("button", { name: "Confirm update" });
    await update.click();
    await confirm.click();
    await expect(update).toBeDisabled();
    if (boundary === "controller change") {
      await expect.poll(() => messages(page)).toEqual([{ type: "SKIP_WAITING" }]);
    }
    await edit.click();
    const draft = page.getByLabel("Transcript text");
    const correction = "Retain this unsaved transcript correction.";
    await draft.fill(correction);
    await page.evaluate(async phase => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      if (phase === "installation") {
        const worker = registration.installing!;
        Object.assign(registration, { installing: null, waiting: worker });
        worker.dispatchEvent(new Event("statechange"));
      } else {
        Object.assign(registration, { waiting: null });
        navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
      }
    }, boundary);

    if (boundary === "installation") expect(await messages(page)).toEqual([]);
    await expect(draft).toHaveValue(correction);
    await expect(controls.getByRole("status")).toHaveText("Save or close the open editor before updating.");
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByText(correction, { exact: true }).first()).toBeVisible();
    if (boundary === "controller change") await expect(update).toHaveText("Refresh page");
    await update.click();
    if (boundary === "installation") {
      await confirm.click();
      await expect.poll(() => messages(page)).toEqual([{ type: "SKIP_WAITING" }]);
    } else {
      await Promise.all([page.waitForEvent("domcontentloaded"), confirm.click()]);
      await expect(page.getByText(correction, { exact: true }).first()).toBeVisible();
      expect(await messages(page)).toEqual([]);
    }
  });
}

async function openFactReview(page: Page) {
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page.getByRole("button", { name: "Evidence Review" }).click();
  return page.getByRole("combobox", { name: "Fact status", exact: true });
}

async function seedFactReview(page: Page) {
  const meeting = sampleMeeting();
  const item = {
    id: crypto.randomUUID(), type: "decision" as const, text: "Keep the current invoice timing.",
    ownerId: null, dueDate: null, dueOriginal: null, review: "pending" as const,
    sources: [{ id: meeting.segments[4].id, revision: meeting.segments[4].revision }],
    factStatus: "proposed" as const,
  };
  meeting.memos = [{ id: crypto.randomUUID(), model: "fixture", createdAt: meeting.updatedAt,
    sourceRevision: meeting.revision, template: "decision", items: [item], originalItems: [item] }];
  await page.goto("./");
  await expect(page.locator(".loading-library")).toHaveCount(0);
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("meetings", "readwrite");
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.objectStore("meetings").add(value);
      });
    } finally { db.close(); }
  }, meeting);
  await page.goto(`./#/meetings/${meeting.id}`);
  await expect(await openFactReview(page)).toHaveValue("proposed");
  return meeting.id;
}

async function holdFactWrite(page: Page, meetingId: string) {
  await page.evaluate(async id => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    const factTransactions = new WeakSet<IDBTransaction>();
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase["transaction"]>) {
      const tx = transaction.apply(this, args);
      if (this.name === "meeting-memo-byok-v1" && tx.mode === "readwrite" && tx.objectStoreNames.contains("meetings")) {
        // Register before the app wraps the transaction and starts awaiting completion.
        tx.addEventListener("complete", () => {
          if (factTransactions.has(tx)) probe.factWriteCommitted = true;
        });
      }
      return tx;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: Meeting, ...args) {
      const request = put.call(this, value, ...args);
      if (this.name === "meetings" && value.id === id && value.memos[0].items[0].factStatus === "confirmed") {
        factTransactions.add(this.transaction);
      }
      return request;
    };
    window.addEventListener("beforeunload", () => {
      sessionStorage.setItem("reload-before-fact-commit", String(!probe.factWriteCommitted));
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Keep a real transaction open ahead of the application's write until the update boundary fires.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("meetings", "readwrite");
      const store = tx.objectStore("meetings");
      let held = true;
      probe.releaseFactWrite = () => { held = false; };
      tx.oncomplete = () => db.close();
      tx.onabort = () => reject(tx.error);
      const keep = () => {
        store.get(id).onsuccess = () => {
          resolve();
          if (held) keep();
        };
      };
      keep();
    });
  }, meetingId);
}

async function verifyLateFactWrite(page: Page, boundary: "installation" | "controller change" | "refresh lookup") {
  const meetingId = await seedFactReview(page);
  const banner = page.locator(".notice.update");
  if (boundary !== "controller change") {
    await page.evaluate(async phase => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      if (phase === "installation") {
        Object.assign(registration, { installing: registration.waiting, waiting: null });
      } else {
        Object.assign(registration, { waiting: null });
        navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
        const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
        probe.delayRegistration = new Promise<void>(resolve => { probe.releaseRegistration = resolve; });
      }
    }, boundary);
  }
  await banner.getByRole("button", { name: boundary === "refresh lookup" ? "Refresh page" : "Update now" }).click();
  await banner.getByRole("button", { name: "Confirm update" }).click();
  await expect(banner.getByRole("button", { name: "Updating…" })).toBeDisabled();
  if (boundary === "controller change") await expect.poll(() => messages(page)).toEqual([{ type: "SKIP_WAITING" }]);
  if (boundary === "refresh lookup") await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe.registrationRequested)).toBe(true);

  await holdFactWrite(page, meetingId);
  const fact = page.getByRole("combobox", { name: "Fact status", exact: true });
  await fact.selectOption("confirmed");
  await expect(fact).toBeDisabled();
  await expect(page.locator('dialog[open], [data-unsaved-edit="true"]')).toHaveCount(0);

  if (boundary === "installation") {
    await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      const worker = registration.installing!;
      Object.assign(registration, { installing: null, waiting: worker });
      worker.dispatchEvent(new Event("statechange"));
      (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe.releaseFactWrite!();
    });
    await expect.poll(() => messages(page)).toEqual([{ type: "SKIP_WAITING" }]);
    expect(await page.evaluate(() => (window as unknown as { __sidebarWorkerProbe: WorkerProbe })
      .__sidebarWorkerProbe.postedBeforeFactCommit)).toBeUndefined();
  }

  const reloaded = page.waitForEvent("domcontentloaded");
  await page.evaluate(async phase => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    if (phase === "refresh lookup") {
      probe.releaseRegistration!();
    } else {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      Object.assign(registration, { waiting: null });
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    }
    // Give an unsafe reload a chance to start while IndexedDB is still held.
    setTimeout(() => probe.releaseFactWrite!(), 150);
  }, boundary);
  await reloaded;
  expect(await page.evaluate(() => sessionStorage.getItem("reload-before-fact-commit"))).toBe("false");
  await expect(await openFactReview(page)).toHaveValue("confirmed");
  const [saved] = (await readPiMeeting(page)).memos;
  expect(saved.items[0].factStatus).toBe("confirmed");
  expect(saved.originalItems?.[0].factStatus).toBe("proposed");
}

for (const boundary of ["installation", "controller change", "refresh lookup"] as const) {
  test(`a late Fact status change commits before update ${boundary}`, ({ page }) => verifyLateFactWrite(page, boundary));
}

test.describe("touch viewport update", () => {
  test.use({ isMobile: true, hasTouch: true });
  test("a late Fact status change commits before the mobile update reload", async ({ page, browserName }) => {
    await page.setViewportSize(browserName === "webkit" ? { width: 390, height: 844 } : { width: 412, height: 915 });
    await verifyLateFactWrite(page, "controller change");
  });
  test("a confirmed Finish review survives the mobile update reload", async ({ page, browserName }) => {
    await page.setViewportSize(browserName === "webkit" ? { width: 390, height: 844 } : { width: 412, height: 915 });
    await verifyFinishReviewDuringUpdate(page);
  });
});

async function updateAfterSkipWaiting(page: Page) {
  const banner = page.locator(".notice.update");
  await banner.getByRole("button", { name: "Update now", exact: true }).click();
  await banner.getByRole("button", { name: "Confirm update", exact: true }).click();
  await expect.poll(() => messages(page)).toEqual([{ type: "SKIP_WAITING" }]);
}

for (const failAccept of [false, true]) {
  test(`a queued memo Accept ${failAccept ? "save failure keeps the page and allows retry" : "commits before update reload and can be reversed"}`, async ({ page }) => {
    const id = await seedFactReview(page);
    await updateAfterSkipWaiting(page);
    await holdFactWrite(page, id);
    await page.evaluate(({ id, failAccept }) => {
      let committed = false;
      const accepts = new WeakSet<IDBTransaction>();
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase["transaction"]>) {
        const tx = transaction.apply(this, args);
        // Observe completion before the app's transaction promise can trigger reload.
        tx.addEventListener("complete", () => { if (accepts.has(tx)) committed = true; });
        return tx;
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value: Meeting, ...args) {
        if (this.name === "meetings" && value.id === id && value.memos[0].items[0].review === "accepted") {
          IDBObjectStore.prototype.put = put;
          if (failAccept) throw new DOMException("Injected Accept write failure", "QuotaExceededError");
          accepts.add(this.transaction);
        }
        return put.call(this, value, ...args);
      };
      window.addEventListener("beforeunload", () => {
        sessionStorage.setItem("accept-committed-before-reload", String(committed));
      });
    }, { id, failAccept });
    const fact = page.getByRole("combobox", { name: "Fact status", exact: true });
    await fact.selectOption("confirmed");
    await expect(fact).toBeDisabled();
    await page.getByRole("button", { name: "✓ Accept", exact: true }).click();
    const reloaded = failAccept ? undefined : page.waitForEvent("domcontentloaded");
    await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      Object.assign(registration, { waiting: null });
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
      (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe.releaseFactWrite!();
    });
    if (failAccept) {
      await expect(page.getByText("Injected Accept write failure", { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem("accept-committed-before-reload"))).toBeNull();
      expect((await readPiMeeting(page)).memos[0].items[0]).toMatchObject({ review: "edited", factStatus: "confirmed" });
      await page.getByRole("button", { name: "✓ Accept", exact: true }).click();
    } else {
      await reloaded;
      expect(await page.evaluate(() => sessionStorage.getItem("accept-committed-before-reload"))).toBe("true");
      await openFactReview(page);
    }
    await expect.poll(async () => (await readPiMeeting(page)).memos[0].items[0]).toMatchObject({
      review: "accepted", factStatus: "confirmed",
    });
    await page.getByRole("button", { name: "Needs review", exact: true }).click();
    await expect.poll(async () => (await readPiMeeting(page)).memos[0].items[0].review).toBe("pending");
    expect((await readPiMeeting(page)).memos[0].originalItems?.[0]).toMatchObject({ review: "pending", factStatus: "proposed" });
  });
}

async function activateWhilePreparationIsHeld(page: Page) {
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __sidebarWorkerProbe: WorkerProbe })
    .__sidebarWorkerProbe.releaseLocalPreparation)).toBe(true);
  const reloaded = page.waitForEvent("domcontentloaded");
  await page.evaluate(async () => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    const registration = (await navigator.serviceWorker.getRegistration())!;
    Object.assign(registration, { waiting: null });
    window.addEventListener("beforeunload", () => {
      sessionStorage.setItem("reload-while-preparation-held", String(!!probe.releaseLocalPreparation));
    }, { once: true });
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    // Keep the preparation pending across the controllerchange task.
    setTimeout(() => {
      const release = probe.releaseLocalPreparation!;
      delete probe.releaseLocalPreparation;
      release();
    }, 150);
  });
  await reloaded;
  expect(await page.evaluate(() => sessionStorage.getItem("reload-while-preparation-held"))).toBe("false");
}

async function verifyFinishReviewDuringUpdate(page: Page) {
  await seedFactReview(page);
  await updateAfterSkipWaiting(page);
  await page.evaluate(() => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, data) => {
      crypto.subtle.digest = digest;
      await new Promise<void>(resolve => { probe.releaseLocalPreparation = resolve; });
      return digest(algorithm, data);
    };
  });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Finish review", exact: true }).click();
  await activateWhilePreparationIsHeld(page);
  await openFactReview(page);
  await expect(page.getByText(/Review session completed/)).toBeVisible();
  const [saved] = (await readPiMeeting(page)).memos;
  expect(saved.reviewCompletion).toMatchObject({ kind: "all", reviewed: 0, pending: 1 });
  expect(saved.items[0].review).toBe("pending");
}

test("a confirmed Finish review survives controller change before its digest completes", ({ page }) =>
  verifyFinishReviewDuringUpdate(page));

async function attachSyntheticRecording(page: Page) {
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles({
    name: "local-checksum.wav", mimeType: "audio/wav",
    buffer: Buffer.from(await encodePcm16Wav(new Float32Array(8000), 8000).arrayBuffer()),
  });
}

test("a recording attachment starts blocking reload before its checksum returns", async ({ page }) => {
  await seedFactReview(page);
  await updateAfterSkipWaiting(page);
  await page.evaluate(() => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message: unknown) {
      if (message instanceof File) {
        probe.releaseLocalPreparation = () => post.call(this, message);
      } else {
        post.call(this, message);
      }
    };
  });
  await attachSyntheticRecording(page);
  await activateWhilePreparationIsHeld(page);
  expect((await readPiMeeting(page)).audio).toMatchObject({ name: "local-checksum.wav", present: true });
});

async function holdFirstRecordingRead(page: Page) {
  await page.evaluate(() => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function() {
      Blob.prototype.arrayBuffer = read;
      await new Promise<void>(resolve => { probe.releaseLocalPreparation = resolve; });
      return read.call(this);
    };
  });
}

test("new and restored recordings keep original and corrected speaker evidence across confirmed updates", async ({ page }, info) => {
  await page.goto("./");
  await updateAfterSkipWaiting(page);
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  const title = "Synthetic recording and corrected voices";
  await dialog.getByLabel("Meeting title").fill(title);
  const source = sampleMeeting();
  source.runs = [{ id: crypto.randomUUID(), provider: "openai", model: "fixture",
    createdAt: source.createdAt, speakers: structuredClone(source.speakers), originalSegments: structuredClone(source.segments) }];
  const original = source.segments[0];
  source.history = [original];
  source.segments[0] = { ...original, revision: original.revision + 1, reviewed: true, speakerIds: [source.speakers[1].id] };
  await dialog.getByText("Start from a transcript instead").click();
  await dialog.getByLabel("Transcript", { exact: true }).fill(JSON.stringify(source));
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const buffer = Buffer.alloc(61000 * frame.length);
  for (let offset = 0; offset < buffer.length; offset += frame.length) frame.copy(buffer, offset);
  const audio = { name: "synthetic-import.mp3", mimeType: "audio/mpeg", buffer };
  await dialog.getByLabel("Audio recording").setInputFiles(audio);
  await holdFirstRecordingRead(page);
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe.releaseLocalPreparation)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await activateWhilePreparationIsHeld(page);
  const saved = await readPiMeeting(page);
  expect(saved.title).toBe(title);
  expect(saved.audio).toMatchObject({ name: "synthetic-import.mp3", present: true, chunked: { chunkCount: 2 } });
  expect(saved.segments[0]).toEqual(source.segments[0]);
  expect(saved.history).toEqual(source.history);
  expect(saved.runs).toEqual(source.runs);

  await page.getByText("Export", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Meeting backup (long audio not included)", exact: true }).click();
  const backup = info.outputPath("synthetic-recording.zip");
  await (await download).saveAs(backup);
  page.once("dialog", notice => notice.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles(backup);
  await expect(page.getByText(/audio missing on this device/)).toBeVisible();
  await updateAfterSkipWaiting(page);
  await holdFirstRecordingRead(page);
  await page.getByLabel("Attach audio", { exact: true }).setInputFiles(audio);
  await activateWhilePreparationIsHeld(page);
  await expect(page.getByText(/plays from 2 local parts/)).toBeVisible();
  const restored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const id = location.hash.split("/").at(-1)!;
    try {
      const tx = db.transaction(["meetings", "audioChunks"]);
      const record = new Promise<Meeting>(resolve => {
        const request = tx.objectStore("meetings").get(id);
        request.onsuccess = () => resolve(request.result);
      });
      const chunkCount = new Promise<number>(resolve => {
        const request = tx.objectStore("audioChunks").count(IDBKeyRange.bound([id, 0], [id, Infinity]));
        request.onsuccess = () => resolve(request.result);
      });
      return { meeting: await record, chunks: await chunkCount };
    } finally { db.close(); }
  });
  expect(restored.chunks).toBe(2);
  expect(restored.meeting.audio).toEqual(saved.audio);
  expect(restored.meeting.segments[0]).toEqual(source.segments[0]);
  expect(restored.meeting.history).toEqual(source.history);
  expect(restored.meeting.runs).toEqual(source.runs);
});

test("a failed new recording save keeps its draft and a successful retry can update", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "New meeting", exact: true }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill("Retry imported recording");
  await dialog.getByText("Start from a transcript instead").click();
  await dialog.getByLabel("Transcript", { exact: true }).fill("A: A synthetic passage");
  await dialog.getByLabel("Audio recording").setInputFiles({
    name: "synthetic-retry.wav", mimeType: "audio/wav",
    buffer: Buffer.from(await encodePcm16Wav(new Float32Array(8000), 8000).arrayBuffer()),
  });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...keys) {
      if (this.name === "meetings") {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("Synthetic meeting write failure", "QuotaExceededError");
      }
      return put.call(this, value, ...keys);
    };
  });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Synthetic meeting write failure");
  await expect(dialog.getByLabel("Meeting title")).toHaveValue("Retry imported recording");
  await expect(dialog.locator("textarea").first()).toHaveValue("A: A synthetic passage");
  await expect(dialog.getByLabel("Audio recording")).toHaveValue(/synthetic-retry.wav$/);
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(page.getByRole("heading", { name: "Retry imported recording" })).toBeVisible();
  const saved = await readPiMeeting(page);
  expect(saved.audio?.present).toBe(true);
  expect(saved.segments[0].text).toBe("A synthetic passage");
  await updateAfterSkipWaiting(page);
});

test("confirmed voice analysis blocks update reload while loading its local meeting", async ({ page }) => {
  const id = await seedFactReview(page);
  await attachSyntheticRecording(page);
  await expect(page.locator(".recording-info")).toContainText("local-checksum.wav");
  await updateAfterSkipWaiting(page);
  await page.evaluate(meetingId => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(query) {
      const request = get.call(this, query);
      if (this.name === "meetings" && this.transaction.mode === "readonly" && query === meetingId) {
        IDBObjectStore.prototype.get = get;
        request.addEventListener("success", event => {
          event.stopImmediatePropagation();
          probe.releaseLocalPreparation = () => request.dispatchEvent(new Event("success"));
        }, { capture: true, once: true });
      }
      return request;
    };
  }, id);
  await page.getByRole("button", { name: "Auto-match voices", exact: true }).click();
  // A WAV is rejected by the actual local analyzer before it can download a model.
  await page.getByRole("button", { name: "Download and analyze locally", exact: true }).click();
  await activateWhilePreparationIsHeld(page);
});

async function failOrdinaryFactSave(page: Page, id: string) {
  await page.evaluate(meetingId => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: Meeting, ...args) {
      if (this.name === "meetings" && value.id === meetingId) {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("Synthetic ordinary meeting save failure", "QuotaExceededError");
      }
      return put.call(this, value, ...args);
    };
  }, id);
  await page.getByRole("combobox", { name: "Fact status", exact: true }).selectOption("confirmed");
  await expect(page.getByText("Synthetic ordinary meeting save failure", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Fact status", exact: true })).toHaveValue("proposed");
}

async function deleteFromWorkspace(page: Page) {
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete meeting", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your meetings." })).toBeVisible();
}

test("a confirmed meeting deletion commits before controller change reloads the page", async ({ page }) => {
  const id = await seedFactReview(page);
  await updateAfterSkipWaiting(page);
  await holdFactWrite(page, id);
  await page.evaluate(() => {
    const probe = (window as unknown as { __sidebarWorkerProbe: WorkerProbe }).__sidebarWorkerProbe;
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(query) {
      if (this.name === "meetings") probe.releaseLocalPreparation = probe.releaseFactWrite;
      return remove.call(this, query);
    };
  });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete meeting", exact: true }).click();
  await activateWhilePreparationIsHeld(page);
  await expect(page.getByRole("heading", { name: "Your meetings." })).toBeVisible();
  await expect(page.getByText("ERP workflow discovery", { exact: true })).toHaveCount(0);
});

test("confirmed local deletion releases the failed meeting save update guard", async ({ page }) => {
  const id = await seedFactReview(page);
  await failOrdinaryFactSave(page, id);
  const banner = page.locator(".notice.update");
  await banner.getByRole("button", { name: "Update now" }).click();
  await banner.getByRole("button", { name: "Confirm update" }).click();
  await expect(page.getByText(/Resolve the local save error before updating/)).toBeVisible();
  expect(await messages(page)).toEqual([]);
  await deleteFromWorkspace(page);
  await updateAfterSkipWaiting(page);
});

test("confirmed deletion in another tab releases the failed save guard for a clean workspace", async ({ page, context }) => {
  const id = await seedFactReview(page);
  await failOrdinaryFactSave(page, id);
  const other = await context.newPage();
  await other.goto(page.url());
  await deleteFromWorkspace(other);
  await expect(page.locator(".meeting-heading")).toHaveCount(0);
  await expect(page.getByText("Choose a meeting from your library.")).toBeVisible();
  await updateAfterSkipWaiting(page);
});

test("confirmed deletion in another tab keeps an open transcript draft until the user closes it", async ({ page, context }) => {
  const id = await seedFactReview(page);
  await failOrdinaryFactSave(page, id);
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByRole("button", { name: "Edit passage", exact: true }).first().click();
  const draft = page.getByLabel("Transcript text");
  await draft.fill("A local draft that can still be copied.");
  const other = await context.newPage();
  await other.goto(page.url());
  await deleteFromWorkspace(other);
  await expect(page.locator(`.sidebar a[href="#/meetings/${id}"]`)).toHaveCount(0);
  await expect(draft).toHaveValue("A local draft that can still be copied.");
  await page.keyboard.press("Escape");
  await expect(draft).toHaveCount(0);
  await expect(page.getByText("Choose a meeting from your library.")).toBeVisible();
  await updateAfterSkipWaiting(page);
});

test("an acknowledged orphan receipt no longer blocks a confirmed update", async ({ page, context }) => {
  await setup(page);
  let request: Route | undefined;
  await page.route("https://api.openai.com/v1/responses", route => { request = route; });
  await page.getByRole("button", { name: "Generate meeting notes", exact: true }).first().click();
  const confirmation = page.getByRole("dialog");
  await chooseStandardMemo(confirmation);
  await confirmation.getByRole("checkbox", { name: /I understand the selected data/ }).check();
  await confirmation.getByRole("button", { name: "Generate new notes", exact: true }).click();
  await expect.poll(() => !!request).toBe(true);
  const meeting = await readPiMeeting(page);
  await page.evaluate(({ meetingId, jobId }) => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: Meeting, ...args) {
      if (this.name === "meetings" && value.id === meetingId && value.jobs.some(job => job.id === jobId)) {
        const count = Number(sessionStorage.getItem("rejected-receipt-writes"));
        sessionStorage.setItem("rejected-receipt-writes", String(count + 1));
        throw new DOMException("Synthetic receipt storage failure", "QuotaExceededError");
      }
      return put.call(this, value, ...args);
    };
  }, { meetingId: meeting.id, jobId: meeting.jobs[0].id });
  const meetingUrl = page.url();
  await page.getByRole("link", { name: "All meetings", exact: true }).click();
  await request!.fulfill({ json: { id: "orphan-response", status: "completed", output: [memo(meeting.segments[0].id)] } });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("rejected-receipt-writes"))).toBe("2");

  const other = await context.newPage();
  await other.goto(meetingUrl);
  other.once("dialog", dialog => dialog.accept());
  await other.getByRole("button", { name: "Delete meeting", exact: true }).click();
  await expect(other.getByRole("heading", { name: "Your meetings." })).toBeVisible();
  const recovery = page.getByRole("alert", { name: "Unsaved review response" });
  const banner = page.locator(".notice.update");
  await expect(recovery).toBeVisible();
  await banner.getByRole("button", { name: "Update now" }).click();
  await expect(page.getByText("Save or export the unsaved review response before updating.")).toBeVisible();
  expect(await messages(page)).toEqual([]);
  const downloaded = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "Export unsaved response" }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8")).job.memoResponse).toContain("orphan-response");
  await recovery.getByRole("button", { name: /release this page copy/ }).click();
  await expect(recovery).toHaveCount(0);
  await banner.getByRole("button", { name: "Update now" }).click();
  await banner.getByRole("button", { name: "Confirm update" }).click();
  await expect.poll(() => messages(page)).toEqual([{ type: "SKIP_WAITING" }]);
});
