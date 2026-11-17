import { createHash } from "node:crypto";
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

/** Parser-blocking, same-origin script: no inline-script CSP exception or key/database access. */
export function createAppearanceBootstrap(colors, preferences) {
  return `(()=>{const p=${JSON.stringify(preferences)},colors=${JSON.stringify(colors)},root=document.documentElement;let theme=p.theme.default,palette=p.palette.default;try{const t=localStorage.getItem(p.theme.key),c=localStorage.getItem(p.palette.key);if(p.theme.values.includes(t))theme=t;if(Object.hasOwn(p.palette.options,c))palette=c}catch{}root.dataset.theme=theme;root.dataset.palette=palette;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',colors[theme])})();`;
}

export function browserChromePlugin() {
  let themeFile, preferencesFile, base;
  const asset = () => {
    const colors = readBrowserChromeColors(readFileSync(themeFile, "utf8"));
    const preferences = JSON.parse(readFileSync(preferencesFile, "utf8"));
    const source = createAppearanceBootstrap(colors, preferences);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    return { source, fileName: `assets/appearance-init-${hash}.js`, colors };
  };
  return {
    name: "meeting-memo-browser-chrome",
    configResolved(config) {
      themeFile = path.resolve(config.root, "src/theme.css");
      preferencesFile = path.resolve(config.root, "src/appearance-preferences.json");
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(`${base}assets/appearance-init-`)) return next();
        const prepared = asset();
        if (request.url?.split("?")[0] !== `${base}${prepared.fileName}`) return next();
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(prepared.source);
      });
    },
    generateBundle() {
      const prepared = asset();
      this.emitFile({type: "asset", fileName: prepared.fileName, source: prepared.source});
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const prepared = asset();
        if (html.split(placeholder).length !== 2) throw new Error("HTML requires one browser chrome placeholder");
        const script = `<script src="${base}${prepared.fileName}"></script>`;
        return html.replace(placeholder, prepared.colors.light).replace("</head>", `${script}</head>`);
      },
    },
    handleHotUpdate(context) {
      if (![themeFile, preferencesFile].includes(path.resolve(context.file))) return;
      readBrowserChromeColors(readFileSync(themeFile, "utf8"));
      // CSS edits must refresh the static meta value as well as the stylesheet.
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
