import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect, test} from "vitest";
import {Button, IconButton, Field, Tab} from "../src/components/controls";

test("shared buttons preserve native form props and caller-owned disabled/name semantics", () => {
  const props = {type: "submit" as const, name: "save", value: "draft", disabled: false, className: "button primary", children: "Save draft"};
  expect(renderToStaticMarkup(createElement(Button, props))).toBe(renderToStaticMarkup(createElement("button", props)));
  expect(renderToStaticMarkup(createElement(Button, {name:"native-default", children:"Native default"})))
    .toBe(renderToStaticMarkup(createElement("button", {name:"native-default", children:"Native default"})));
});

test("pending buttons are disabled and announced without replacing their label", () => {
  const html = renderToStaticMarkup(createElement(Button, {pending:true, children:"Save draft"}));
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('Save draft');
});

test("icon buttons require a name and default to non-submitting native controls", () => {
  const html = renderToStaticMarkup(createElement(IconButton, {label:"Close sample", children:"×"}));
  expect(html).toContain('aria-label="Close sample"');
  expect(html).toContain('type="button"');
  expect(() => renderToStaticMarkup(createElement(IconButton, {label:" "}))).toThrow("accessible label");
});

test("fields preserve control identity, values and descriptions while adding error/hint associations", () => {
  const html = renderToStaticMarkup(createElement(Field, {
    label:"Synthetic field", hint:"A local hint", error:"Required for this example",
    children:createElement("input", {id:"sample", "aria-describedby":"existing", defaultValue:"Retained draft"}),
  }));
  expect(html).toContain('for="sample"');
  expect(html).toContain('value="Retained draft"');
  expect(html).toContain('aria-describedby="existing sample-hint sample-error"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('id="sample-error"');
});

test("tabs publish one selected keyboard stop and retain caller panel relationships", () => {
  const selected = renderToStaticMarkup(createElement(Tab, {value:"one", selected:true, "aria-controls":"one-panel", children:"One"}));
  const inactive = renderToStaticMarkup(createElement(Tab, {value:"two", selected:false, children:"Two"}));
  expect(selected).toContain('role="tab"');
  expect(selected).toContain('aria-controls="one-panel"');
  expect(selected).toContain('tabindex="0"');
  expect(inactive).toContain('tabindex="-1"');
});
