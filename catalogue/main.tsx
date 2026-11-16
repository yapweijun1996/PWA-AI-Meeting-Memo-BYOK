import { Button, IconButton, Field, Tabs, Tab } from "../src/components/controls";
import { Check, X } from "lucide-react";
import { Icon, ICON_SIZES, type IconSize } from "../src/components/Icon";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Brand, Empty, Modal, Pill } from "../src/components/ui";
import { LoadingPlaceholder } from "../src/components/LoadingPlaceholder";
import { SpeakerAvatar } from "../src/components/SpeakerAvatar";
import { ToastLayer, showToast } from "../src/components/ToastLayer";
import { TooltipLayer } from "../src/components/TooltipLayer";
import { MemoEditorField } from "../src/features/MemoEditorField";
import "../src/style.css";
import "../src/theme.css";
import "../src/features/memo-reading.css";
import "./catalogue.css";

const sampleAvatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#d8e8da"/><circle cx="24" cy="18" r="8" fill="#47604c"/><path d="M8 45c0-10 7-16 16-16s16 6 16 16" fill="#47604c"/></svg>')}`;
const editorInitial = "The next review step is documented here.\nSelect a line and try the heading or bullet tools.";

function Catalogue() {
  const [modalOpen, setModalOpen] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [controlCount, setControlCount] = useState(0);
  const [controlDraft, setControlDraft] = useState("Local draft");
  const [controlTab, setControlTab] = useState("first");
  const [blockTabs, setBlockTabs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editorValue, setEditorValue] = useState(editorInitial);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSave, setEditorSave] = useState("Saved in this tab's memory");
  const failNextSave = useRef(false);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function simulateLocalLoad() {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    setLoading(true);
    loadingTimer.current = setTimeout(() => {
      setLoading(false);
      loadingTimer.current = null;
    }, 1100);
  }

  async function saveEditorDraft(next: string) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (failNextSave.current) {
      failNextSave.current = false;
      setEditorSave("Save failed; the editor kept the draft");
      throw new Error("Synthetic catalogue save failure");
    }
    setEditorValue(next);
    setEditorSave("Saved in this tab's memory");
  }

  return (
    <>
      <TooltipLayer />
      <ToastLayer />
      <main className="catalogue-shell">
        <header className="catalogue-header">
          <Brand small />
          <p className="catalogue-owner-tag">Developer reference · actual component owners</p>
        </header>

        <section className="catalogue-intro" aria-labelledby="catalogue-title">
          <div>
            <p className="catalogue-kicker">Shared UI / DS04</p>
            <h1 id="catalogue-title">Components in context</h1>
            <p className="catalogue-lede">A synthetic, local-only view of the shared components and their current interaction contracts.</p>
          </div>
          <p className="catalogue-scope">This catalogue imports the current owners. It does not initialize a meeting, provider key, or backend.</p>
        </section>

        <div className="catalogue-grid">
          <section className="catalogue-card catalogue-card--wide" aria-labelledby="status-title">
            <div className="catalogue-section-heading">
              <div><p className="catalogue-kicker">src/components/ui.tsx</p><h2 id="status-title">Brand and status</h2></div>
              <p>Visible text carries each status; color is secondary.</p>
            </div>
            <div className="catalogue-brand-row"><Brand /><Brand small /></div>
            <div className="catalogue-pill-row" aria-label="Pill tone examples">
              <Pill tone="neutral">Waiting for review</Pill>
              <Pill tone="green">Saved</Pill>
              <Pill tone="sand">Needs attention</Pill>
              <Pill tone="danger">Save failed</Pill>
              <Pill tone="light">Local preview</Pill>
            </div>
          </section>

          <section className="catalogue-card" aria-labelledby="dialog-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/ui.tsx</p><h2 id="dialog-title">Native dialog</h2></div></div>
            <p className="catalogue-copy">The shared wrapper opens a native modal dialog and focuses its marked target.</p>
            <Button type="button" className="button primary" data-modal-opener onClick={event => { event.currentTarget.focus(); setModalOpen(true); }}>Open sample dialog</Button>
            {modalOpen && <Modal title="Component sample" onClose={() => setModalOpen(false)} className="catalogue-dialog">
              <div className="modal-body">
              <p>This dialog has no persistent draft. Escape or close it to dismiss it.</p>
                <Button type="button" className="button secondary" data-initial-focus>Focused on open</Button>
              </div>
            </Modal>}
          </section>

          <section className="catalogue-card" aria-labelledby="tooltip-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/TooltipLayer.tsx</p><h2 id="tooltip-title">Keyboard hint</h2></div></div>
            <p className="catalogue-copy">Tab to the control. Escape dismisses the hint; its accessible name stays on the button.</p>
            <Button type="button" className="text-button" data-tooltip="A short keyboard and pointer hint.">Focus for a tooltip</Button>
          </section>

          <section className="catalogue-card" aria-labelledby="toast-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/ToastLayer.tsx</p><h2 id="toast-title">Transient status</h2></div></div>
            <p className="catalogue-copy">A local event demonstrates the shared polite status and its dismiss control.</p>
            <Button type="button" className="button secondary" onClick={() => showToast("Local preview saved in memory.")}>Show a status toast</Button>
          </section>

          <section className="catalogue-card" aria-labelledby="empty-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/ui.tsx</p><h2 id="empty-title">Empty state</h2></div></div>
            <Empty title="No saved catalogue items">
              <p>This reference page keeps its examples in memory only.</p>
              <a className="text-button" href="#editor-sample">Review the editor example</a>
            </Empty>
          </section>

          <section className="catalogue-card" aria-labelledby="loading-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/LoadingPlaceholder.tsx</p><h2 id="loading-title">Loading state</h2></div></div>
            <p className="catalogue-copy">A short local transition displays the library placeholder while its preview state is loading.</p>
            <Button type="button" className="button secondary" onClick={simulateLocalLoad} disabled={loading}>Simulate local loading</Button>
            {loading && <LoadingPlaceholder kind="library" label="Loading local catalogue preview" />}
          </section>

          <section className="catalogue-card catalogue-card--wide" aria-labelledby="controls-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/controls.tsx</p><h2 id="controls-title">Shared controls</h2></div></div>
            <Field label="Synthetic shared field" hint="This draft stays in this tab" error={controlDraft ? undefined : "Enter a synthetic value"}>
              <input value={controlDraft} onChange={event => setControlDraft(event.target.value)} />
            </Field>
            <div className="catalogue-actions">
              <Button className="button primary" pending={controlPending} onClick={() => {
                setControlCount(count => count + 1); setControlPending(true);
                setTimeout(() => setControlPending(false), 300);
              }}>Run synthetic operation</Button>
              <IconButton label="Clear synthetic field" onClick={() => setControlDraft("")}><Icon glyph={X} size="transport" /></IconButton>
              <span role="status">Synthetic operation count: {controlCount}</span>
            </div>
            <label><input type="checkbox" checked={blockTabs} onChange={event => setBlockTabs(event.target.checked)} /> Block synthetic tab changes</label>
            <Tabs className="settings-tabs" label="Synthetic shared tabs" onValueChange={value => {
              if (blockTabs) return false;
              setControlTab(value);
            }}>
              {["first", "second", "disabled"].map(value => <Tab key={value} value={value} selected={controlTab === value} disabled={value === "disabled"}
                id={`control-tab-${value}`} aria-controls={`control-panel-${value}`}>{value} control tab</Tab>)}
            </Tabs>
            {["first", "second", "disabled"].map(value => <div key={value} role="tabpanel" id={`control-panel-${value}`} aria-labelledby={`control-tab-${value}`} hidden={controlTab !== value}>{value} synthetic panel</div>)}
          </section>

          <section className="catalogue-card" aria-labelledby="icon-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/Icon.tsx</p><h2 id="icon-title">Shared icon sizes</h2></div></div>
            <p>Lucide owns glyphs; the shared API preserves existing physical dimensions. Controls own accessible names.</p>
            <div className="catalogue-row">{Object.entries(ICON_SIZES).map(([size, pixels]) => <span key={size}><Icon glyph={Check} size={size as IconSize} aria-hidden="true" /> {size} ({pixels}px)</span>)}</div>
          </section>

          <section className="catalogue-card" aria-labelledby="avatar-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/components/SpeakerAvatar.tsx</p><h2 id="avatar-title">Decorative avatars</h2></div></div>
            <p className="catalogue-copy">The renderer is decorative; adjacent text owns these synthetic labels.</p>
            <div className="catalogue-avatar-row">
              <div className="catalogue-avatar-item"><SpeakerAvatar id="S1" /><span>Speaker 1</span><Pill tone="neutral">Unconfirmed</Pill></div>
              <div className="catalogue-avatar-item"><SpeakerAvatar id="S2" image={sampleAvatar} /><span>Speaker 2</span><Pill tone="neutral">Unconfirmed</Pill></div>
            </div>
          </section>

          <section className="catalogue-card catalogue-card--wide" id="editor-sample" aria-labelledby="editor-title">
            <div className="catalogue-section-heading"><div><p className="catalogue-kicker">src/features/MemoEditorField.tsx</p><h2 id="editor-title">Source-bound editor behavior</h2></div><p>Local callback only; edits never leave this page.</p></div>
            <div className="catalogue-editor-controls">
              <label className="catalogue-checkbox"><input type="checkbox" onChange={(event) => { failNextSave.current = event.currentTarget.checked; setEditorSave(event.currentTarget.checked ? "Next save will fail once" : "Saved in this tab's memory"); }} /> Fail the next save once</label>
              <span className="catalogue-editor-status" role="status">{editorDirty ? "Unsaved local draft" : editorSave}</span>
            </div>
            <MemoEditorField label="Synthetic paragraph draft" value={editorValue} disabled={false}
              failureText="Synthetic save failed. Your draft is still here; edit or blur to retry."
              showTools headingText="Heading" bulletText="Bullet"
              onSave={saveEditorDraft} onDirtyChange={setEditorDirty} onSelectionChange={() => undefined} />
            <p className="catalogue-copy catalogue-editor-disabled-label">Disabled field variant</p>
            <MemoEditorField label="Disabled synthetic paragraph" value="This paragraph is read-only in this sample." disabled failureText="Not available" showTools={false}
              headingText="Heading" bulletText="Bullet" onSave={async () => undefined} onDirtyChange={() => undefined} onSelectionChange={() => undefined} />
          </section>
        </div>

        <footer className="catalogue-footer"><span>Actual shared components · synthetic content · local tab memory</span><a href="#catalogue-title">Back to top</a></footer>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Catalogue />);
