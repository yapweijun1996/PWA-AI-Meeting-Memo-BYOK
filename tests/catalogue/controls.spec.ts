import {expect, test} from "@playwright/test";

test.beforeEach(async ({page}) => {await page.goto("/");});

test("shared field exposes its retained draft and error description; pending controls submit once", async ({page}) => {
  const field = page.getByRole("textbox", {name:"Synthetic shared field",exact:true});
  await expect(field).toHaveValue("Local draft");
  await expect(field).toHaveAccessibleDescription("This draft stays in this tab");
  await page.getByRole("button", {name:"Clear synthetic field",exact:true}).click();
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("aria-invalid","true");
  await expect(field).toHaveAccessibleDescription("This draft stays in this tab Enter a synthetic value");
  await field.fill("Unsaved local draft");
  const action = page.getByRole("button", {name:"Run synthetic operation",exact:true});
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(action).toBeDisabled();
  await expect(action).toHaveAttribute("aria-busy","true");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Synthetic operation count: 1",{exact:true})).toBeVisible();
  await expect(action).toBeEnabled();
  await expect(field).toHaveValue("Unsaved local draft");
});

test("shared tabs wrap, skip disabled choices and preserve selected focus when the feature refuses a change", async ({page}) => {
  const first = page.getByRole("tab",{name:"first control tab",exact:true});
  const second = page.getByRole("tab",{name:"second control tab",exact:true});
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected","true");
  await page.keyboard.press("ArrowRight");
  await expect(first).toBeFocused();
  await page.keyboard.press("End");
  await expect(second).toBeFocused();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await page.getByLabel("Block synthetic tab changes",{exact:true}).check();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected","true");
  await second.click();
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected","true");
  await expect(page.getByRole("tabpanel",{name:"first control tab",exact:true})).toBeVisible();
});
