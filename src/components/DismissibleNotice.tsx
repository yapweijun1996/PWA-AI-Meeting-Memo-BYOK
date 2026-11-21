import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { dismissNotice, noticeReminderDelay, noticeStorageKey, shouldShowNotice } from "../storage/weekly-reminder";
import { IconButton } from "./controls";
import { Icon } from "./Icon";

function focusContentAfter(button: HTMLButtonElement) {
  const main = button.closest("main");
  if (!main) return;
  const heading = main.querySelector<HTMLElement>("h1");
  if (heading) {
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus();
    return;
  }
  const controls = main.querySelectorAll<HTMLElement>(
    'a[href], button:enabled, input:enabled, select:enabled, textarea:enabled, [tabindex="0"]',
  );
  const next = Array.from(controls).find(element =>
    (button.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
    element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
  (next ?? main).focus();
}

export function DismissibleNotice({ id, dismissLabel, children }: {
  id: string;
  dismissLabel: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(() => shouldShowNotice(id));
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(function checkReminder() {
    window.clearTimeout(timer.current);
    const delay = noticeReminderDelay(id);
    if (delay && button.current && button.current === document.activeElement) focusContentAfter(button.current);
    setVisible(delay === 0);
    if (delay) timer.current = window.setTimeout(checkReminder, delay);
  }, [id]);

  useEffect(() => {
    const key = noticeStorageKey(id);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, refresh]);

  if (!visible) return null;
  return <div className="notice dismissible-notice" role="status">
    <span>{children}</span>
    <IconButton ref={button} label={dismissLabel} onClick={event => {
      dismissNotice(id);
      focusContentAfter(event.currentTarget);
      refresh();
    }}>
      <Icon glyph={X} size="status" aria-hidden="true" />
    </IconButton>
  </div>;
}
