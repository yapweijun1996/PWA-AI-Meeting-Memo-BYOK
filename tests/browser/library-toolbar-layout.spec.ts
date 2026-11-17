import { expect, test } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

for (const language of ["en", "zh-CN"] as const) {
  test("library toolbar stays usable at different widths and font sizes (" + language + ")", async ({ page }, info) => {
    await page.route("https://**/*", route => route.abort());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("./");
    await expect(page.getByText("Your next good conversation starts here", { exact: true })).toBeVisible();
    const alpha = sampleMeeting();
    alpha.title = "Alpha workshop";
    const zeta = sampleMeeting();
    zeta.title = "Zeta roadmap";
    zeta.memos = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceRevision: zeta.revision, model: "synthetic", items: [], originalItems: [] }];
    await page.evaluate(async (meetings) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("meeting-memo-byok-v1");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("meetings", "readwrite");
        for (const meeting of meetings) tx.objectStore("meetings").put(meeting);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), [alpha, zeta]);
    await page.reload();
    await expect(page.locator(".meeting-card")).toHaveCount(2);
    await page.locator(".topbar-language select").selectOption(language);
    const chinese = language === "zh-CN";
    await page.getByRole("button", { name: chinese ? "收起侧边栏" : "Collapse sidebar", exact: true }).click();
    await page.mouse.move(1, 1);
    const toolbar = page.locator(".library-toolbar");
    const group = toolbar.getByRole("group", { name: chinese ? "筛选会议" : "Filter meetings" });
    const search = toolbar.getByRole("textbox", { name: chinese ? "搜索会议" : "Search meetings" });
    const sort = toolbar.getByRole("combobox", { name: chinese ? "排序会议" : "Sort meetings" });
    for (const view of [
      { width: 1440, font: "normal" }, { width: 1040, font: "normal" },
      { width: 768, font: "normal" }, { width: 390, font: "normal" },
      { width: 320, font: "normal" }, { width: 768, font: "xxlarge" },
      { width: 390, font: "xxlarge" }, { width: 320, font: "xxlarge" },
    ]) {
      await page.setViewportSize({ width: view.width, height: 900 });
      await page.evaluate(font => {
        localStorage.setItem("meeting-memo:font-size", font);
        window.dispatchEvent(new StorageEvent("storage", { key: "meeting-memo:font-size" }));
      }, view.font);
      const geometry = await toolbar.evaluate(element => {
        const box = (selector: string) => {
          const rect = element.querySelector(selector)!.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, center: rect.top + rect.height / 2 };
        };
        return { filter: box(".filter-row"), search: box(".search"), sort: box(".sort-control") };
      });
      console.log(JSON.stringify({ language, ...view, ...geometry }));
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
        console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("body *")]
          .filter(node => node.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12)
          .map(node => ({ tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right, text: node.textContent?.slice(0, 50) })))));
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const item of Object.values(geometry)) {
        expect(item.left).toBeGreaterThanOrEqual(0);
        expect(item.right).toBeLessThanOrEqual(view.width + 1);
      }
      if (view.font === "normal" && view.width >= 1040) {
        expect(Math.abs(geometry.filter.center - geometry.search.center)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.search.center - geometry.sort.center)).toBeLessThanOrEqual(2);
      }
      if (view.font === "normal" && view.width <= 390) {
        expect(geometry.filter.bottom).toBeLessThanOrEqual(geometry.search.top + 1);
        if (geometry.sort.left >= geometry.search.right)
          expect(Math.abs(geometry.search.center - geometry.sort.center)).toBeLessThanOrEqual(2);
        else expect(geometry.search.bottom).toBeLessThanOrEqual(geometry.sort.top + 1);
      }
      if (view.width <= 390) {
        await search.fill("Alpha");
        const input = await search.evaluate(element => ({
          width: element.clientWidth, height: element.clientHeight,
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        }));
        console.log(JSON.stringify({ language, ...view, input }));
        expect(input.width).toBeGreaterThanOrEqual(70);
        expect(input.height + 1).toBeGreaterThanOrEqual(input.lineHeight);
        await toolbar.getByRole("button", { name: chinese ? "清除搜索" : "Clear search", exact: true }).click();
        await expect(search).toHaveValue("");
      }
      if (view.width === 1040 || (view.width === 320 && view.font === "xxlarge"))
        await toolbar.screenshot({ path: info.outputPath("toolbar-" + language + "-" + view.width + "-" + view.font + ".png") });
    }
    await page.setViewportSize({ width: 1040, height: 900 });
    await page.evaluate(() => {
      localStorage.setItem("meeting-memo:font-size", "normal");
      window.dispatchEvent(new StorageEvent("storage", { key: "meeting-memo:font-size" }));
    });
    const all = group.getByRole("button", { name: chinese ? "全部 (2)" : "All (2)", exact: true });
    const notes = group.getByRole("button", { name: chinese ? "有笔记" : "With notes", exact: true });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await notes.focus();
    await page.keyboard.press("Space");
    await expect(notes).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".meeting-card h3")).toHaveText(["Zeta roadmap"]);
    await all.click();
    await search.fill("Alpha");
    await expect(page.locator(".meeting-card h3")).toHaveText(["Alpha workshop"]);
    await toolbar.getByRole("button", { name: chinese ? "清除搜索" : "Clear search", exact: true }).click();
    await sort.selectOption("title");
    await expect(page.locator(".meeting-card h3")).toHaveText(["Alpha workshop", "Zeta roadmap"]);
  });
}
