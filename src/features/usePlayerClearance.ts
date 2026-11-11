import { useLayoutEffect, useRef } from "react";

/** Keep the final document line above the fixed player, including its safe-area padding. */
export function usePlayerClearance(enabled: boolean) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const playerBarRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const workspace = workspaceRef.current, bar = playerBarRef.current;
    if (!workspace || !bar || !enabled) return;
    const measure = () => {
      const rect = bar.getBoundingClientRect();
      workspace.style.paddingBottom = `${Math.ceil(rect.height + Math.max(0, window.innerHeight - rect.bottom) + 24)}px`;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      workspace.style.removeProperty("padding-bottom");
    };
  }, [enabled]);
  return { workspaceRef, playerBarRef };
}
