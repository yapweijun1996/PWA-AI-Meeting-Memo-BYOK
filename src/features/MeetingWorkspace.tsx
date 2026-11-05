import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  Download,
  FileText,
  History,
  Pause,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Users,
} from "lucide-react";
import type { Meeting, MemoItem, Segment } from "../domain/model";
import { id, importTranscript } from "../domain/model";
import {
  assignSegments,
  editMeeting,
  editSegment,
  formatTime,
  markdown,
  mergeSpeakers,
  replaceTranscript,
  resolveSource,
  speakerName,
  splitSegment,
  undoEdit,
} from "../domain/operations";
import { getAudio, getMeeting, saveMeeting } from "../storage/repository";
import { backupMeeting, download, safeFilename } from "../storage/backup";
import { inspectAudio } from "../audio/files";
import { getKey, getSelection, getSpeechRate } from "../providers/credentials";
import { cancelProcessing, runJob, isProcessingMeeting } from "../jobs/runner";
import { Empty, Modal, Pill } from "../components/ui";
export function MeetingWorkspace({
  meeting: m,
  onUpdate,
  onDelete,
  onError,
}: {
  meeting: Meeting;
  onUpdate: (m: Meeting) => void;
  onDelete: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [tab, setTab] = useState("transcript"),
    [saving, setSaving] = useState(false),
    [processing, setProcessing] = useState(() => isProcessingMeeting(m.id)),
    [notice, setNotice] = useState(""),
    [confirmStage, setConfirmStage] = useState<"speech" | "memo">(),
    [metadata, setMetadata] = useState(false),
    [addText, setAddText] = useState(false),
    [newText, setNewText] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [assignment, setAssignment] = useState(""),
    [editing, setEditing] = useState<Segment>(),
    [splitting, setSplitting] = useState<Segment>(),
    [merge, setMerge] = useState<string>(),
    [highlight, setHighlight] = useState(""),
    [pendingOnly, setPendingOnly] = useState(false);
  const [url, setUrl] = useState(""),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(m.audio?.duration || 0),
    [audioMissing, setAudioMissing] = useState(false);
  const player = useRef<HTMLAudioElement>(null),
    playUntil = useRef<number | null>(null);
  const [evidence, setEvidence] = useState<Segment>();
  const locked = saving || processing;
  useEffect(() => {
    const changed = () => setProcessing(isProcessingMeeting(m.id));
    addEventListener("memo-processing-changed", changed);
    return () => removeEventListener("memo-processing-changed", changed);
  }, [m.id]);
  useEffect(() => {
    let cancelled = false,
      object = "";
    void getAudio(m.id)
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          object = URL.createObjectURL(blob);
          setUrl(object);
          setAudioMissing(false);
        } else {
          setUrl("");
          setAudioMissing(!!m.audio);
        }
      })
      .catch(() => setAudioMissing(true));
    return () => {
      cancelled = true;
      if (object) URL.revokeObjectURL(object);
    };
  }, [m.id, m.audio?.hash, m.audio?.present]);
  async function persist(next: Meeting, blob?: Blob) {
    setSaving(true);
    try {
      const saved = await saveMeeting(next, blob);
      onUpdate(saved);
      return saved;
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : "Could not save locally. Export your work and check available storage.",
      );
      throw e;
    } finally {
      setSaving(false);
    }
  }
  async function persistQuietly(next: Meeting) {
    try {
      await persist(next);
    } catch {
      /* preserve the last saved state and show feedback */
    }
  }
  function reviewMemoItem(
    versionId: string,
    itemId: string,
    state: "accepted" | "pending" | "rejected",
    article: Element | null,
  ) {
    const text = article?.querySelector("textarea")?.value;
    const owner = (
      article?.querySelector(
        'select[aria-label="Action owner"]',
      ) as HTMLSelectElement | null
    )?.value;
    const due = (
      article?.querySelector(
        'input[aria-label="Action due date"]',
      ) as HTMLInputElement | null
    )?.value;
    if (state !== "rejected" && !text?.trim()) {
      onError("Add note text before accepting or reviewing it.");
      return;
    }
    void persistQuietly({
      ...m,
      memos: m.memos.map((v) =>
        v.id === versionId
          ? {
              ...v,
              items: v.items.map((x) =>
                x.id === itemId
                  ? {
                      ...x,
                      text: text?.trim() || x.text,
                      ...(owner !== undefined
                        ? { ownerId: owner || null }
                        : {}),
                      ...(due !== undefined ? { dueDate: due || null } : {}),
                      review: state,
                      reviewedRevision: m.revision,
                    }
                  : x,
              ),
            }
          : v,
      ),
    });
  }
  async function change(fn: (m: Meeting) => Meeting) {
    try {
      await persist(fn(m));
    } catch {
      /* feedback is displayed without clearing the editor */
    }
  }
  function cue(s: Segment) {
    if (s.start === null || !player.current) {
      setNotice("This source has no playable local audio range.");
      return;
    }
    playUntil.current = s.end;
    player.current.currentTime = s.start;
    void player.current
      .play()
      .catch(() =>
        setNotice(
          "Playback could not start. Check this browser supports the recording format.",
        ),
      );
  }
  async function process() {
    if (!confirmStage) return;
    const stage = confirmStage;
    setConfirmStage(undefined);
    setProcessing(true);
    setNotice("Request submitted. Keep this page open.");
    try {
      const completed = await runJob(m, stage);
      onUpdate(completed);
      setViewVersion(undefined);
      setNotice(
        stage === "speech"
          ? "Transcript ready. Review speakers and passages before making notes."
          : "New memo version ready for review.",
      );
      setTab(
        stage === "speech"
          ? completed.speakers.length
            ? "speakers"
            : "transcript"
          : "memo",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Processing did not complete.");
      const latest = await getMeeting(m.id);
      if (latest) onUpdate(latest);
    } finally {
      setProcessing(false);
    }
  }
  async function attach(file?: File) {
    if (!file) return;
    setSaving(true);
    try {
      const info = await inspectAudio(file);
      if (m.audio && m.audio.hash !== info.hash)
        throw new Error(
          "This meeting belongs to a different recording. Create a new meeting to preserve its source evidence.",
        );
      if (
        !m.audio &&
        m.segments.some((s) => s.start !== null) &&
        !confirm(
          "Confirm this is the original recording for the imported timestamps. Verify playback before relying on the evidence.",
        )
      )
        return;
      onUpdate(await saveMeeting({ ...m, audio: info }, file));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not attach recording.");
    } finally {
      setSaving(false);
    }
  }
  async function exportFile(format: "md" | "txt" | "json" | "zip") {
    try {
      const blob =
        format === "zip"
          ? await backupMeeting(m)
          : new Blob(
              [
                format === "json"
                  ? JSON.stringify(
                      {
                        ...m,
                        audio: m.audio ? { ...m.audio, present: false } : null,
                      },
                      null,
                      2,
                    )
                  : markdown(m, viewVersion),
              ],
              { type: format === "json" ? "application/json" : "text/plain" },
            );
      download(blob, `${safeFilename(m.title)}.${format}`);
    } catch {
      onError(
        "Could not create a backup. Check local audio access and available memory.",
      );
    }
  }
  async function markInterrupted() {
    try {
      if (navigator.locks) {
        const locks = await navigator.locks.query();
        if (locks.held?.some((l) => l.name === `meeting-memo-job:${m.id}`))
          throw new Error("Another tab is still processing this meeting.");
      }
      if (
        !confirm(
          "Mark the unfinished request as outcome unknown? This does not cancel remote processing or make a retry free. Check your provider account before submitting again.",
        )
      )
        return;
      await persist({
        ...m,
        jobs: m.jobs.map((j) =>
          j.state === "in_flight"
            ? {
                ...j,
                state: "outcome_unknown",
                billing: "possibly_charged",
                message:
                  "Manually marked interrupted. Review the provider account before retrying.",
              }
            : j,
        ),
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not resolve job state.");
    }
  }
  const [viewVersion, setViewVersion] = useState<string>();
  const memo = m.memos.find((v) => v.id === viewVersion) || m.memos.at(-1),
    unknown = m.speakers.filter((s) => !s.confirmed).length,
    pending = m.segments.filter((s) => !s.reviewed).length;
  const segments = pendingOnly
    ? m.segments.filter((s) => !s.reviewed)
    : m.segments;
  return (
    <div className={url ? "workspace has-player" : "workspace"}>
      <a href="#/" className="back-link">
        <ArrowLeft size={15} />
        All meetings
      </a>
      <section className="page-heading meeting-heading">
        <div>
          <div className="eyebrow">
            {m.kind === "erp" ? "ERP DISCOVERY" : "MEETING WORKSPACE"}{" "}
            {m.synthetic && <Pill tone="sand">Synthetic example</Pill>}
          </div>
          <h1>{m.title}</h1>
          <p>
            {m.date} <span>·</span> {m.timezone} <span>·</span>{" "}
            {m.languages || "Languages not specified"}
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            aria-label="Edit meeting details"
            onClick={() => setMetadata(true)}
            disabled={locked}
          >
            <Settings size={19} />
          </button>
          <details className="export-menu">
            <summary className="button secondary">
              <Download size={16} />
              Export
              <ChevronDown size={14} />
            </summary>
            <div>
              {(["md", "txt", "json", "zip"] as const).map((f) => (
                <button key={f} onClick={() => void exportFile(f)}>
                  {f === "zip"
                    ? "Full backup with audio"
                    : f === "json"
                      ? "Meeting JSON (no audio)"
                      : `${f.toUpperCase()} notes`}
                </button>
              ))}
            </div>
          </details>
          <button
            className="icon-button danger-text"
            aria-label="Delete meeting"
            disabled={locked}
            onClick={async () => {
              if (
                confirm(
                  `Delete “${m.title}” and its local recording? Export a backup first if needed.`,
                )
              ) {
                try {
                  await onDelete();
                } catch (e) {
                  onError(String(e));
                }
              }
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </section>
      <div className="workspace-toolbar">
        <div className="recording-info">
          <span className="round-icon">
            <AudioLines size={21} />
          </span>
          <div>
            <strong>{m.audio?.name || "No recording attached"}</strong>
            <small>
              {m.audio
                ? `${(m.audio.size / 1024 / 1024).toFixed(1)} MB${duration ? ` · ${formatTime(duration)}` : ""}${audioMissing ? " · audio missing on this device" : ""}`
                : "Import audio to transcribe, or work from a transcript."}
            </small>
          </div>
        </div>
        <div className="toolbar-actions">
          <label className="button secondary compact">
            <Upload size={15} />
            {m.audio ? "Reattach source" : "Attach audio"}
            <input
              aria-label="Attach audio"
              type="file"
              accept="audio/*,.m4a,.mp4,.webm,.flac"
              disabled={locked}
              onChange={(e) => void attach(e.target.files?.[0])}
            />
          </label>
          <button
            className="button primary compact"
            onClick={() => setConfirmStage("speech")}
            disabled={locked || !url}
          >
            <AudioLines size={15} />
            Transcribe
          </button>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {m.jobs.some((j) => j.state === "in_flight") && !processing && (
        <div className="notice sand">
          <span>
            An unfinished request is recorded. It may be active in another tab
            or already billable.
          </span>
          <button
            className="button secondary compact"
            onClick={() => void markInterrupted()}
          >
            Review interruption
          </button>
          <button
            className="text-button"
            onClick={async () => {
              const latest = await getMeeting(m.id);
              if (latest) onUpdate(latest);
            }}
          >
            Reload state
          </button>
        </div>
      )}
      {processing && (
        <div className="notice update" role="status">
          <span className="spinner" />
          <span>
            Processing with your provider. Completed results are saved locally.
            Keep this page open.
          </span>
          <button
            className="button secondary compact"
            onClick={cancelProcessing}
          >
            Stop waiting
          </button>
        </div>
      )}
      <div className="workspace-tabs" role="tablist" aria-label="Meeting views">
        {[
          ["transcript", "Transcript", FileText, m.segments.length],
          ["speakers", "Speakers", Users, m.speakers.length],
          ["memo", "Meeting notes", Sparkles, memo?.items.length || 0],
        ].map(([value, label, Icon, count]) => {
          const Glyph = Icon as typeof FileText;
          return (
            <button
              key={String(value)}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(String(value))}
            >
              <Glyph size={17} />
              {String(label)}
              <span>{String(count)}</span>
            </button>
          );
        })}
        <span className="save-state">
          <span className="status-dot" />
          {saving ? "Saving…" : "Saved locally"}
        </span>
      </div>
      {tab === "transcript" && (
        <section className="workspace-panel">
          <header className="panel-toolbar">
            <div>
              <h2>The conversation</h2>
              <p>
                {pending} passages to review · {unknown} unconfirmed speakers
              </p>
            </div>
            <div className="toolbar-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={pendingOnly}
                  onChange={(e) => setPendingOnly(e.target.checked)}
                />
                Needs review
              </label>
              <button
                className="button secondary compact"
                disabled={locked || !m.undo.length}
                onClick={() => void change(undoEdit)}
              >
                <Undo2 size={15} />
                Undo
              </button>
              <button
                className="button secondary compact"
                onClick={() => setAddText(true)}
                disabled={locked}
              >
                <Plus size={15} />
                Add transcript
              </button>
            </div>
          </header>
          {selected.length > 0 && (
            <div className="bulk-bar">
              <span>{selected.length} passages selected</span>
              <select
                aria-label="Assign selected passages"
                value={assignment}
                onChange={(e) => setAssignment(e.target.value)}
              >
                <option value="">Choose speaker…</option>
                <option value="unknown">Unknown speaker</option>
                {m.speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                className="button primary compact"
                disabled={!assignment || locked}
                onClick={async () => {
                  if (
                    confirm(
                      `Reassign ${selected.length} selected passages to ${assignment === "unknown" ? "Unknown" : speakerName(m, [assignment])}? This invalidates associated notes and can be undone.`,
                    )
                  ) {
                    await change((x) =>
                      assignSegments(
                        x,
                        selected,
                        assignment === "unknown" ? [] : [assignment],
                      ),
                    );
                    setSelected([]);
                  }
                }}
              >
                Preview & assign
              </button>
              <button className="text-button" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
          )}
          {segments.length ? (
            <div className="transcript-list">
              {segments.map((s) => (
                <article
                  id={`segment-${s.id}`}
                  key={`${s.id}:${s.revision}`}
                  className={`passage ${highlight === s.id ? "highlight" : ""}`}
                >
                  <div className="passage-select">
                    <input
                      type="checkbox"
                      aria-label={`Select passage ${m.segments.indexOf(s) + 1}`}
                      checked={selected.includes(s.id)}
                      disabled={locked}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, s.id]
                            : selected.filter((x) => x !== s.id),
                        )
                      }
                    />
                  </div>
                  <div
                    className="speaker-avatar"
                    style={{
                      background: ["#e7efda", "#ede7f4", "#faeed9", "#e3edef"][
                        Math.max(
                          0,
                          m.speakers.findIndex((p) =>
                            s.speakerIds.includes(p.id),
                          ),
                        ) % 4
                      ],
                    }}
                  >
                    {speakerName(m, s.speakerIds).slice(0, 1)}
                  </div>
                  <div className="passage-content">
                    <div className="passage-meta">
                      <strong>{speakerName(m, s.speakerIds)}</strong>
                      {s.speakerIds.length > 1 && (
                        <Pill>Overlap / multiple</Pill>
                      )}
                      {s.speakerIds.some(
                        (id) =>
                          !m.speakers.find((sp) => sp.id === id)?.confirmed,
                      ) && <span className="small muted">Unconfirmed</span>}
                      <button
                        className="time-link"
                        disabled={s.start === null || !url}
                        onClick={() => cue(s)}
                      >
                        {s.start === null
                          ? "Time unknown"
                          : `${formatTime(s.start)} – ${formatTime(s.end!)}`}
                      </button>
                      {s.reviewed && <Check size={14} className="green-text" />}
                    </div>
                    <p>{s.text}</p>
                    {s.text !== s.originalText && (
                      <details className="original-text">
                        <summary>Original text</summary>
                        <p>{s.originalText}</p>
                      </details>
                    )}
                    <div className="passage-actions">
                      <button
                        className="text-button"
                        onClick={() => setEditing(s)}
                        disabled={locked}
                      >
                        Edit passage
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setSplitting(s)}
                        disabled={locked}
                      >
                        Split
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          void change((x) =>
                            editSegment(x, s.id, { reviewed: !s.reviewed }),
                          )
                        }
                        disabled={locked}
                      >
                        {s.reviewed ? "Mark unreviewed" : "Mark reviewed"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="The conversation belongs here">
              <p>
                Transcribe a recording with your own key, or add an existing
                transcript. Original results and your edits are kept separately.
              </p>
              <button
                className="button secondary"
                onClick={() => setAddText(true)}
              >
                <Plus size={16} />
                Add transcript
              </button>
            </Empty>
          )}
        </section>
      )}
      {tab === "speakers" && (
        <section className="workspace-panel">
          <header className="panel-toolbar">
            <div>
              <h2>Put a name to the voice</h2>
              <p>
                Listen first. A speaker label is a suggestion until you confirm
                it.
              </p>
            </div>
            <button
              className="button secondary compact"
              disabled={locked}
              onClick={async () => {
                const name = prompt("Name for the new speaker (unconfirmed):");
                if (name?.trim())
                  await change((x) =>
                    editMeeting(x, (d) => {
                      d.speakers.push({
                        id: id(),
                        name: name.trim().slice(0, 80),
                        confirmed: false,
                        sourceLabels: ["manual"],
                      });
                    }),
                  );
              }}
            >
              <Plus size={15} />
              Add speaker
            </button>
          </header>
          {m.speakers.length ? (
            <div className="speaker-grid">
              {m.speakers.map((s, i) => {
                const turns = m.segments.filter((t) =>
                    t.speakerIds.includes(s.id),
                  ),
                  timed = turns.reduce(
                    (sum, t) =>
                      sum +
                      (t.end !== null && t.start !== null
                        ? t.end - t.start
                        : 0),
                    0,
                  );
                return (
                  <article key={s.id} className="speaker-card">
                    <div className="speaker-card-top">
                      <span className="speaker-avatar large">
                        {s.name.charAt(0)}
                      </span>
                      <Pill tone={s.confirmed ? "green" : "sand"}>
                        {s.confirmed ? "Confirmed" : "Needs a name"}
                      </Pill>
                    </div>
                    <label>
                      Display name
                      <input
                        aria-label={`Name for speaker ${i + 1}`}
                        defaultValue={s.name}
                        maxLength={80}
                        disabled={locked}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (name && name !== s.name)
                            void change((x) =>
                              editMeeting(x, (d) => {
                                const sp = d.speakers.find(
                                  (p) => p.id === s.id,
                                )!;
                                sp.name = name;
                                sp.confirmed = false;
                              }),
                            );
                        }}
                      />
                    </label>
                    <p className="small muted">
                      {turns.length} passages ·{" "}
                      {timed
                        ? `${formatTime(timed)} timed speech`
                        : "Timing unavailable"}
                    </p>
                    <div className="speaker-samples">
                      {turns
                        .filter((t) => t.start !== null)
                        .slice(0, 3)
                        .map((t, n) => (
                          <button
                            key={t.id}
                            className="button secondary compact"
                            disabled={!url}
                            onClick={() => cue(t)}
                          >
                            <Play size={12} />
                            Sample {n + 1}
                          </button>
                        ))}
                    </div>
                    <div className="speaker-card-actions">
                      <button
                        className="button primary compact"
                        disabled={locked}
                        onClick={() =>
                          void change((x) =>
                            editMeeting(x, (d) => {
                              const sp = d.speakers.find((p) => p.id === s.id)!;
                              sp.confirmed = !sp.confirmed;
                            }),
                          )
                        }
                      >
                        <Check size={15} />
                        {s.confirmed ? "Leave unconfirmed" : "Confirm name"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setMerge(s.id)}
                        disabled={locked || m.speakers.length < 2}
                      >
                        Merge…
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty title="Meet the voices in your meeting">
              <p>
                Speaker-aware transcription will suggest anonymous voices. You
                can also add speakers and manually assign imported passages.
              </p>
            </Empty>
          )}
        </section>
      )}
      {tab === "memo" && (
        <section className="workspace-panel">
          <header className="panel-toolbar">
            <div>
              <h2>From discussion to direction</h2>
              <p>
                {memo
                  ? `${m.memos.length} saved version${m.memos.length === 1 ? "" : "s"} · every item starts with review`
                  : "A first draft, grounded in your transcript."}
              </p>
            </div>
            <button
              className="button primary compact"
              disabled={locked || !m.segments.length}
              onClick={() => setConfirmStage("memo")}
            >
              <Sparkles size={15} />
              {memo ? "Generate new version" : "Generate meeting notes"}
            </button>
          </header>
          {memo ? (
            <>
              <div className="memo-version">
                <History size={15} />
                <label>
                  Version
                  <select
                    aria-label="Memo version"
                    value={memo.id}
                    onChange={(e) => {
                      setViewVersion(e.target.value);
                    }}
                  >
                    {m.memos.map((v, i) => (
                      <option key={v.id} value={v.id}>
                        Version {i + 1} ·{" "}
                        {new Date(v.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <span>{memo.model}</span>
              </div>
              {memo.sourceRevision !== m.revision &&
                memo.items.some((i) => i.reviewedRevision !== m.revision) && (
                  <div className="notice sand">
                    Source details changed after these notes were generated.
                    Review every item against the current transcript; accepted
                    items from the old source remain stale.
                  </div>
                )}
              <div className="memo-list">
                {memo.items.map((item) => (
                  <article
                    className={`memo-item ${item.review === "rejected" ? "rejected" : ""}`}
                    key={item.id}
                  >
                    <div className="memo-item-heading">
                      <Pill
                        tone={
                          item.type === "action"
                            ? "green"
                            : item.type === "risk"
                              ? "sand"
                              : "neutral"
                        }
                      >
                        {item.type}
                      </Pill>
                      <span className="small muted">{item.review}</span>
                    </div>
                    <textarea
                      aria-label={`${item.type} note`}
                      defaultValue={item.text}
                      rows={Math.max(
                        2,
                        Math.min(6, Math.ceil(item.text.length / 90)),
                      )}
                      disabled={locked}
                      onBlur={(e) => {
                        if (
                          e.relatedTarget instanceof Element &&
                          e.relatedTarget.closest("[data-review-button]")
                        )
                          return;
                        if (
                          e.target.value.trim() &&
                          e.target.value !== item.text
                        )
                          void persistQuietly({
                            ...m,
                            memos: m.memos.map((v) =>
                              v.id === memo.id
                                ? {
                                    ...v,
                                    items: v.items.map((x) =>
                                      x.id === item.id
                                        ? {
                                            ...x,
                                            text: e.target.value,
                                            review: "edited",
                                          }
                                        : x,
                                    ),
                                  }
                                : v,
                            ),
                          });
                      }}
                    />
                    <OriginalNote
                      item={memo.originalItems?.find((x) => x.id === item.id)}
                      meeting={m}
                    />
                    {item.type === "action" && (
                      <div className="action-fields">
                        <label>
                          Owner
                          <select
                            aria-label="Action owner"
                            value={item.ownerId || ""}
                            disabled={locked}
                            onChange={(e) =>
                              void persistQuietly({
                                ...m,
                                memos: m.memos.map((v) =>
                                  v.id === memo.id
                                    ? {
                                        ...v,
                                        items: v.items.map((x) =>
                                          x.id === item.id
                                            ? {
                                                ...x,
                                                ownerId: e.target.value || null,
                                                review: "edited",
                                              }
                                            : x,
                                        ),
                                      }
                                    : v,
                                ),
                              })
                            }
                          >
                            <option value="">To confirm</option>
                            {m.speakers.map((s) => (
                              <option value={s.id} key={s.id}>
                                {s.name}
                                {!s.confirmed ? " (unconfirmed)" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Due date
                          <input
                            aria-label="Action due date"
                            type="date"
                            defaultValue={item.dueDate || ""}
                            disabled={locked}
                            onBlur={(e) => {
                              if (
                                e.relatedTarget instanceof Element &&
                                e.relatedTarget.closest("[data-review-button]")
                              )
                                return;
                              if (e.target.value !== (item.dueDate || ""))
                                void persistQuietly({
                                  ...m,
                                  memos: m.memos.map((v) =>
                                    v.id === memo.id
                                      ? {
                                          ...v,
                                          items: v.items.map((x) =>
                                            x.id === item.id
                                              ? {
                                                  ...x,
                                                  dueDate:
                                                    e.target.value || null,
                                                  review: "edited",
                                                }
                                              : x,
                                          ),
                                        }
                                      : v,
                                  ),
                                });
                            }}
                          />
                        </label>
                        {item.dueOriginal && (
                          <span className="small muted">
                            Said: {item.dueOriginal}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="source-links">
                      <span>Source</span>
                      {item.sources.map((source, n) => {
                        const s = resolveSource(m, source);
                        return (
                          <button
                            key={`${source.id}:${source.revision}`}
                            className="source-link"
                            onClick={() => {
                              if (s) setEvidence(s);
                            }}
                          >
                            Passage{" "}
                            {m.segments.findIndex((s) => s.id === source.id) +
                              1 || `${n + 1} (historical)`}{" "}
                            · r{source.revision}
                          </button>
                        );
                      })}
                    </div>
                    <div className="memo-actions">
                      {(["accepted", "pending", "rejected"] as const).map(
                        (state) => (
                          <button
                            key={state}
                            className={`text-button ${item.review === state ? "selected" : ""}`}
                            disabled={locked}
                            data-review-button="true"
                            onClick={(event) =>
                              reviewMemoItem(
                                memo.id,
                                item.id,
                                state,
                                event.currentTarget.closest("article"),
                              )
                            }
                          >
                            {state === "accepted"
                              ? "✓ Accept"
                              : state === "rejected"
                                ? "Reject"
                                : "Needs review"}
                          </button>
                        ),
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <Empty title="Your next steps, with context">
              <p>
                Review the transcript, then generate a draft with your selected
                key. Decisions and actions link back to what was actually said.
              </p>
              <a href="#/settings" className="text-button">
                Connect your API key
                <ArrowLeft size={15} />
              </a>
            </Empty>
          )}
        </section>
      )}
      {(m.jobs.length > 0 || m.runs.length > 0) && (
        <details className="history-panel">
          <summary>
            <History size={16} />
            Processing history <span>{m.jobs.length} requests</span>
          </summary>
          {m.jobs
            .slice()
            .reverse()
            .map((j) => (
              <div className="job-entry" key={j.id}>
                <strong>
                  {j.stage === "speech" ? "Transcription" : "Memo"} ·{" "}
                  {j.state.replaceAll("_", " ")}
                </strong>
                <span>
                  {new Date(j.createdAt).toLocaleString()} · billing:{" "}
                  {j.billing.replaceAll("_", " ")}
                </span>
                <p>{j.message}</p>
                {j.usage && (
                  <p className="small muted">
                    {j.usage.inputTokens !== null
                      ? `${j.usage.inputTokens} input tokens · ${j.usage.outputTokens ?? "unknown"} output tokens`
                      : j.usage.seconds !== null
                        ? `${j.usage.seconds.toFixed(1)} seconds reported`
                        : "Provider usage not reported"}
                    . Usage is not an invoice.
                  </p>
                )}
                <p className="small muted">
                  Estimate:{" "}
                  {j.estimateUsd != null
                    ? `US$${j.estimateUsd.toFixed(3)}`
                    : "unknown"}{" "}
                  · {j.createdAt.slice(0, 10)}
                </p>
                {j.requestId && <code>Provider request: {j.requestId}</code>}
              </div>
            ))}
          {m.runs.map((run) => (
            <div className="job-entry" key={run.id}>
              <strong>
                {run.provider} · {run.model} · saved original result
              </strong>
              <button
                className="button secondary compact"
                disabled={locked}
                onClick={() => {
                  if (
                    confirm(
                      "Apply this saved transcription? Current edits will remain in revision history; generated notes will need review.",
                    )
                  )
                    void change((x) =>
                      editMeeting(x, (d) => {
                        d.speakers = structuredClone(run.speakers);
                        d.segments = structuredClone(run.originalSegments);
                      }),
                    );
                }}
              >
                Use this transcription
              </button>
            </div>
          ))}
        </details>
      )}
      {url && (
        <div className="audio-player">
          <audio
            ref={player}
            src={url}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) {
                setDuration(d);
                if (m.audio && m.audio.duration !== d && !saving)
                  void persistQuietly({
                    ...m,
                    audio: { ...m.audio, duration: d },
                  });
              }
            }}
            onTimeUpdate={(e) => {
              setPosition(e.currentTarget.currentTime);
              if (
                playUntil.current !== null &&
                e.currentTarget.currentTime >= playUntil.current
              ) {
                e.currentTarget.pause();
                playUntil.current = null;
              }
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() =>
              setNotice(
                "This browser cannot play the recording. The provider may still support it; verify before sending.",
              )
            }
          />
          <button
            className="play-button"
            aria-label={playing ? "Pause audio" : "Play audio"}
            onClick={() => {
              if (playing) player.current?.pause();
              else {
                playUntil.current = null;
                void player.current
                  ?.play()
                  .catch(() => setNotice("Playback could not start."));
              }
            }}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <div className="player-title">
            <strong>{m.audio?.name}</strong>
            <span>Original recording</span>
          </div>
          <span className="player-time">{formatTime(position)}</span>
          <input
            aria-label="Playback position"
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(position, duration || 1)}
            onChange={(e) => {
              if (player.current) {
                playUntil.current = null;
                player.current.currentTime = Number(e.target.value);
              }
            }}
          />
          <span className="player-time">{formatTime(duration)}</span>
          <select
            aria-label="Playback speed"
            onChange={(e) => {
              if (player.current)
                player.current.playbackRate = Number(e.target.value);
            }}
            defaultValue="1"
          >
            <option value="0.75">0.75×</option>
            <option value="1">1×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </div>
      )}
      {confirmStage && (
        <Modal
          title={
            confirmStage === "speech"
              ? "Transcribe this recording?"
              : "Generate a new memo version?"
          }
          onClose={() => setConfirmStage(undefined)}
        >
          <div className="modal-body">
            <div className="notice">
              <ShieldCheck size={18} />
              <span>
                You choose what leaves this device. Nothing is sent until you
                confirm.
              </span>
            </div>
            <dl className="confirmation-list">
              <dt>Destination</dt>
              <dd>
                {getSelection(confirmStage).provider === "openai"
                  ? "OpenAI · api.openai.com"
                  : "OpenRouter · openrouter.ai (routes to a model provider)"}
              </dd>
              <dt>Data sent</dt>
              <dd>
                {confirmStage === "speech"
                  ? `Your complete recording (${((m.audio?.size || 0) / 1024 / 1024).toFixed(1)} MB)`
                  : "Transcript, speaker names and meeting context (title, date, timezone, languages, type and glossary)"}
              </dd>
              <dt>Model</dt>
              <dd>{getSelection(confirmStage).model}</dd>
              <dt>Estimated charge</dt>
              <dd>
                {confirmStage === "speech" &&
                getSpeechRate() !== null &&
                duration
                  ? `About US$${((getSpeechRate()! * duration) / 60).toFixed(3)} using your entered rate`
                  : "Unknown · provider charges apply"}
              </dd>
            </dl>
            <p className="muted">
              Keep this page open. Cancellation does not guarantee remote
              processing or billing stops. The app does not automatically retry.
              Review the provider's retention policy for your account.
            </p>
            {confirmStage === "memo" && (unknown || pending) > 0 && (
              <div className="notice sand">
                {unknown} speakers are unconfirmed and {pending} passages are
                unreviewed. Unknown fields remain subject to review.
              </div>
            )}
            {confirmStage === "speech" && (
              <p className="small muted">
                Audio uploads are limited to 25 MB. Speaker labels and
                timestamps depend on the chosen model and returned result;
                missing evidence stays unknown.
              </p>
            )}
            {confirmStage === "speech" && m.segments.length > 0 && (
              <div className="notice sand">
                A new transcription replaces the current view only if its source
                has not changed. Previous text and edits remain in revision
                history.
              </div>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setConfirmStage(undefined)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!getKey(getSelection(confirmStage).provider)}
                onClick={() => void process()}
              >
                Confirm and send
              </button>
            </div>
            {!getKey(getSelection(confirmStage).provider) && (
              <a
                href="#/settings"
                className="text-button"
                onClick={() => setConfirmStage(undefined)}
              >
                Add your key in Settings first
              </a>
            )}
          </div>
        </Modal>
      )}
      {evidence && (
        <Modal
          title={`Source passage · r${evidence.revision}`}
          onClose={() => setEvidence(undefined)}
        >
          <div className="modal-body">
            <Pill>Saved evidence revision</Pill>
            <p className="evidence-text">{evidence.text}</p>
            <p className="muted small">
              {evidence.start === null
                ? "Audio time unknown"
                : `${formatTime(evidence.start)} – ${formatTime(evidence.end!)}`}{" "}
              · {speakerName(m, evidence.speakerIds)}
            </p>
            <div className="toolbar-actions">
              <button
                className="button secondary"
                disabled={!url || evidence.start === null}
                onClick={() => cue(evidence)}
              >
                <Play size={15} />
                Play source audio
              </button>
              {m.segments.some((s) => s.id === evidence.id) && (
                <button
                  className="button primary"
                  onClick={() => {
                    const key = evidence.id;
                    setEvidence(undefined);
                    setTab("transcript");
                    setHighlight(key);
                    setTimeout(
                      () =>
                        document
                          .getElementById(`segment-${key}`)
                          ?.scrollIntoView({ block: "center" }),
                      50,
                    );
                  }}
                >
                  View current passage
                </button>
              )}
            </div>
            <p className="small muted">
              This is the exact revision cited by the note. Current transcript
              wording may differ.
            </p>
          </div>
        </Modal>
      )}
      {metadata && (
        <Modal title="Meeting details" onClose={() => setMetadata(false)}>
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await persist(
                  editMeeting(m, (d) => {
                    d.title = String(f.get("title")).trim();
                    d.date = String(f.get("date"));
                    d.timezone = String(f.get("timezone"));
                    d.languages = String(f.get("languages"));
                    d.glossary = String(f.get("glossary"));
                  }),
                );
                setMetadata(false);
              } catch {
                /* preserve draft */
              }
            }}
          >
            <label>
              Title
              <input
                name="title"
                required
                maxLength={160}
                defaultValue={m.title}
              />
            </label>
            <div className="form-row">
              <label>
                Date
                <input type="date" name="date" required defaultValue={m.date} />
              </label>
              <label>
                Timezone
                <input name="timezone" required defaultValue={m.timezone} />
              </label>
            </div>
            <label>
              Languages
              <input
                name="languages"
                maxLength={100}
                defaultValue={m.languages}
              />
            </label>
            <label>
              Terms & context
              <textarea
                name="glossary"
                maxLength={2000}
                defaultValue={m.glossary}
              />
            </label>
            <p className="small muted">
              Changes mark generated notes for re-review.
            </p>
            <button type="submit" className="button primary" disabled={locked}>
              Save details
            </button>
          </form>
        </Modal>
      )}
      {addText && (
        <Modal title="Add a transcript" onClose={() => setAddText(false)}>
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const imported = importTranscript(newText);
                if (
                  m.segments.length &&
                  !confirm(
                    "Replace the transcript view? Original and revised text stay in history.",
                  )
                )
                  return;
                await persist(
                  replaceTranscript(
                    m,
                    imported.speakers,
                    imported.segments,
                    "Text import",
                    "manual / no timing",
                  ),
                );
                setAddText(false);
                setNewText("");
              } catch (e) {
                onError(
                  e instanceof Error ? e.message : "Could not import text.",
                );
              }
            }}
          >
            <p className="muted">
              Paste plain text, optionally one speaker per line as “Name:
              words”. Names are unconfirmed and times remain unknown.
            </p>
            <label>
              Transcript
              <textarea
                rows={9}
                required
                maxLength={2_000_000}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
            </label>
            <button type="submit" className="button primary" disabled={locked}>
              Save transcript locally
            </button>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title="Edit this passage" onClose={() => setEditing(undefined)}>
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await persist(
                  editSegment(m, editing.id, {
                    text: String(f.get("text")),
                    speakerIds: f.getAll("speaker").map(String),
                    reviewed: f.has("reviewed"),
                  }),
                );
                setEditing(undefined);
              } catch {
                /* keep form */
              }
            }}
          >
            <label>
              Transcript text
              <textarea
                name="text"
                rows={6}
                defaultValue={editing.text}
                required
                maxLength={20000}
              />
            </label>
            <fieldset>
              <legend>
                Speakers · leave empty for unknown; select multiple for overlap
              </legend>
              {m.speakers.map((s) => (
                <label className="checkbox-label" key={s.id}>
                  <input
                    type="checkbox"
                    name="speaker"
                    value={s.id}
                    defaultChecked={editing.speakerIds.includes(s.id)}
                  />
                  {s.name}
                </label>
              ))}
            </fieldset>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="reviewed"
                defaultChecked={editing.reviewed}
              />
              I reviewed this passage
            </label>
            <details>
              <summary>Original text</summary>
              <p>{editing.originalText}</p>
            </details>
            <button className="button primary" disabled={locked}>
              Save correction
            </button>
          </form>
        </Modal>
      )}
      {splitting && (
        <Modal
          title="Split this passage"
          onClose={() => setSplitting(undefined)}
        >
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                boundary = String(f.get("time") ?? "");
              try {
                await persist(
                  splitSegment(
                    m,
                    splitting.id,
                    Number(f.get("at")),
                    boundary ? Number(boundary) : null,
                  ),
                );
                setSplitting(undefined);
              } catch (e) {
                onError(
                  e instanceof Error ? e.message : "Could not split passage.",
                );
              }
            }}
          >
            <p>{splitting.text}</p>
            <label>
              Split after character
              <input
                name="at"
                type="number"
                min={1}
                max={splitting.text.length - 1}
                required
                defaultValue={Math.floor(splitting.text.length / 2)}
              />
            </label>
            {splitting.start !== null && (
              <label>
                Exact audio boundary in seconds · optional
                <input
                  name="time"
                  type="number"
                  step="0.01"
                  min={splitting.start + 0.01}
                  max={splitting.end! - 0.01}
                />
              </label>
            )}
            <p className="small muted">
              Without a verified boundary, both new passages have unknown
              timing. The original timed source remains in history.
            </p>
            <button className="button primary" disabled={locked}>
              Split passage
            </button>
          </form>
        </Modal>
      )}
      {merge && (
        <Modal
          title="Merge this voice into another"
          onClose={() => setMerge(undefined)}
        >
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const target = String(
                new FormData(e.currentTarget).get("target"),
              );
              try {
                await persist(mergeSpeakers(m, merge, target));
                setMerge(undefined);
              } catch {
                /* feedback */
              }
            }}
          >
            <p>
              All passages assigned to {speakerName(m, [merge])} will be
              reassigned. The combined identity needs confirmation again. You
              can undo this change.
            </p>
            <label>
              Merge into
              <select name="target">
                {m.speakers
                  .filter((s) => s.id !== merge)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className="button primary" disabled={locked}>
              Confirm merge
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function OriginalNote({
  item,
  meeting,
}: {
  item?: MemoItem;
  meeting: Meeting;
}) {
  return (
    <details className="original-text">
      <summary>Original generated item</summary>
      {item ? (
        <>
          <p>{item.text}</p>
          <p className="small muted">
            Owner:{" "}
            {item.ownerId ? speakerName(meeting, [item.ownerId]) : "To confirm"}
            {" · "}Due: {item.dueDate || "To confirm"}
            {item.dueOriginal ? ` · Said: ${item.dueOriginal}` : ""}
          </p>
        </>
      ) : (
        <p>
          This older memo version did not save a separate original. Its original
          cannot be reconstructed from human edits.
        </p>
      )}
    </details>
  );
}
