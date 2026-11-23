/** macOS Safari uses Option-Tab to include buttons when advancing keyboard focus. */
export function nextKeyboardControl(browserName: string): string {
  return browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
}
