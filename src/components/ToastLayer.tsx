import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "lucide-react";
import { useUiLanguage } from "../ui-language";
import { translateUi } from "../i18n";
const eventName = "meeting-memo-toast";
export function showToast(message: string) { window.dispatchEvent(new CustomEvent(eventName, { detail: message })); }
export function ToastLayer() {
  const language = useUiLanguage();
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (typeof value !== "string" || !value) return;
      if (timer.current) clearTimeout(timer.current);
      setMessage(value); timer.current = setTimeout(() => setMessage(""), 4500);
    };
    window.addEventListener(eventName, receive);
    return () => { window.removeEventListener(eventName, receive); if (timer.current) clearTimeout(timer.current); };
  }, []);
  return message ? createPortal(<div className="toast-layer" role="status" aria-live="polite"><CheckCircle2 size={18} aria-hidden="true" /><span>{message}</span><button type="button" aria-label={translateUi(language, "Dismiss notification", "\u5173\u95ed\u63d0\u793a")} onClick={() => setMessage("")}><X size={16} /></button></div>, document.body) : null;
}
