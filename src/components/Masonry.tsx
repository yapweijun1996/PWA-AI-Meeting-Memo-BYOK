import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./Masonry.css";

/** Shared card layout. Cards keep their DOM order and respond to changing content. */
export function Masonry({ children, className }: { children: ReactNode; className: string }) {
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame: number | undefined;
    const observed = new Set<Element>();

    const layout = () => {
      frame = undefined;
      if (!root.isConnected || !root.getBoundingClientRect().width) return;
      const style = getComputedStyle(root);
      const unit = parseFloat(style.getPropertyValue("--masonry-row")) || 4;
      const gap = parseFloat(style.getPropertyValue("--masonry-gap")) || 0;
      const cards = Array.from(root.children).filter((card): card is HTMLElement => card instanceof HTMLElement);
      const spans = cards.map(card => Math.max(1, Math.ceil((card.getBoundingClientRect().height + gap) / unit)));
      cards.forEach((card, index) => {
        const span = String(spans[index]);
        if (card.style.getPropertyValue("--masonry-span") !== span) card.style.setProperty("--masonry-span", span);
      });
      root.dataset.masonryReady = "true";
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(layout);
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const observeCards = () => {
      if (!resize) return;
      const current = new Set(root.children);
      observed.forEach(card => {
        if (!current.has(card)) { resize.unobserve(card); observed.delete(card); }
      });
      current.forEach(card => {
        if (!observed.has(card)) { resize.observe(card); observed.add(card); }
      });
    };
    resize?.observe(root);
    observeCards();
    const changes = new MutationObserver(() => { observeCards(); schedule(); });
    changes.observe(root, { childList: true, subtree: true, characterData: true });
    const fallback = resize ? null : new MutationObserver(schedule);
    fallback?.observe(document.documentElement, {
      attributes: true, subtree: true, attributeFilter: ["class", "hidden", "open", "data-font-size"],
    });
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    schedule();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resize?.disconnect();
      changes.disconnect();
      fallback?.disconnect();
      window.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, []);

  return <div ref={container} className={`masonry ${className}`}>{children}</div>;
}
