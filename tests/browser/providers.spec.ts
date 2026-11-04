import { test, expect, type Page } from "@playwright/test";
// A service-worker-controlled WebKit request can bypass page.route. Block workers
// in network-mock contexts so CI cannot accidentally make a live provider call.
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ context }) => {
  await context.route("https://**/*", (route) => route.abort());
});
const base = "/PWA-AI-Meeting-Memo-BYOK/";
async function create(page: Page, title = "ERP review") {
  await page
    .getByRole("button", { name: "New meeting", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Meeting title").fill(title);
  await dialog.getByText("Start from a transcript instead").click();
  await dialog
    .getByLabel("Transcript", { exact: true })
    .fill(
      "Jamie: Review the current stock process.\nAlex: Finance needs to confirm the rule.",
    );
  await dialog
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
test("memo submissions require confirmation, preserve evidence and mark source changes stale", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
      return;
    }
    requests++;
    const body = route.request().postDataJSON(),
      input = JSON.parse(body.input);
    expect(body.store).toBe(false);
    await route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    {
                      type: "action",
                      text: "Review inventory with finance.",
                      owner_speaker_id: null,
                      due_date: null,
                      due_original: null,
                      source_segment_ids: [input.segments[0].id],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto(base);
  await create(page);
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save session keys" }).click();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByLabel("action note")).toHaveValue(
    "Review inventory with finance.",
  );
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "✓ Accept", exact: true }).click();
  await page.getByRole("tab", { name: /Transcript/ }).click();
  await page
    .getByRole("button", { name: "Edit passage", exact: true })
    .first()
    .click();
  await page.getByLabel("Transcript text").fill("The source is corrected.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await expect(page.getByText(/Source details changed/)).toBeVisible();
  await expect(page.getByLabel("action note")).toHaveValue(
    "Review inventory with finance.",
  );
  await page
    .getByRole("button", { name: "Passage 1 · r1", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Review the current stock process.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View current passage", exact: true })
    .click();
  await expect(
    page.getByText("The source is corrected.", { exact: true }),
  ).toBeVisible();
});

test("uncertain requests are recorded and never automatically resubmitted", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
      return;
    }
    calls++;
    return route.abort("connectionfailed");
  });
  await page.goto(base);
  await create(page);
  const hash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Settings & API keys" }).click();
  await page
    .getByLabel("OpenAI API key", { exact: true })
    .fill("synthetic-test-only");
  await page.getByRole("button", { name: "Save session keys" }).click();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await page.getByRole("tab", { name: /Meeting notes/ }).click();
  await page
    .getByRole("button", { name: "Generate meeting notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("may have been charged");
  await page.getByText("Processing history", { exact: false }).click();
  await expect(
    page.getByText("Memo · outcome unknown", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.waitForTimeout(400);
  expect(calls).toBe(1);
});
