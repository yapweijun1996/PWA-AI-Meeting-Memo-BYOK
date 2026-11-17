import { test, expect, type Page } from "@playwright/test";
import { sampleMeeting } from "../../src/domain/model";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });
test.beforeEach(async ({ context, page }) => {
  await context.route("https://**/*", (route) => route.abort());
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
});

async function expand(page: Page) {
  const button = page.getByRole("button", {
    name: "Expand sidebar",
    exact: true,
  });
  if (await button.isVisible()) await button.click();
}
async function seed(page: Page, withMemo = false) {
  const meeting = sampleMeeting();
  meeting.title = "Synthetic layout review";
  if (withMemo) {
    const item = {
      id: crypto.randomUUID(),
      type: "summary" as const,
      text: "Review the inventory conditions and preserve every original source before accepting this meeting summary. ".repeat(
        4,
      ),
      ownerId: null,
      dueDate: null,
      dueOriginal: null,
      sources: meeting.segments.map((segment) => ({
        id: segment.id,
        revision: segment.revision,
      })),
      review: "pending" as const,
    };
    meeting.memos = [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        sourceRevision: meeting.revision,
        model: "synthetic",
        items: [item],
        originalItems: [structuredClone(item)],
      },
    ];
  }
  await page.goto("./");
  await page
    .getByLabel("Restore backup", { exact: true })
    .setInputFiles({
      name: "layout.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(meeting)),
    });
  await expect(
    page.getByRole("heading", {
      name: `${meeting.title} (restored)`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  return meeting;
}

test("sidebar storage status stays on one line without clipping", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  await expand(page);
  const label = page.locator(".local-label .nav-text");
  const geometry = await label.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      lines: range.getClientRects().length,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      font: getComputedStyle(element).fontSize,
    };
  });
  console.log(JSON.stringify(geometry));
  await page
    .locator(".sidebar-bottom")
    .screenshot({ path: info.outputPath("sidebar.png") });
  expect(geometry.lines).toBe(1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(
    await page
      .locator(".sidebar-bottom")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  const font = parseFloat(geometry.font);
  await page.locator(".sidebar").evaluate((element) => {
    (element as HTMLElement).style.width = "320px";
  });
  await expect
    .poll(() =>
      label.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    )
    .toBeGreaterThan(font);
});

test("confirmation checkbox shares its first text line", async ({ page }) => {
  await seed(page);
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  const checkbox = page
    .getByRole("dialog")
    .getByRole("checkbox", {
      name: "Use selective transcript review (Pi, optional)",
      exact: true,
    });
  const geometry = await checkbox.evaluate((element) => {
    const label = element.closest("label")!;
    const text = label.querySelector("span");
    const range = document.createRange();
    if (text) range.selectNodeContents(text);
    else range.selectNodeContents(label.lastChild!);
    const bounds = element.getBoundingClientRect(),
      firstLine = range.getClientRects()[0];
    return {
      checkboxTop: bounds.top,
      textTop: firstLine.top,
      textLeft: firstLine.left,
      checkboxRight: bounds.right,
    };
  });
  expect(Math.abs(geometry.checkboxTop - geometry.textTop)).toBeLessThan(8);
  expect(geometry.textLeft).toBeGreaterThan(geometry.checkboxRight);
});

test("global error dismiss control stays at the right edge", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByLabel("Restore backup", { exact: true })
    .setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
  const dismiss = page.getByRole("button", {
    name: "Dismiss error",
    exact: true,
  });
  await expect(dismiss).toBeVisible();
  const gap = await dismiss.evaluate((element) => {
    const parent = element.closest('[role="alert"]')!;
    return (
      parent.getBoundingClientRect().right -
      element.getBoundingClientRect().right -
      parseFloat(getComputedStyle(parent).paddingRight)
    );
  });
  expect(gap).toBeLessThanOrEqual(2);
  await dismiss.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("settings separates storage and about while preserving API drafts", async ({
  page,
}) => {
  await page.goto("./#/settings");
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-unsaved-layout-key");
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Storage monitor", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toBeHidden();
  await page.getByRole("tab", { name: "About", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "About this workspace", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "API & models", exact: true }).click();
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "synthetic-unsaved-layout-key",
  );
});

test("review card keeps a short wide note compact and actions before supporting evidence", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, true);
  await page
    .getByRole("button", { name: "Evidence Review", exact: true })
    .click();
  const card = page.locator(".memo-item").first(),
    editor = card.getByRole("textbox", { name: "summary note" });
  const geometry = await editor.evaluate((element) => ({
    height: element.clientHeight,
    line: parseFloat(getComputedStyle(element).lineHeight),
    padding:
      parseFloat(getComputedStyle(element).paddingTop) +
      parseFloat(getComputedStyle(element).paddingBottom),
  }));
  console.log(JSON.stringify(geometry));
  await card.screenshot({ path: info.outputPath("memo-card.png") });
  expect(geometry.height).toBeLessThanOrEqual(
    geometry.line * 4 + geometry.padding + 3,
  );
  expect((await card.locator(".memo-actions").boundingBox())!.y).toBeLessThan(
    (await card.locator(".original-text").boundingBox())!.y,
  );
});
