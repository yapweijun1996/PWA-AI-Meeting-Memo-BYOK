import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UiLanguage } from "../src/i18n";
import { PwaStatus } from "../src/pwa/status";
import { dismissNotice, shouldShowNotice } from "../src/storage/weekly-reminder";

const message = "Offline installation is unavailable. Your local meetings can still be backed up.";
const statusFixture = vi.hoisted(() => ({ error: "", language: "en" as UiLanguage }));
vi.mock("../src/ui-language", () => ({ useUiLanguage: () => statusFixture.language }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => react.useState(initial === "" ? statusFixture.error : initial),
  };
});

afterEach(() => {
  statusFixture.error = "";
  statusFixture.language = "en";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderStatus(error: string) {
  vi.stubGlobal("__BUILD_ID__", "local-test");
  vi.stubGlobal("navigator", { onLine: true });
  statusFixture.error = error;
  return renderToStaticMarkup(createElement(PwaStatus));
}

it.each([
  ["en", "Dismiss notice for one week"],
  ["zh-CN", "\u5173\u95ed\u63d0\u793a\uff0c\u4e00\u5468\u540e\u518d\u63d0\u9192"],
  ["ms", "Tutup notis selama seminggu"],
] as const)("renders the localized weekly dismissal name and title in %s", (language, label) => {
  vi.stubGlobal("localStorage", fakeStorage());
  statusFixture.language = language;
  const markup = renderStatus(message);
  expect.soft(markup).toContain(`aria-label="${label}"`);
  expect.soft(markup).toContain(`title="${label}"`);
  expect(markup).toContain('type="button"');
  expect(markup).toContain('role="status"');
});

it("keeps update failures visible even while the installation reminder is hidden", () => {
  vi.stubGlobal("localStorage", fakeStorage());
  dismissNotice("offline-installation");
  expect(renderStatus(message)).toBe("");
  const error = "Update did not activate. Try again when connected.";
  const markup = renderStatus(error);
  expect(markup).toContain(error);
  expect(markup).not.toContain("<button");
});

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

const now = Date.UTC(2026, 0, 1);
const hour = 60 * 60 * 1000;
const week = 7 * 24 * hour;
describe("weekly notice reminder", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
  });

  it("shows first, hides through six days and 23 hours, and returns at exactly seven days", () => {
    const id = "first";
    expect(shouldShowNotice(id, now)).toBe(true);
    dismissNotice(id, now);
    expect(shouldShowNotice(id, now)).toBe(false);
    expect(shouldShowNotice(id, now + week - hour)).toBe(false);
    expect(shouldShowNotice(id, now + week - 1)).toBe(false);
    expect(shouldShowNotice(id, now + week)).toBe(true);
    expect(shouldShowNotice(id, now + 2 * week)).toBe(true);
  });

  it("starts the next week at the second dismissal", () => {
    const id = "repeat";
    const secondClose = now + week + hour;
    dismissNotice(id, now);
    expect(shouldShowNotice(id, secondClose)).toBe(true);
    dismissNotice(id, secondClose);
    expect(shouldShowNotice(id, secondClose + week - 1)).toBe(false);
    expect(shouldShowNotice(id, secondClose + week)).toBe(true);
  });

  it.each(["", " ", "bad", "NaN", "Infinity", "-1", "0x1", "1.5", String(now + 1), String(now + week + 1)])(
    "shows for invalid or future timestamp %j and replaces it only on dismissal", value => {
      const id = "invalid";
      const key = "meeting-memo-byok:notice:invalid:dismissed-at";
      storage.values.set(key, value);
      expect(shouldShowNotice(id, now)).toBe(true);
      expect(storage.setItem).not.toHaveBeenCalled();
      dismissNotice(id, now);
      expect(storage.values.get(key)).toBe(String(now));
      expect(shouldShowNotice(id, now)).toBe(false);
    },
  );

  it.each(["getItem", "setItem"] as const)("uses page memory when %s throws", method => {
    const id = method;
    storage[method].mockImplementation(() => { throw new Error("Storage denied"); });
    expect(shouldShowNotice(id, now)).toBe(true);
    dismissNotice(id, now);
    expect(shouldShowNotice(id, now + week - 1)).toBe(false);
    expect(shouldShowNotice(id, now + week)).toBe(true);
    expect(storage.values.size).toBe(0);
  });

  it("supports browsers that throw on access to localStorage itself", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("Storage unavailable"); },
    });
    expect(shouldShowNotice("blocked-property", now)).toBe(true);
    dismissNotice("blocked-property", now);
    expect(shouldShowNotice("blocked-property", now)).toBe(false);
  });

  it("reads and writes only the namespaced key for the requested notice", () => {
    const key = "meeting-memo-byok:notice:scoped:dismissed-at";
    storage.values.set("another-app", "unrelated");
    storage.values.set("meeting-memo-byok:notice:other:dismissed-at", "123");
    shouldShowNotice("scoped", now);
    dismissNotice("scoped", now);
    shouldShowNotice("scoped", now + 1);
    expect(storage.getItem.mock.calls.every(([readKey]) => readKey === key)).toBe(true);
    expect(storage.setItem.mock.calls).toEqual([[key, String(now)]]);
    expect([...storage.values.entries()]).toEqual([
      ["another-app", "unrelated"], ["meeting-memo-byok:notice:other:dismissed-at", "123"], [key, String(now)],
    ]);
  });
});
