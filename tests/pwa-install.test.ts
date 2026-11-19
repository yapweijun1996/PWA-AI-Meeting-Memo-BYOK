import { expect, test } from "vitest";
import { isIosDevice, resolveInstallMode, type InstallEnvironment } from "../src/pwa/install";

const desktop: InstallEnvironment = { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130", platform: "Win32", maxTouchPoints: 0, standalone: false };
const iphone: InstallEnvironment = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", platform: "iPhone", maxTouchPoints: 5, standalone: false };
const ipadDesktopMode: InstallEnvironment = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5, standalone: false };
const mac: InstallEnvironment = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0, standalone: false };

test("detects iPhone and iPadOS in desktop mode, not a Mac", () => {
  expect(isIosDevice(iphone)).toBe(true);
  expect(isIosDevice(ipadDesktopMode)).toBe(true);
  expect(isIosDevice(mac)).toBe(false);
  expect(isIosDevice(desktop)).toBe(false);
});

test("offers the native prompt only when the browser supplied one", () => {
  expect(resolveInstallMode({ env: desktop, installed: false, hasPrompt: true })).toBe("prompt");
  expect(resolveInstallMode({ env: desktop, installed: false, hasPrompt: false })).toBe("none");
});

test("iOS has no prompt event, so it gets the Add to Home Screen guide", () => {
  expect(resolveInstallMode({ env: iphone, installed: false, hasPrompt: false })).toBe("ios-guide");
  expect(resolveInstallMode({ env: mac, installed: false, hasPrompt: false })).toBe("none");
});

test("an installed or standalone app never offers installation", () => {
  expect(resolveInstallMode({ env: desktop, installed: true, hasPrompt: true })).toBe("none");
  expect(resolveInstallMode({ env: { ...desktop, standalone: true }, installed: false, hasPrompt: true })).toBe("none");
  expect(resolveInstallMode({ env: { ...iphone, standalone: true }, installed: false, hasPrompt: false })).toBe("none");
});
