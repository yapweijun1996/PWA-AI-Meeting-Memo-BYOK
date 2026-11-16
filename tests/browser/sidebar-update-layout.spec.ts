import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("keeps the update button at the sidebar bottom before and after feedback", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900, collapsed: false },
    { width: 1280, height: 520, collapsed: false },
    { width: 1280, height: 520, collapsed: true },
    { width: 768, height: 1024, collapsed: false },
    { width: 390, height: 844, collapsed: false },
    { width: 390, height: 520, collapsed: false },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("./");
    if (viewport.width <= 760) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    else {
      const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
      if (await expand.isVisible()) await expand.click();
      if (viewport.collapsed) await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    }
    const sidebar = page.locator("aside.sidebar");
    await sidebar.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined))); });
    await page.evaluate(() => {
      const recent = document.querySelector(".sidebar-recent")!;
      let list = recent.querySelector(".sidebar-recent-list");
      if (!list) { list = document.createElement("div"); list.className = "sidebar-recent-list"; recent.append(list); }
      for (let index = 0; index < 12; index++) { const link = document.createElement("a"); link.href = "#/"; link.textContent = `Synthetic recent meeting ${index + 1}`; list.append(link); }
    });
    const update = sidebar.getByRole("button", { name: "Check for updates", exact: true });
    const geometry = () => update.evaluate(button => {
      const sidebar = button.closest("aside")!;
      const outer = sidebar.getBoundingClientRect(), bounds = button.getBoundingClientRect();
      return { bottom: bounds.bottom, expectedBottom: outer.bottom - parseFloat(getComputedStyle(sidebar).paddingBottom), top: bounds.top, sidebarTop: outer.top, sidebarBottom: outer.bottom, noSidebarOverflow: sidebar.scrollHeight <= sidebar.clientHeight + 1 };
    });
    const before = await geometry();
    expect(Math.abs(before.bottom - before.expectedBottom), `${viewport.width}x${viewport.height} initial bottom`).toBeLessThanOrEqual(1);
    expect(before.noSidebarOverflow).toBe(true);
    await update.click();
    const feedback = sidebar.getByRole("status");
    await expect(feedback).toContainText(/unavailable|Could not check/);
    await expect(feedback).toBeVisible();
    const after = await geometry();
    expect(Math.abs(after.bottom - before.bottom), `${viewport.width}x${viewport.height} feedback bottom`).toBeLessThanOrEqual(1);
    expect(after.noSidebarOverflow).toBe(true);
    const message = (await feedback.boundingBox())!;
    expect(message.y).toBeGreaterThanOrEqual(after.sidebarTop);
    expect(message.y + message.height).toBeLessThanOrEqual(after.top);
    expect(after.bottom).toBeLessThanOrEqual(after.sidebarBottom);
    const list = sidebar.locator(".sidebar-recent-list");
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await sidebar.evaluate(element => element.scrollTop)).toBe(0);
    expect(Math.abs((await geometry()).bottom - before.bottom)).toBeLessThanOrEqual(1);
  }
});
