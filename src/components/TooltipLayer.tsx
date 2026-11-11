import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Shared tooltip for elements opting in with data-tooltip. */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const active = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let dismissedByEscape: HTMLElement | null = null;
    const clear = () => {
      const element = active.current;
      if (element) {
        const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id && id !== "app-tooltip");
        if (ids.length) element.setAttribute("aria-describedby", ids.join(" "));
        else element.removeAttribute("aria-describedby");
      }
      active.current = null;
      setTip(null);
    };
    const show = (element: HTMLElement, x: number, y: number) => {
      const text = element.dataset.tooltip;
      if (!text) return;
      if (active.current !== element) {
        clear();
        active.current = element;
        const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        element.setAttribute("aria-describedby", [...ids, "app-tooltip"].join(" "));
      }
      setTip({ text, x: Math.max(8, Math.min(x + 14, window.innerWidth - 250)), y: Math.max(8, Math.min(y + 18, window.innerHeight - 70)) });
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tooltip]") : null;
      if (target && target !== dismissedByEscape) show(target, event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => { if (active.current && event.pointerType !== "touch") show(active.current, event.clientX, event.clientY); };
    const out = (event: PointerEvent) => {
      if (dismissedByEscape && event.target instanceof Node && dismissedByEscape.contains(event.target) && !(event.relatedTarget instanceof Node && dismissedByEscape.contains(event.relatedTarget))) dismissedByEscape = null;
      if (active.current && !(event.relatedTarget instanceof Node && active.current.contains(event.relatedTarget))) clear();
    };
    const focus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tooltip]") : null;
      if (target) { dismissedByEscape = null; const box = target.getBoundingClientRect(); show(target, box.left, box.bottom); }
    };
    const blur = (event: FocusEvent) => { if (event.target === active.current) clear(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { dismissedByEscape = active.current; clear(); } };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", clear, true);
    return () => { clear(); document.removeEventListener("pointerover", over); document.removeEventListener("pointermove", move); document.removeEventListener("pointerout", out); document.removeEventListener("focusin", focus); document.removeEventListener("focusout", blur); document.removeEventListener("keydown", key); window.removeEventListener("scroll", clear, true); };
  }, []);
  return tip ? createPortal(<div id="app-tooltip" role="tooltip" className="app-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>, document.body) : null;
}
