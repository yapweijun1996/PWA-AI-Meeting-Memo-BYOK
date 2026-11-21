import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { initializeAppearance, savePalette } from "../src/appearance";
import preferences from "../src/appearance-preferences.json";
import { PaletteMenu, paletteMenuOptions } from "../src/components/ChoiceMenu";

const { key, default: defaultPalette } = preferences.palette;
const syncBrowserChrome = vi.hoisted(() => vi.fn());
vi.mock("../src/browser-chrome", () => ({ syncBrowserChrome }));

function startAppearance(stored: string | null, readDenied = false) {
  let saved = stored;
  const storage = {
    getItem: vi.fn((name: string) => {
      if (readDenied) throw new DOMException("Storage denied", "SecurityError");
      return name === key ? saved : null;
    }),
    setItem: vi.fn((name: string, value: string) => {
      if (name === key) saved = value;
    }),
  };
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", storage);
  initializeAppearance();
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each(["en", "zh-CN", "ms"] as const)("lists the eight configured choices in order for %s", (language) => {
  const configured = Object.entries(preferences.palette.options);
  expect(configured).toHaveLength(8);
  expect(paletteMenuOptions(language).map(({ value, label }) => [value, label]))
    .toEqual(configured.map(([value, labels]) => [value, language === "zh-CN" ? labels.zh : labels.en]));
});

it("uses the same CSS accent token for the swatch and active accent of every palette", () => {
  const css = readFileSync("src/theme.css", "utf8");
  for (const { value, decoration } of paletteMenuOptions("en")) {
    const token = `--palette-accent-${value}`;
    expect(css).toContain(`${token}:`);
    expect(css).toContain(`--color-accent: var(${token});`);
    const markup = renderToStaticMarkup(decoration);
    expect(markup).toContain(`background-color:var(${token})`);
    expect(markup).toContain('aria-hidden="true"');
  }
});

it.each([
  ["en", `Color palette: ${preferences.palette.options.forest.en}`],
  ["zh-CN", `\u914d\u8272\uff1a${preferences.palette.options.forest.zh}`],
  ["ms", `Palet warna: ${preferences.palette.options.forest.en}`],
] as const)("renders matching trigger name and title in %s", (language, name) => {
  const markup = renderToStaticMarkup(createElement(PaletteMenu, { language, onTabOnlyChange: vi.fn() }));
  expect(markup).toContain(`aria-label="${name}"`);
  expect(markup).toContain(`title="${name}"`);
  expect(markup).toContain("lucide-palette");
});

it.each(["invalid", "__proto__", null])("uses the configured default for stored palette %s", (stored) => {
  startAppearance(stored);
  expect(document.documentElement.dataset.palette).toBe(defaultPalette);
});

it("uses the configured default when storage reads throw", () => {
  startAppearance("violet", true);
  expect(document.documentElement.dataset.palette).toBe(defaultPalette);
});

it("keeps the new palette in this tab when storage writes throw", () => {
  const storage = startAppearance(defaultPalette);
  storage.setItem.mockImplementation(() => { throw new DOMException("Storage denied", "SecurityError"); });
  syncBrowserChrome.mockClear();

  expect(savePalette("rose", { allowTabOnly: true })).toBe(false);
  expect(document.documentElement.dataset.palette).toBe("rose");
  expect(syncBrowserChrome).toHaveBeenCalledOnce();
  expect(storage.getItem(key)).toBe(defaultPalette);
  window.dispatchEvent(Object.assign(new Event("storage"), { key: preferences.theme.key }));
  expect(document.documentElement.dataset.palette).toBe("rose");
});

it("shares the saved palette with startup and later palette storage events", () => {
  const storage = startAppearance(defaultPalette);
  expect(savePalette("ocean", { allowTabOnly: true })).toBe(true);
  expect(storage.getItem(key)).toBe("ocean");
  expect(document.documentElement.dataset.palette).toBe("ocean");
  initializeAppearance();
  expect(document.documentElement.dataset.palette).toBe("ocean");

  storage.setItem(key, "amber");
  window.dispatchEvent(Object.assign(new Event("storage"), { key }));
  expect(document.documentElement.dataset.palette).toBe("amber");
});

it("lets Settings continue to report a denied palette write", () => {
  const storage = startAppearance(defaultPalette);
  storage.setItem.mockImplementation(() => { throw new DOMException("Storage denied", "SecurityError"); });

  expect(() => savePalette("teal")).toThrow(DOMException);
  expect(document.documentElement.dataset.palette).toBe(defaultPalette);
});
