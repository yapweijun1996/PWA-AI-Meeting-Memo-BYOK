import { afterEach, expect, it, vi } from "vitest";
import { initializeAppearance, toggleTheme } from "../src/appearance";
import preferences from "../src/appearance-preferences.json";

vi.mock("../src/browser-chrome", () => ({ syncBrowserChrome: vi.fn() }));

function startWithTheme(stored?: string) {
  const values = new Map<string, string>();
  if (stored !== undefined) values.set(preferences.theme.key, stored);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", storage);
  initializeAppearance();
  return storage;
}

afterEach(() => vi.unstubAllGlobals());

it.each([["light", "dark"], ["dark", "light"]])("switches from %s to %s and persists it", (from, to) => {
  const storage = startWithTheme(from);
  expect(toggleTheme()).toBe(true);
  expect(document.documentElement.dataset.theme).toBe(to);
  expect(storage.getItem(preferences.theme.key)).toBe(to);
});

it("toggles from the configured default after reading an invalid theme", () => {
  const storage = startWithTheme("invalid");
  expect(document.documentElement.dataset.theme).toBe(preferences.theme.default);
  toggleTheme();
  expect(storage.getItem(preferences.theme.key)).toBe("dark");
});

it("keeps switching in the current tab when storage writes are denied", () => {
  const storage = startWithTheme("light");
  storage.setItem.mockImplementation(() => { throw new DOMException("Storage denied", "SecurityError"); });
  expect(toggleTheme()).toBe(false);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(storage.getItem(preferences.theme.key)).toBe("light");
  expect(toggleTheme()).toBe(false);
  expect(document.documentElement.dataset.theme).toBe("light");
});
