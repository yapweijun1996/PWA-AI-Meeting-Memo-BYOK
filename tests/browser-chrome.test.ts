import { runInNewContext } from "node:vm";
import preferences from "../src/appearance-preferences.json";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readBrowserChromeColors, createAppearanceBootstrap } from "../scripts/browser-chrome.mjs";
import { transform } from "lightningcss";

const required = ':root { --bg-app: #f7f8fa; } :root[data-theme="dark"] { --bg-app: #15191f; }';

it("reads the two opaque app-background roles rather than maintaining another color map", () => {
  expect(readBrowserChromeColors(required)).toEqual({ light: "#f7f8fa", dark: "#15191f" });
  expect(readBrowserChromeColors(':root { --bg-app: #fff; } :root[data-theme="dark"] { --bg-app: rgb(21 25 31); }')).toEqual({ light: "#ffffff", dark: "#15191f" });
});

it.each([
  ["missing theme", ':root { --bg-app: #fff; }'],
  ["duplicate base", `${required} :root { --bg-app: #fff; }`],
  ["palette ownership", `${required} :root[data-palette="ocean"] { --bg-app: #fff; }`],
  ["conditional ownership", `${required} @media (min-width: 1px) { :root { --bg-app: #fff; } }`],
  ["important override", `${required} :root { --bg-app: #fff !important; }`],
  ["unresolved alias", required.replace("#f7f8fa", "var(--surface)")],
  ["transparent color", required.replace("#f7f8fa", "#fff0")],
  ["malformed stylesheet", required + " %%% {"],
])("rejects %s instead of producing ambiguous browser chrome", (_name, css) => {
  expect(() => readBrowserChromeColors(css)).toThrow();
});

it("keeps the browser-chrome source in the semantic token owner", () => {
  const theme = readFileSync("src/theme.css", "utf8");
  expect(readBrowserChromeColors(theme)).toEqual({ light: "#f7f8fa", dark: "#15191f" });
  expect(readFileSync("src/style.css", "utf8")).not.toMatch(/--bg-app\s*:/);
  expect(readFileSync("index.html", "utf8")).toContain('content="var(--bg-app)"');
});

it("keeps base token ownership disjoint and semantic declarations unique", () => {
  function baseNames(filename: string) {
    const names: string[] = [];
    transform({
      filename, code: Buffer.from(readFileSync(filename, "utf8")),
      visitor: {
        StyleSheet(sheet) {
          for (const rule of sheet.rules) {
            if (rule.type !== "style" || rule.value.selectors.length !== 1) continue;
            const selector = rule.value.selectors[0];
            if (selector.length !== 1 || selector[0].type !== "pseudo-class" || selector[0].kind !== "root") continue;
            for (const declaration of rule.value.declarations?.declarations ?? []) {
              if (declaration.property === "custom") names.push(declaration.value.name);
            }
          }
        },
      },
    });
    return names;
  }
  const primitives = baseNames("src/style.css");
  const semantics = baseNames("src/theme.css");
  expect(semantics.filter((name, index) => semantics.indexOf(name) !== index)).toEqual([]);
  expect(semantics.filter(name => primitives.includes(name))).toEqual([]);
  expect(semantics).toContain("--evidence-highlight-bg");
  expect(semantics).toContain("--layer-tooltip");
  expect(primitives).toContain("--speaker-1");
  expect(primitives).toContain("--text-base");
});


it.each([
  ["dark", "ocean", "dark", "ocean"],
  ["light", "amber", "light", "amber"],
  [null, null, "light", "forest"],
  ["invalid", "<script>invalid</script>", "light", "forest"],
])("early appearance validates %s/%s and reads only its own preference keys", (theme, palette, expectedTheme, expectedPalette) => {
  const reads: string[] = [];
  const dataset: Record<string, string> = {};
  let chrome = "";
  runInNewContext(createAppearanceBootstrap({light: "#f7f8fa", dark: "#15191f"}, preferences), {
    document: {documentElement: {dataset}, querySelector: () => ({setAttribute: (_key: string, value: string) => { chrome = value; }})},
    localStorage: {getItem: (key: string) => { reads.push(key); return key === preferences.theme.key ? theme : palette; }},
  });
  expect(reads).toEqual([preferences.theme.key, preferences.palette.key]);
  expect(dataset).toEqual({theme: expectedTheme, palette: expectedPalette});
  expect(chrome).toBe(expectedTheme === "dark" ? "#15191f" : "#f7f8fa");
});

it("early appearance survives denied storage without writes or database access", () => {
  const dataset: Record<string, string> = {};
  runInNewContext(createAppearanceBootstrap({light: "#f7f8fa", dark: "#15191f"}, preferences), {
    document: {documentElement: {dataset}, querySelector: () => null},
    get localStorage() { throw new Error("denied"); },
  });
  expect(dataset).toEqual({theme: "light", palette: "forest"});
});
