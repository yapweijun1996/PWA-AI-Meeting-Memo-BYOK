import { useEffect, useRef } from "react";

/** Keeps the floating control clear of the actual player, including wrapped layouts. */
export function useBackToTopPosition(visible: boolean) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const button = buttonRef.current;
    if (!visible || !button) return;

    let player: Element | null = null;
    const update = () => {
      if (!player) {
        button.style.removeProperty("bottom");
        return;
      }
      const bounds = player.getBoundingClientRect();
      button.style.bottom = `${Math.max(0, window.innerHeight - bounds.top) + 12}px`;
    };
    const resizeObserver = new ResizeObserver(update);
    const findPlayer = () => {
      const next = document.querySelector(".audio-player");
      if (next === player) return;
      if (player) resizeObserver.unobserve(player);
      player = next;
      if (player) resizeObserver.observe(player);
      update();
    };
    const mutationObserver = new MutationObserver(findPlayer);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    findPlayer();
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [visible]);

  return buttonRef;
}
