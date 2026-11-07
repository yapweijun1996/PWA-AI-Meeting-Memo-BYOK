import { useCallback, useState } from "react";

export const SIDEBAR_COLLAPSED_KEY = "meeting-memo:sidebar-collapsed";
const TABLET_QUERY = "(max-width: 1023px)";

function readStored(): boolean | null {
  try {
    const value = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

function writeStored(value: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Storage may be blocked; the toggle still works for this page view.
  }
}

function defaultCollapsed(): boolean {
  try {
    return window.matchMedia(TABLET_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Desktop sidebar collapse state. An explicit choice is remembered per browser
 * origin; without one, tablet-width viewports start as a compact icon rail.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => readStored() ?? defaultCollapsed());
  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      writeStored(next);
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
