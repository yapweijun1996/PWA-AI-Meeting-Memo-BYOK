import { useState, type FormEvent } from "react";
import { FileAudio, FileText, Plus, Upload, Check } from "lucide-react";
import {
  createMeeting,
  importTranscript,
  validateMeeting,
  type Meeting,
} from "../domain/model";
import { saveMeeting } from "../storage/repository";
import { inspectAudio } from "../audio/files";
import { Modal } from "../components/ui";
export function NewMeeting({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (m: Meeting) => void;
  onError: (s: string) => void;
}) {
  const [file, setFile] = useState<File>(),
    [transcript, setTranscript] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      let m = createMeeting({
        title: String(form.get("title")).trim(),
        date: String(form.get("date")),
        timezone: String(form.get("timezone")),
        languages: String(form.get("languages")),
        kind: form.get("kind") === "erp" ? "erp" : "general",
        attendees: String(form.get("attendees"))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        glossary: String(form.get("glossary")),
      });
      if (transcript.trim()) {
        const imported = transcript.trim().startsWith("{")
          ? validateMeeting(JSON.parse(transcript))
          : importTranscript(transcript);
        m = { ...m, speakers: imported.speakers, segments: imported.segments };
      }
      if (file) m.audio = await inspectAudio(file);
      const saved = await saveMeeting(m, file);
      onCreated(saved);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "The meeting could not be saved.";
      setError(message);
      onError("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Make space for a new meeting"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="modal-body">
        <p className="muted">
          A recording, a transcript, or just a title to get started.
        </p>
        {error && (
          <div className="notice danger" role="alert">
            {error}
          </div>
        )}
        <label>
          Meeting title
          <input
            name="title"
            required
            maxLength={160}
            placeholder="e.g. ERP workflow discovery"
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            Date
            <input
              type="date"
              name="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              required
              defaultValue={
                Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
              }
            />
          </label>
        </div>
        <label className={`upload-zone ${file ? "has-file" : ""}`}>
          <span>{file ? <Check size={25} /> : <Upload size={25} />}</span>
          <strong>{file ? file.name : "Drop into a clearer workflow"}</strong>
          <small>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB · stays on this device until you confirm`
              : "Choose an audio recording · up to 50 MB"}
          </small>
          <input
            aria-label="Audio recording"
            type="file"
            accept="audio/*,.mp4,.m4a,.webm,.flac"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
          <span className="button secondary compact">
            <FileAudio size={15} />
            {file ? "Change recording" : "Browse files"}
          </span>
        </label>
        <details>
          <summary>
            <FileText size={16} />
            Start from a transcript instead
          </summary>
          <label className="text-file">
            Import TXT or a Meeting Memo JSON file
            <input
              type="file"
              accept=".txt,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 2_000_000) {
                  setError("Transcript import is limited to 2 MB.");
                  return;
                }
                setTranscript(await f.text());
              }}
            />
          </label>
          <label>
            Transcript
            <textarea
              rows={5}
              maxLength={2_000_000}
              value={transcript}
              placeholder={
                "Jamie: What should we review?\nAlex: The inventory workflow."
              }
              onChange={(e) => setTranscript(e.target.value)}
            />
          </label>
          <p className="small muted">
            Names are unconfirmed. Plain text has no audio timing; playback
            links are only created for real timed evidence.
          </p>
        </details>
        <details>
          <summary>
            Meeting context <span className="small muted">optional</span>
          </summary>
          <div className="form-row">
            <label>
              Languages
              <input
                name="languages"
                defaultValue="Chinese, English"
                maxLength={100}
              />
            </label>
            <label>
              Meeting type
              <select name="kind">
                <option value="general">General meeting</option>
                <option value="erp">ERP discovery</option>
              </select>
            </label>
          </div>
          <label>
            Attendees
            <input
              name="attendees"
              placeholder="Jamie, Alex"
              maxLength={1000}
            />
          </label>
          <label>
            Terms & context
            <textarea
              name="glossary"
              rows={2}
              maxLength={2000}
              placeholder="Product names, ERP modules, acronyms…"
            />
          </label>
        </details>
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy} type="submit">
            <Plus size={17} />
            {busy ? "Saving locally…" : "Create meeting"}
          </button>
        </div>
        <p className="small muted center">
          No AI request is made when you create a meeting.
        </p>
      </form>
    </Modal>
  );
}
