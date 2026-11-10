import { useSyncExternalStore } from "react";

const key = "meeting-memo:font-family";
export type FontChoice = "default" | "system" | "segoe" | "georgia";
const choices: readonly string[] = ["default", "system", "segoe", "georgia"];
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
  try { apply(parse(localStorage.getItem(key))); } catch { apply("default"); }
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      try { apply(parse(localStorage.getItem(key))); } catch { apply("default"); }
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
