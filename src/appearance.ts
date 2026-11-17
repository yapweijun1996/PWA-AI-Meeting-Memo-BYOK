import preferences from "./appearance-preferences.json";
import { syncBrowserChrome } from "./browser-chrome";
import { useSyncExternalStore } from "react";

const key = "meeting-memo:font-family";
const sizeKey = "meeting-memo:font-size";
const themeKey = preferences.theme.key;
const paletteKey = preferences.palette.key;
export type ThemeChoice = "light" | "dark";
export type PaletteChoice = keyof typeof preferences.palette.options;
export const paletteOptions = preferences.palette.options;
export const paletteChoices = Object.keys(paletteOptions) as PaletteChoice[];
let currentTheme: ThemeChoice = "light";
let currentPalette = preferences.palette.default as PaletteChoice;
const parseTheme = (value: string | null): ThemeChoice => (preferences.theme.values.includes(value ?? "") ? value : preferences.theme.default) as ThemeChoice;
const parsePalette = (value: string | null): PaletteChoice => (Object.hasOwn(preferences.palette.options, value ?? "") ? value : preferences.palette.default) as PaletteChoice;
function applyTheme(value: ThemeChoice) { currentTheme = value; document.documentElement.dataset.theme = value; syncBrowserChrome(); listeners.forEach((listener) => listener()); }
function applyPalette(value: PaletteChoice) { currentPalette = value; document.documentElement.dataset.palette = value; syncBrowserChrome(); listeners.forEach((listener) => listener()); }
export type FontSize = "small" | "normal" | "large" | "xlarge" | "xxlarge";
let currentSize: FontSize = "normal";
const parseSize = (value: string | null): FontSize => value === "small" || value === "large" || value === "xlarge" || value === "xxlarge" ? value : "normal";
function applySize(value: FontSize) { currentSize = value; document.documentElement.dataset.fontSize = value; listeners.forEach((listener) => listener()); }
export type FontChoice = "default" | "system" | "segoe" | "georgia" | "arial" | "verdana" | "tahoma" | "trebuchet" | "times" | "courier";
const choices: readonly string[] = ["default", "system", "segoe", "georgia", "arial", "verdana", "tahoma", "trebuchet", "times", "courier"];
let current: FontChoice = "default";
const listeners = new Set<() => void>();

function parse(value: string | null): FontChoice {
  return value && choices.includes(value) ? value as FontChoice : "default";
}
function apply(value: FontChoice) {
  current = value;
  document.documentElement.dataset.font = value;
  listeners.forEach((listener) => listener());
}
export function initializeAppearance() {
  try { apply(parse(localStorage.getItem(key))); applySize(parseSize(localStorage.getItem(sizeKey))); applyTheme(parseTheme(localStorage.getItem(themeKey))); applyPalette(parsePalette(localStorage.getItem(paletteKey))); } catch { apply("default"); applySize("normal"); applyTheme("light"); applyPalette(parsePalette(null)); }
  window.addEventListener("storage", (event) => {
    if (event.key === themeKey || event.key === null) { try { applyTheme(parseTheme(localStorage.getItem(themeKey))); } catch { applyTheme("light"); } }
    if (event.key === paletteKey || event.key === null) { try { applyPalette(parsePalette(localStorage.getItem(paletteKey))); } catch { applyPalette(parsePalette(null)); } }
    if (event.key === sizeKey || event.key === null) {
      try { applySize(parseSize(localStorage.getItem(sizeKey))); } catch { applySize("normal"); }
    }
    if (event.key === key || event.key === null) {
      try { apply(parse(localStorage.getItem(key))); applySize(parseSize(localStorage.getItem(sizeKey))); applyTheme(parseTheme(localStorage.getItem(themeKey))); applyPalette(parsePalette(localStorage.getItem(paletteKey))); } catch { apply("default"); applySize("normal"); applyTheme("light"); applyPalette(parsePalette(null)); }
    }
  });
}
export function saveFont(value: FontChoice) {
  localStorage.setItem(key, value);
  apply(value);
}
export function useFontChoice() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
    () => "default" as FontChoice,
  );
}

export function saveFontSize(value: FontSize) { localStorage.setItem(sizeKey, value); applySize(value); }
export function useFontSize() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => currentSize, () => "normal" as FontSize); }

export function saveTheme(value: ThemeChoice) { localStorage.setItem(themeKey, value); applyTheme(value); }
export function savePalette(value: PaletteChoice) { localStorage.setItem(paletteKey, value); applyPalette(value); }
export function useThemeChoice() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => currentTheme, () => "light" as ThemeChoice); }
export function usePaletteChoice() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => currentPalette, () => parsePalette(null)); }
