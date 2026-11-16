import { readFileSync } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { transform } from "lightningcss";

const placeholder = "var(--bg-app)";

function themeScope(selectors) {
  if (selectors.length !== 1) return;
  const [root, attribute, ...rest] = selectors[0];
  if (root?.type !== "pseudo-class" || root.kind !== "root" || rest.length) return;
  if (!attribute) return "light";
  if (attribute.type === "attribute" && attribute.namespace === null && attribute.name === "data-theme" && attribute.operation?.operator === "equal" && attribute.operation.value === "dark" && attribute.operation.caseSensitivity === "case-sensitive") return "dark";
}

/** Only the two parsed, opaque sRGB app-background roles cross into static chrome. */
export function readBrowserChromeColors(css) {
  const colors = {};
  let declarations = 0;
  const isBackground = (declaration) => declaration.property === "custom" && declaration.value.name === "--bg-app";
  transform({
    filename: "src/theme.css",
    code: Buffer.from(css),
    visitor: {
      Declaration(declaration) { if (isBackground(declaration)) declarations += 1; },
      StyleSheet(sheet) {
        for (const rule of sheet.rules) {
          if (rule.type !== "style") continue;
          if (rule.value.declarations?.importantDeclarations?.some(isBackground)) throw new Error("Browser chrome --bg-app must not use !important");
          for (const declaration of rule.value.declarations?.declarations ?? []) {
            if (declaration.property !== "custom" || declaration.value.name !== "--bg-app") continue;
            const scope = themeScope(rule.value.selectors);
            if (!scope || colors[scope]) throw new Error("Missing or ambiguous browser chrome --bg-app ownership");
            const [token, ...extra] = declaration.value.value;
            if (extra.length || token?.type !== "color" || typeof token.value !== "object" || token.value.type !== "rgb" || token.value.alpha !== 1) throw new Error("Browser chrome --bg-app must be one opaque sRGB color");
            colors[scope] = `#${[token.value.r, token.value.g, token.value.b].map(value => value.toString(16).padStart(2, "0")).join("")}`;
          }
        }
      },
    },
  });
  if (!colors.light || !colors.dark || declarations !== 2) throw new Error("Browser chrome requires exactly one light and one dark --bg-app declaration");
  return { light: colors.light, dark: colors.dark };
}

export function browserChromePlugin() {
  let themeFile;
  return {
    name: "meeting-memo-browser-chrome",
    configResolved(config) { themeFile = path.resolve(config.root, "src/theme.css"); },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const colors = readBrowserChromeColors(readFileSync(themeFile, "utf8"));
        if (html.split(placeholder).length !== 2) throw new Error("HTML requires one browser chrome placeholder");
        return html.replace(placeholder, colors.light);
      },
    },
    handleHotUpdate(context) {
      if (path.resolve(context.file) !== themeFile) return;
      readBrowserChromeColors(readFileSync(themeFile, "utf8"));
      // CSS edits must refresh the static meta value as well as the stylesheet.
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
