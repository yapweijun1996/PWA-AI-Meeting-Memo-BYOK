import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, FileAudio, MessageSquareText } from "lucide-react";
import { useUiLanguage } from "../ui-language";
import { translateMessage } from "../ui-messages";
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const language = useUiLanguage();
  const [error, setError] = useState("");
  useEffect(() => {
    const listener = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    addEventListener("memo-operation-error", listener);
    return () => removeEventListener("memo-operation-error", listener);
  }, []);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    d?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} aria-label={title} onCancel={onClose}>
      <header className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={language === "zh-CN" ? "关闭对话框" : "Close dialog"}
        >
          <X size={20} />
        </button>
      </header>
      {error && (
        <div className="notice danger modal-error" role="alert">
          {translateMessage(error, language)}
        </div>
      )}
      {children}
    </dialog>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  const language = useUiLanguage();
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark">
        <MessageSquareText size={22} />
      </span>
      <span>
        Meeting<span className="brand-light">Memo</span>
        {!small && <small>{language === "zh-CN" ? "您的会议工作空间" : "YOUR MEETING WORKSPACE"}</small>}
      </span>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="empty">
      <div className="empty-symbol">
        <FileAudio size={32} strokeWidth={1.5} />
      </div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export type PillTone = "neutral" | "green" | "sand" | "danger" | "light";
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: PillTone;
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
