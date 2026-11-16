import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {Check, Play} from "lucide-react";
import ts from "typescript";
import {expect, test} from "vitest";
import {Icon, type IconSize} from "../src/components/Icon";

for (const [role, pixels] of Object.entries({micro:12,tiny:13,small:14,compact:15,inline:16,status:17,control:18,navigation:19,transport:20,section:21,heading:22,large:24,upload:25,empty:32}))
  test(`icon ${role} preserves ${pixels}px SVG geometry, names and stroke props`, () => {
    const props = {className: "contract-icon", "aria-label": "Play sample", strokeWidth: 1.5};
    expect(renderToStaticMarkup(createElement(Icon, {glyph: Play, size: role as IconSize, ...props})))
      .toBe(renderToStaticMarkup(createElement(Play, {...props, size: pixels})));
  });

test("decorative icons retain Lucide's hidden accessibility behavior", () => {
  expect(renderToStaticMarkup(createElement(Icon, {glyph: Check, size: "inline", "aria-hidden": true})))
    .toBe(renderToStaticMarkup(createElement(Check, {size:16, "aria-hidden": true})));
});

test("application Lucide JSX uses the shared size API instead of feature-owned numeric sizes", () => {
  const failures: string[] = [];
  function scan(directory: string) {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {scan(file);continue;}
      if (!file.endsWith(".tsx")) continue;
      const ast = ts.createSourceFile(file, readFileSync(file,"utf8"), ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      const icons = new Set<string>();
      for (const node of ast.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "lucide-react") continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) icons.add(item.name.text);
      }
      function visit(node: ts.Node) {
        if ((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName) && icons.has(node.tagName.text))
          failures.push(`${file}: ${node.tagName.text} bypasses shared Icon`);
        ts.forEachChild(node,visit);
      }
      visit(ast);
    }
  }
  scan("src");
  expect(failures).toEqual([]);
});
