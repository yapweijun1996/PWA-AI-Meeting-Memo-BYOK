import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  label: string;
  value: string;
  disabled: boolean;
  failureText: string;
  showTools: boolean;
  autoFocus?: boolean;
  headingText: string;
  bulletText: string;
  onSave: (text: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onSelectionChange: (start: number, end: number, text: string) => void;
};

/** A single source-bound paragraph; unsaved text stays visible after failures. */
export function MemoEditorField({ label, value, disabled, failureText, showTools, autoFocus = false, headingText, bulletText, onSave, onDirtyChange, onSelectionChange }: Props) {
  const [draft, setDraft] = useState(value);
  const [failed, setFailed] = useState(false);
  const [, renderSaved] = useState(0);
  const current = useRef(value), saved = useRef(value), saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const callbacks = useRef({ onSave, onDirtyChange });
  callbacks.current = { onSave, onDirtyChange };
  const mounted = useRef(true);
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saving.current || current.current === saved.current) return;
    if (!current.current.trim()) { if (mounted.current) setFailed(true); window.dispatchEvent(new Event("memo-draft-failed")); return; }
    const sent = current.current;
    saving.current = true;
    try {
      await callbacks.current.onSave(sent);
      saved.current = sent;
      if (mounted.current) { setFailed(false); renderSaved(version => version + 1); }
      const dirty = current.current !== saved.current;
      callbacks.current.onDirtyChange(dirty);
      if (dirty) timer.current = setTimeout(() => void flush(), 700);
    } catch (error) {
      // Retain the visible draft; a later edit or blur can retry explicitly.
      if (mounted.current) setFailed(true);
      window.dispatchEvent(new CustomEvent("memo-draft-failed", { detail: error }));
    } finally {
      saving.current = false;
      if (mounted.current) { renderSaved(version => version + 1); if (current.current === saved.current) setFailed(false); }
      callbacks.current.onDirtyChange(current.current !== saved.current);
    }
  }, []);
  useEffect(() => {
    if (!saving.current && current.current === saved.current && value !== saved.current) {
      current.current = value;
      saved.current = value;
      setDraft(value);
    }
  }, [value]);
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current.current !== saved.current || saving.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      void flush();
    };
  }, [flush]);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const resize = () => { field.style.height = "auto"; field.style.height = `${field.scrollHeight + 2}px`; };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(field);
    return () => observer.disconnect();
  }, [draft]);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  const dirty = draft !== saved.current || saving.current;
  function updateDraft(next: string) {
    current.current = next;
    setDraft(next);
    setFailed(false);
    callbacks.current.onDirtyChange(next !== saved.current || saving.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }
  function insertPrefix(prefix: string) {
    const field = input.current;
    if (!field) return;
    const start = field.selectionStart;
    const lineStart = field.value.lastIndexOf("\n", start - 1) + 1;
    updateDraft(field.value.slice(0, lineStart) + prefix + field.value.slice(lineStart));
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + prefix.length, start + prefix.length); });
  }
  return <>
    <textarea ref={input} aria-label={label} value={draft} rows={Math.max(2, Math.min(6, Math.ceil(draft.length / 90)))} disabled={disabled}
      data-unsaved-edit={dirty ? "true" : undefined}
      onSelect={event => onSelectionChange(event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.currentTarget.value)}
      onChange={event => {
        updateDraft(event.currentTarget.value);
      }}
      onBlur={() => void flush()}
    />
    {showTools && <div className="memo-text-tools"><button type="button" className="text-button small" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => insertPrefix("# ")}>{headingText}</button><button type="button" className="text-button small" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => insertPrefix("- ")}>{bulletText}</button></div>}
    {failed && <span role="status" data-memo-save-error="true" className="small danger-text">{failureText}</span>}
  </>;
}
