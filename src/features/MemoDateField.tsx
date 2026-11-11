import { useEffect, useRef, useState } from "react";

type Props = { value: string; disabled: boolean; label: string; failureText: string; onDirtyChange: (dirty: boolean) => void; onSave: (value: string) => Promise<void> };
export function MemoDateField({ value, disabled, label, failureText, onDirtyChange, onSave }: Props) {
  const [draft, setDraft] = useState(value);
  const [failed, setFailed] = useState(false);
  const [, renderSaved] = useState(0);
  const current = useRef(value), saved = useRef(value), writing = useRef(false);
  const callbacks = useRef({ onSave, onDirtyChange });
  callbacks.current = { onSave, onDirtyChange };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (writing.current || current.current === saved.current) return;
    const sent = current.current;
    writing.current = true;
    try {
      await callbacks.current.onSave(sent);
      saved.current = sent;
      setFailed(false);
      callbacks.current.onDirtyChange(current.current !== sent);
      if (current.current !== sent) timer.current = setTimeout(() => void flush(), 700);
    } catch (error) { setFailed(true); window.dispatchEvent(new CustomEvent("memo-draft-failed", { detail: error })); }
    finally {
      writing.current = false;
      renderSaved(version => version + 1);
      if (current.current === saved.current) setFailed(false);
      callbacks.current.onDirtyChange(current.current !== saved.current);
    }
  }
  useEffect(() => {
    if (!writing.current && current.current === saved.current && value !== saved.current) {
      current.current = value; saved.current = value; setDraft(value);
    }
  }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <>
    <input aria-label={label} data-action-due="true" type="date" value={draft} disabled={disabled} data-unsaved-edit={draft !== saved.current || writing.current ? "true" : undefined}
      onChange={event => { const next = event.currentTarget.value; current.current = next; setDraft(next); setFailed(false); callbacks.current.onDirtyChange(next !== saved.current || writing.current); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 700); }}
      onBlur={() => void flush()} />
    {failed && <span role="status" data-memo-save-error="true" className="small danger-text">{failureText}</span>}
  </>;
}
