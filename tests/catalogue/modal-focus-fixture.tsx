import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../../src/components/ui";

// Test-only entry: real Modal, native dialogs, no app initialization or provider calls.
function ReplayProbe() {
  useEffect(() => {
    document.body.dataset.effectSetups = String(Number(document.body.dataset.effectSetups ?? 0) + 1);
  }, []);
  return <button data-initial-focus>Initial control</button>;
}

function FocusFixture() {
  const [mode, setMode] = useState<string | null>(null);
  const [openerVersion, setOpenerVersion] = useState(0);
  const [removed, setRemoved] = useState(false);
  const [inner, setInner] = useState(false);
  function close() {
    if (mode === "removed") setRemoved(true);
    if (mode === "replaced") setOpenerVersion(value => value + 1);
    if (mode === "explicit") requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("#explicit-target")?.focus());
    setMode(null);
  }
  return <>
    {["basic", "explicit", "removed", "replaced", "transition", "outer"].map(value =>
      (value !== "removed" || !removed) && <button key={`${value}-${value === "replaced" ? openerVersion : 0}`} onClick={() => setMode(value)}>Open {value}</button>,
    )}
    <button id="explicit-target">Caller focus target</button>
    {mode && <Modal key={mode} title={mode} onClose={close}>
      {mode === "outer" ? <button data-initial-focus onClick={() => setInner(true)}>Open inner</button> : <ReplayProbe />}
      {mode === "transition" && <button onClick={() => setMode("replacement")}>Replace dialog</button>}
      <button onClick={close}>Done</button>
    </Modal>}
    {inner && <Modal title="inner" onClose={() => setInner(false)}><button data-initial-focus>Inner initial control</button></Modal>}
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><FocusFixture /></StrictMode>);
