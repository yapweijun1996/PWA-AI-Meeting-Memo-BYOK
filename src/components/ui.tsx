import { useEffect, useRef, type ReactNode } from "react";
import { X, FileAudio, MessageSquareText } from "lucide-react";
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
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} aria-label={title} onCancel={onClose}>
      <header className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark">
        <MessageSquareText size={22} />
      </span>
      <span>
        Meeting<span className="brand-light">Memo</span>
        {!small && <small>YOUR MEETING WORKSPACE</small>}
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
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
