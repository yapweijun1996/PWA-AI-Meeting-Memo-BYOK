import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  Download,
  FileText,
  History,
  LoaderCircle,
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
import type { ReferenceVideo as ReferenceVideoValue } from "../domain/reference-video";
import { summarizeMeetingAccounting } from "../domain/accounting";
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
import { getKey, getSelection, getSpeechEstimate, getUiLanguage } from "../providers/credentials";
import { cancelProcessing, runJob, isProcessingMeeting } from "../jobs/runner";
import { Empty, Modal, Pill } from "../components/ui";
import { CitedEvidence } from "./CitedEvidence";
import { SpeakerReview } from "./SpeakerReview";
import { ReferenceVideo } from "./ReferenceVideo";
import { usePlaybackClock } from "./usePlaybackClock";
import { useUiLanguage } from "../ui-language";
import { translateMessage } from "../ui-messages";
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
    [audioMissing, setAudioMissing] = useState(false),
    [sampleRange, setSampleRange] = useState<{ start: number; end: number } | null>(null),
    [audioStopToken, setAudioStopToken] = useState(0);
  const player = useRef<HTMLAudioElement>(null),
    playUntil = useRef<number | null>(null);
  const playback = usePlaybackClock(player, Boolean(url), m.audio?.duration || 0),
    { playing, position, duration } = playback;
  // A save can disable the focused editor; guard only that item's blur until review commits.
  const reviewInteraction = useRef<
    { key: string; phase: "pending" | "committing" } | undefined
  >(undefined);
  const [evidence, setEvidence] = useState<Segment>();
  const [uiLanguage, setUiLanguage] = useState(getUiLanguage());
  const t = (en: string, zh: string) => uiLanguage === "zh-CN" ? zh : en;
  const updatePlaybackRange = useCallback(
    (range: { start: number; end: number } | null) => {
      setSampleRange((current) =>
        current?.start === range?.start && current?.end === range?.end
          ? current
          : range,
      );
    },
    [],
  );
  useEffect(() => {
    const changed = () => setUiLanguage(getUiLanguage());
    window.addEventListener("memo-keys-changed", changed);
    return () => window.removeEventListener("memo-keys-changed", changed);
  }, []);
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
  function memoInteractionActive(versionId: string, itemId: string) {
    const key = reviewInteraction.current?.key;
    return !!key && (key === `${versionId}:${itemId}` || key.startsWith(`${versionId}:${itemId}:`));
  }
  function persistMemoDraft(interactionKey: string, next: Meeting) {
    // Disabling a focused editor during its first save can emit a second blur.
    // Mark the field before starting the async CAS write so that re-entrant
    // blur handlers do not submit the same stale revision a second time.
    if (reviewInteraction.current?.key === interactionKey) return;
    reviewInteraction.current = { key: interactionKey, phase: "committing" };
    void persistQuietly(next).finally(() => {
      if (
        reviewInteraction.current?.key === interactionKey &&
        reviewInteraction.current.phase === "committing"
      )
        reviewInteraction.current = undefined;
    });
  }
  function reviewMemoItem(
    versionId: string,
    itemId: string,
    state: "accepted" | "pending" | "rejected",
    article: Element | null,
  ) {
    const interactionKey = `${versionId}:${itemId}`;
    const text = article?.querySelector("textarea")?.value;
    const owner = (
      article?.querySelector(
        'select[data-action-owner]',
      ) as HTMLSelectElement | null
    )?.value;
    const due = (
      article?.querySelector(
        'input[data-action-due]',
      ) as HTMLInputElement | null
    )?.value;
    if (state !== "rejected" && !text?.trim()) {
      if (reviewInteraction.current?.key === interactionKey)
        reviewInteraction.current = undefined;
      onError("Add note text before accepting or reviewing it.");
      return;
    }
    reviewInteraction.current = { key: interactionKey, phase: "committing" };
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
    }).finally(() => {
      if (
        reviewInteraction.current?.key === interactionKey &&
        reviewInteraction.current.phase === "committing"
      )
        reviewInteraction.current = undefined;
    });
  }
  async function change(fn: (m: Meeting) => Meeting) {
    try {
      await persist(fn(m));
    } catch {
      /* feedback is displayed without clearing the editor */
    }
  }
  function cueRange(start: number, end: number | null) {
    if (!player.current) {
      setNotice("This source has no playable local audio range.");
      return;
    }
    setSampleRange({ start, end: end ?? Math.min(duration || start + 20, start + 20) });
    setAudioStopToken((value) => value + 1);
    playUntil.current = end;
    player.current.currentTime = start;
    playback.refresh();
    void player.current
      .play()
      .catch(() =>
        setNotice(
          "Playback could not start. Check this browser supports the recording format.",
        ),
      );
  }
  function cue(s: Segment) {
    if (s.start === null) {
      setNotice("This source has no playable local audio range.");
      return;
    }
    cueRange(s.start, s.end);
  }
  async function process() {
    if (!confirmStage) return;
    const stage = confirmStage;
    setConfirmStage(undefined);
    setProcessing(true);
    setNotice("");
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
            t("Confirm this is the original recording for the imported timestamps. Verify playback before relying on the evidence.", "请确认这是导入时间戳对应的原始录音。依赖此证据前请验证播放。"),
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
          t("Mark the unfinished request as outcome unknown? This does not cancel remote processing or make a retry free. Check your provider account before submitting again.", "将未完成的请求标记为结果未知吗？这不会取消远端处理，也不保证重试免费。再次提交前请检查服务商账户。"),
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
    pending = m.segments.filter((s) => !s.reviewed).length,
    accounting = summarizeMeetingAccounting(m.jobs);
  const segments = pendingOnly
    ? m.segments.filter((s) => !s.reviewed)
    : m.segments;
  return (
    <div className={url ? "workspace has-player" : "workspace"}>
      <a href="#/" className="back-link">
        <ArrowLeft size={15} />
        {t("All meetings", "所有会议")}
      </a>
      <section className="page-heading meeting-heading">
        <div>
          <div className="eyebrow">
            {m.kind === "erp" ? t("ERP DISCOVERY", "ERP 需求讨论") : t("MEETING WORKSPACE", "会议工作空间")}{" "}
            {m.synthetic && <Pill tone="sand">{t("Synthetic example", "模拟示例")}</Pill>}
          </div>
          <h1>{m.title}</h1>
          <p>
            {m.date} <span>·</span> {m.timezone} <span>·</span>{" "}
            {m.languages || t("Languages not specified", "未指定会议语言")}
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            aria-label={t("Edit meeting details", "编辑会议资料")}
            title={t("Edit meeting details", "编辑会议资料")}
            onClick={() => setMetadata(true)}
            disabled={locked}
          >
            <Settings size={19} />
          </button>
          <details className="export-menu">
            <summary className="button secondary">
              <Download size={16} />
              {t("Export", "导出")}
              <ChevronDown size={14} />
            </summary>
            <div>
              {(["md", "txt", "json", "zip"] as const).map((f) => (
                <button key={f} onClick={() => void exportFile(f)}>
                  {f === "zip"
                    ? t("Full backup with audio", "完整备份（含录音）")
                    : f === "json"
                      ? t("Meeting JSON (no audio)", "会议 JSON（不含录音）")
                      : `${f.toUpperCase()} ${t("notes", "笔记")}`}
                </button>
              ))}
            </div>
          </details>
          <button
            className="icon-button danger-text"
            aria-label={t("Delete meeting", "删除会议")}
            title={t("Delete meeting and local recording", "删除会议及本地录音")}
            disabled={locked}
            onClick={async () => {
              if (
                confirm(
                  t(`Delete “${m.title}” and its local recording? Export a backup first if needed.`, `删除“${m.title}”及其本地录音吗？如有需要，请先导出备份。`),
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
        <div
          className="recording-info"
          role="group"
          aria-label={t("Recording details", "录音详情")}
        >
          <span className="round-icon">
            <AudioLines size={21} />
          </span>
          <div>
            <strong>{m.audio?.name || t("No recording attached", "尚未附加录音")}</strong>
            <small>
              {m.audio
                ? `${(m.audio.size / 1024 / 1024).toFixed(1)} MB${duration ? ` · ${formatTime(duration)}` : ""}${audioMissing ? ` · ${t("audio missing on this device", "此设备缺少录音")}` : ""}`
                : t("Import audio to transcribe, or work from a transcript.", "导入录音进行转录，或使用已有转录。")}
            </small>
          </div>
        </div>
        <div className="toolbar-actions">
          <label className="button secondary compact">
            <Upload size={15} />
            {m.audio ? t("Reattach source", "重新附加原录音") : t("Attach audio", "附加录音")}
            <input
              aria-label={t("Attach audio", "附加录音")}
              type="file"
              accept="audio/*,.m4a,.mp4,.webm,.flac"
              disabled={locked}
              onChange={(e) => void attach(e.target.files?.[0])}
            />
          </label>
          <button
            className="button primary compact"
            title={
              m.segments.length > 0
                ? t(
                    "Re-transcription keeps previous text, corrections and evidence in history.",
                    "重新转录会将之前的文字、修正和证据保留在历史记录中。",
                  )
                : undefined
            }
            onClick={() => setConfirmStage("speech")}
            disabled={locked || !url}
          >
            <AudioLines size={15} />
            {t("Transcribe", "转录")}
          </button>
        </div>
      </div>
      {notice && !processing && (
        <div className="notice" role="status">
          {translateMessage(notice, uiLanguage)}
        </div>
      )}
      {m.jobs.some((j) => j.state === "in_flight") && !processing && (
        <div className="notice sand">
          <span>
            {t("An unfinished request is recorded. It may be active in another tab or already billable.", "存在未完成的请求。请求可能仍在其他标签页运行或已经产生费用。")}
          </span>
          <button
            className="button secondary compact"
            onClick={() => void markInterrupted()}
          >
            {t("Review interruption", "检查中断")}
          </button>
          <button
            className="text-button"
            onClick={async () => {
              const latest = await getMeeting(m.id);
              if (latest) onUpdate(latest);
            }}
          >
            {t("Reload state", "重新加载状态")}
          </button>
        </div>
      )}
      {processing && (
        <section className="processing-card" aria-label={t("Processing request", "正在处理请求")}>
          <span className="processing-indicator" aria-hidden="true">
            <LoaderCircle size={22} strokeWidth={2} />
          </span>
          <div className="processing-copy" role="status" aria-live="polite">
            <strong>{t("Processing your request", "正在处理请求")}</strong>
            <span>
              {t("Keep this page open. Completed results are saved to this device.", "请保持此页面打开。完成的结果会保存在此设备。")}
            </span>
            <span className="processing-detail">
              {t("Sending or waiting for your provider · Time depends on the request", "正在发送或等待服务商 · 所需时间取决于请求")}
            </span>
          </div>
          <button
            className="button secondary compact"
            onClick={cancelProcessing}
          >
            {t("Stop waiting", "停止等待")}
          </button>
        </section>
      )}
      <div className="workspace-tabs" role="tablist" aria-label={t("Meeting views", "会议视图")}>
        {[
          ["transcript", t("Transcript", "转录"), FileText, m.segments.length],
          ["speakers", t("Speakers", "说话人"), Users, m.speakers.length],
          ["memo", t("Meeting notes", "会议笔记"), Sparkles, memo?.items.length || 0],
        ].map(([value, label, Icon, count]) => {
          const Glyph = Icon as typeof FileText;
          const unit =
            value === "transcript"
              ? t("passages", "段落")
              : value === "speakers"
                ? t("speakers", "位说话人")
                : t("items", "项");
          const accessibleLabel = `${String(label)}, ${String(count)} ${unit}`;
          return (
            <button
              key={String(value)}
              role="tab"
              aria-selected={tab === value}
              aria-label={accessibleLabel}
              title={accessibleLabel}
              onClick={() => setTab(String(value))}
            >
              <Glyph size={17} />
              {String(label)}
              <span aria-hidden="true">{String(count)}</span>
            </button>
          );
        })}
        <span className="save-state">
          <span className="status-dot" />
          {saving ? t("Saving…", "正在保存…") : t("Saved locally", "已保存在本地")}
        </span>
      </div>
      {tab === "transcript" && (
        <section className="workspace-panel">
          <header className="panel-toolbar">
            <div>
              <h2>{t("The conversation", "会议对话")}</h2>
              <p>
                {pending} {t("passages to review", "段待审阅")} · {unknown} {t("unconfirmed speakers", "位说话人未确认")}
              </p>
            </div>
            <div className="toolbar-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={pendingOnly}
                  onChange={(e) => setPendingOnly(e.target.checked)}
                />
                {t("Needs review", "需要审阅")}
              </label>
              <button
                className="button secondary compact"
                disabled={locked || !m.undo.length}
                onClick={() => void change(undoEdit)}
              >
                <Undo2 size={15} />
                {t("Undo", "撤销")}
              </button>
              <button
                className="button secondary compact"
                onClick={() => setAddText(true)}
                disabled={locked}
              >
                <Plus size={15} />
                {t("Add transcript", "添加转录")}
              </button>
            </div>
          </header>
          {selected.length > 0 && (
            <div className="bulk-bar">
              <span>{selected.length} {t("passages selected", "段已选择")}</span>
              <select
                aria-label={t("Assign selected passages", "分配所选段落")}
                value={assignment}
                onChange={(e) => setAssignment(e.target.value)}
              >
                <option value="">{t("Choose speaker…", "选择说话人…")}</option>
                <option value="unknown">{t("Unknown speaker", "未知说话人")}</option>
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
                      t(`Reassign ${selected.length} selected passages to ${assignment === "unknown" ? "Unknown" : speakerName(m, [assignment])}? This invalidates associated notes and can be undone.`, `将选中的 ${selected.length} 个段落重新分配给${assignment === "unknown" ? "未知说话人" : speakerName(m, [assignment])}吗？相关笔记将需要重新审阅，此操作可以撤销。`),
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
                {t("Preview & assign", "预览并分配")}
              </button>
              <button className="text-button" onClick={() => setSelected([])}>
                {t("Clear", "清除")}
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
                      aria-label={t(`Select passage ${m.segments.indexOf(s) + 1}`, `选择第 ${m.segments.indexOf(s) + 1} 段`)}
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
                    {(s.speakerIds.length ? speakerName(m, s.speakerIds) : t("Unknown speaker", "未知说话人")).slice(0, 1)}
                  </div>
                  <div className="passage-content">
                    <div className="passage-meta">
                      <strong>{s.speakerIds.length ? speakerName(m, s.speakerIds) : t("Unknown speaker", "未知说话人")}</strong>
                      {s.speakerIds.length > 1 && (
                        <Pill>{t("Overlap / multiple", "重叠／多人")}</Pill>
                      )}
                      {s.speakerIds.some(
                        (id) =>
                          !m.speakers.find((sp) => sp.id === id)?.confirmed,
                      ) && <span className="small muted">{t("Unconfirmed", "未确认")}</span>}
                      <button
                        className="time-link"
                        disabled={s.start === null || !url}
                        onClick={() => cue(s)}
                      >
                        {s.start === null
                          ? t("Time unknown", "时间未知")
                          : `${formatTime(s.start)} – ${formatTime(s.end!)}`}
                      </button>
                      {s.reviewed && <Check size={14} className="green-text" />}
                    </div>
                    <p>{s.text}</p>
                    {s.text !== s.originalText && (
                      <details className="original-text">
                        <summary>{t("Original text", "原始文字")}</summary>
                        <p>{s.originalText}</p>
                      </details>
                    )}
                    <div className="passage-actions">
                      <button
                        className="text-button"
                        onClick={() => setEditing(s)}
                        disabled={locked}
                      >
                        {t("Edit passage", "编辑段落")}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setSplitting(s)}
                        disabled={locked}
                      >
                        {t("Split", "拆分")}
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
                        {s.reviewed ? t("Mark unreviewed", "标记为未审阅") : t("Mark reviewed", "标记为已审阅")}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title={t("The conversation belongs here", "会议对话将显示在这里")}>
              <p>
                {t("Transcribe a recording with your own key, or add an existing transcript. Original results and your edits are kept separately.", "使用自己的密钥转录录音，或添加已有转录。原始结果和您的修改会分别保存。")}
              </p>
              <button
                className="button secondary"
                onClick={() => setAddText(true)}
              >
                <Plus size={16} />
                {t("Add transcript", "添加转录")}
              </button>
            </Empty>
          )}
        </section>
      )}
      {tab === "speakers" && (
        <section className="workspace-panel speaker-review-panel">
          <header className="panel-toolbar">
            <div>
              <h2>{t("Put a name to the voice", "为声音确认姓名")}</h2>
              <p>
                {t("Listen to longer samples and watch the reference video before confirming a name.", "先试听较长样本并查看参考视频，再确认姓名。")}
              </p>
            </div>
          </header>
          <SpeakerReview
            meeting={m}
            audioAvailable={!!url}
            duration={duration}
            position={position}
            playing={playing}
            playbackStatus={playback.status}
            locked={locked}
            onCue={cueRange}
            onPause={() => player.current?.pause()}
            onChange={async (fn) => {
              // Speaker edits must propagate CAS/storage failures so the
              // editor can keep its draft and expose a retryable error.
              await persist(fn(m));
            }}
            onMerge={setMerge}
            onAdd={() => {
              const name = prompt(
                t(
                  "Name for the new speaker (unconfirmed):",
                  "新说话人的姓名（未确认）：",
                ),
              );
              if (name?.trim())
                void change((x) =>
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
            t={t}
            onPlaybackRangeChange={updatePlaybackRange}
            referenceVideo={
              <ReferenceVideo
                value={m.referenceVideo}
                audioName={m.audio?.name}
                range={sampleRange}
                disabled={locked}
                stopToken={audioStopToken}
                onSave={async (value: ReferenceVideoValue | null) => {
                  await persist({ ...m, referenceVideo: value });
                }}
                onBeforeWatch={() => player.current?.pause()}
              />
            }
          />
        </section>
      )}
      {tab === "memo" && (
        <section className="workspace-panel">
          <header className="panel-toolbar">
            <div>
              <h2>{t("Meeting notes", "会议笔记")}</h2>
              <p>
                {memo
                  ? t(`${m.memos.length} saved version${m.memos.length === 1 ? "" : "s"} · every item starts with review`, `已保存 ${m.memos.length} 个版本 · 每一项都需要审阅`)
                  : t("A first draft, grounded in your transcript.", "根据转录生成的初稿。")}
              </p>
            </div>
            <button
              className="button primary compact"
              title={t(
                "Creates a separate version; provider charges may apply.",
                "创建独立版本；服务商可能收取费用。",
              )}
              disabled={locked || !m.segments.length}
              onClick={() => setConfirmStage("memo")}
            >
              <Sparkles size={15} />
              {memo ? t("Generate new version", "生成新版本") : t("Generate meeting notes", "生成会议笔记")}
            </button>
          </header>
          {memo ? (
            <>
              <div className="memo-version">
                <History size={15} />
                <label>
                  {t("Version", "版本")}
                  <select
                    aria-label={t("Memo version", "笔记版本")}
                    value={memo.id}
                    onChange={(e) => {
                      setViewVersion(e.target.value);
                    }}
                  >
                    {m.memos.map((v, i) => (
                      <option key={v.id} value={v.id}>
                        {t("Version", "版本")} {i + 1} ·{" "}
                        {new Date(v.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <span>{memo.model}</span>
              </div>
              {memo.sourceRevision !== m.revision &&
                memo.items.some((i) => i.reviewedRevision !== m.revision) && (
                  <div className="notice sand stale-notes-warning" role="alert">
                    <span>
                      {t("Source details changed after these notes were generated. Review every item against the current transcript; accepted items from the old source remain stale.", "生成笔记后来源资料已改变。请对照当前转录重新审阅每一项；旧来源中已接受的项目仍标记为过期。")}
                    </span>
                    <div className="notice-actions">
                      <button
                        className="text-button"
                        onClick={() => setTab("transcript")}
                      >
                        {t("View current transcript", "查看当前转录")}
                      </button>
                      <button
                        className="button secondary compact"
                        disabled={locked || !m.segments.length}
                        onClick={() => setConfirmStage("memo")}
                      >
                        {t("Generate another version", "生成另一个版本")}
                      </button>
                    </div>
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
                        {uiLanguage === "zh-CN" ? ({ summary: "摘要", discussion: "讨论", decision: "决定", action: "行动", question: "问题", risk: "风险" } as const)[item.type] : item.type}
                      </Pill>
                      <span className="small muted">{uiLanguage === "zh-CN" ? ({ pending: "待审阅", accepted: "已接受", rejected: "已拒绝", edited: "已编辑" } as const)[item.review] : item.review}</span>
                    </div>
                    <textarea
                      aria-label={uiLanguage === "zh-CN" ? `${({ summary: "摘要", discussion: "讨论", decision: "决定", action: "行动", question: "问题", risk: "风险" } as const)[item.type]}笔记` : `${item.type} note`}
                      defaultValue={item.text}
                      rows={Math.max(
                        2,
                        Math.min(6, Math.ceil(item.text.length / 90)),
                      )}
                      disabled={locked}
                      onBlur={(e) => {
                        if (memoInteractionActive(memo.id, item.id))
                          return;
                        if (
                          e.relatedTarget instanceof Element &&
                          e.relatedTarget.closest("[data-review-button]")
                        )
                          return;
                        if (
                          e.target.value.trim() &&
                          e.target.value !== item.text
                        )
                          persistMemoDraft(`${memo.id}:${item.id}:text`, {
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
                          {t("Owner", "负责人")}
                          <select
                            aria-label={t("Action owner", "行动负责人")}
                            data-action-owner="true"
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
                            <option value="">{t("To confirm", "待确认")}</option>
                            {m.speakers.map((s) => (
                              <option value={s.id} key={s.id}>
                                {s.name}
                                {!s.confirmed ? t(" (unconfirmed)", "（未确认）") : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t("Due date", "截止日期")}
                          <input
                            aria-label={t("Action due date", "行动截止日期")}
                            data-action-due="true"
                            type="date"
                            defaultValue={item.dueDate || ""}
                            disabled={locked}
                            onBlur={(e) => {
                              if (memoInteractionActive(memo.id, item.id))
                                return;
                              if (
                                e.relatedTarget instanceof Element &&
                                e.relatedTarget.closest("[data-review-button]")
                              )
                                return;
                              if (e.target.value !== (item.dueDate || ""))
                                persistMemoDraft(`${memo.id}:${item.id}:due`, {
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
                            {t("Said", "原文")}: {item.dueOriginal}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="source-links">
                      <span>{t("Source", "来源")}</span>
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
                            {t("Passage", "段落")}{" "}
                            {m.segments.findIndex((s) => s.id === source.id) +
                              1 || `${n + 1} ${t("(historical)", "（历史）")}`}{" "}
                            · r{source.revision}
                          </button>
                        );
                      })}
                    </div>
                    <CitedEvidence meeting={m} item={item} onSelect={setEvidence} />
                    <div className="memo-actions">
                      {(["accepted", "pending", "rejected"] as const).map(
                        (state) => (
                          <button
                            key={state}
                            className={`text-button ${item.review === state ? "selected" : ""}`}
                            disabled={locked}
                            data-review-button="true"
                            onPointerDown={(event) => {
                              const interactionKey = `${memo.id}:${item.id}`;
                              // Mouse needs focus preserved; WebKit touch needs its default click.
                              if (event.pointerType === "mouse")
                                event.preventDefault();
                              else
                                reviewInteraction.current = {
                                  key: interactionKey,
                                  phase: "pending",
                                };
                            }}
                            onPointerLeave={(event) => {
                              const interactionKey = `${memo.id}:${item.id}`;
                              // WebKit emits a null-target leave at touch release before compatibility click.
                              if (!event.relatedTarget || event.relatedTarget === window)
                                return;
                              if (
                                reviewInteraction.current?.key ===
                                  interactionKey &&
                                reviewInteraction.current.phase === "pending"
                              )
                                reviewInteraction.current = undefined;
                            }}
                            onPointerCancel={() => {
                              const interactionKey = `${memo.id}:${item.id}`;
                              if (
                                reviewInteraction.current?.key ===
                                  interactionKey &&
                                reviewInteraction.current.phase === "pending"
                              )
                                reviewInteraction.current = undefined;
                            }}
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
                              ? t("✓ Accept", "✓ 接受")
                              : state === "rejected"
                                ? t("Reject", "拒绝")
                                : t("Needs review", "需要审阅")}
                          </button>
                        ),
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <Empty title={t("Your next steps, with context", "有据可查的下一步")}>
              <p>
                {t("Review the transcript, then generate a draft with your selected key. Decisions and actions link back to what was actually said.", "审阅转录后，使用所选密钥生成草稿。决定和行动会链接到实际发言。")}
              </p>
              <a href="#/settings" className="text-button">
                {t("Connect your API key", "连接 API 密钥")}
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
            {t("Processing history", "处理记录")} <span>{m.jobs.length} {t("requests", "次请求")}</span>
          </summary>
          <p className="small muted">
            {t("Provider-reported total", "服务商报告费用合计")} ({accounting.reportedAttempts} {t("reported attempts", "次已报告请求")}): {accounting.reportedUsd == null ? t("unknown", "未知") : `US$${accounting.reportedUsd.toFixed(6)}`}.
            {accounting.incomplete ? t(" Incomplete: some request costs are unknown, conflicting, or may still be charged.", " 合计不完整：部分请求费用未知、记录冲突或仍可能收费。") : ""} {t("This is not an invoice; restored copies are separate meetings.", "这不是账单；恢复的副本视为独立会议。")}
          </p>
          <p className="small muted">{t("Pre-request estimates, separately (not added to reported charges)", "发送前估算合计（与报告费用分开，不相加）")} ({accounting.estimatedAttempts} {t("estimated attempts", "次已估算请求")}): {accounting.estimateUsd == null ? t("unknown", "未知") : `US$${accounting.estimateUsd.toFixed(6)}`}. {t("Incomplete when estimates are missing; each submitted attempt is counted separately.", "缺少估算时合计不完整；每次提交分别计算。")}</p>
          {m.jobs
            .slice()
            .reverse()
            .map((j) => (
              <div className="job-entry" key={j.id}>
                <strong>
                  {j.stage === "speech" ? t("Transcription", "转录") : t("Memo", "笔记")} ·{" "}
                  {uiLanguage === "zh-CN" ? ({ in_flight: "进行中", completed: "已完成", outcome_unknown: "结果未知", failed_before_send: "发送前失败", failed: "失败" } as const)[j.state] : j.state.replaceAll("_", " ")}
                </strong>
                <span>
                  {new Date(j.createdAt).toLocaleString()} · {t("billing", "计费状态")}: {" "}
                  {uiLanguage === "zh-CN" ? ({ not_submitted: "未提交", possibly_charged: "可能已收费", provider_reported: "服务商已报告", unknown: "未知" } as const)[j.billing] : j.billing.replaceAll("_", " ")}
                </span>
                <p>{translateMessage(j.message, uiLanguage)}</p>
                <p className="small muted">{j.provider && j.model ? `${j.provider} · ${j.model}` : t("Provider and model not recorded", "未记录服务商和模型")} · {t("Provider-reported charge", "服务商报告费用")}: {j.reportedCostUsd == null ? t("unknown", "未知") : `US$${j.reportedCostUsd.toFixed(6)}`}</p>
                {j.usage && (
                  <p className="small muted">
                    {j.usage.inputTokens !== null
                      ? `${j.usage.inputTokens} ${t("input tokens", "输入词元")} · ${j.usage.outputTokens ?? t("unknown", "未知")} ${t("output tokens", "输出词元")}`
                      : j.usage.seconds !== null
                        ? `${j.usage.seconds.toFixed(1)} ${t("seconds reported", "秒（服务商报告）")}`
                        : t("Provider usage not reported", "服务商未报告用量")}
                    . {t("Usage is not an invoice.", "用量记录不是账单。")}
                    {j.usage.cachedInputTokens != null ? ` ${t("Cached input tokens (included in input)", "缓存输入词元（已计入输入）")}: ${j.usage.cachedInputTokens}.` : ""}
                    {j.usage.cacheWriteTokens != null ? ` ${t("Cache-write tokens", "缓存写入词元")}: ${j.usage.cacheWriteTokens}.` : ""}
                    {j.usage.totalTokens != null ? ` ${t("Total tokens reported", "报告的总词元")}: ${j.usage.totalTokens}.` : ""}
                  </p>
                )}
                <p className="small muted">
                  {t("Estimate", "估算")}: {" "}
                  {j.estimateUsd != null
                    ? `US$${j.estimateUsd.toFixed(3)}`
                    : t("unknown", "未知")}{" "}
                  · {j.createdAt.slice(0, 10)}
                  {j.estimateDetails ? ` · US$${j.estimateDetails.rate}/${t("minute", "分钟")} · ${j.estimateDetails.seconds.toFixed(1)} ${t("seconds", "秒")} · ${t("checked", "核对日期")} ${j.estimateDetails.date} · ${j.estimateDetails.source}` : ` · ${t("rate provenance unavailable", "无费率来源")}`}
                </p>
                {j.requestId && <code>{t("Provider request", "服务商请求编号")}: {j.requestId}</code>}
              </div>
            ))}
          {m.runs.map((run) => (
            <div className="job-entry" key={run.id}>
              <strong>
                {run.provider} · {run.model} · {t("saved original result", "已保存的原始结果")}
              </strong>
              <button
                className="button secondary compact"
                disabled={locked}
                onClick={() => {
                  if (
                    confirm(
                      t("Apply this saved transcription? Current edits will remain in revision history; generated notes will need review.", "应用此保存的转录吗？当前编辑会保留在修订历史中；生成的笔记需要重新审阅。"),
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
                {t("Use this transcription", "使用此转录")}
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
                if (m.audio && m.audio.duration !== d && !saving)
                  void persistQuietly({
                    ...m,
                    audio: { ...m.audio, duration: d },
                  });
              }
            }}
            onTimeUpdate={(e) => {
              if (
                playUntil.current !== null &&
                e.currentTarget.currentTime >= playUntil.current
              ) {
                e.currentTarget.pause();
                playUntil.current = null;
              }
            }}
            onError={() =>
              setNotice(
                "This browser cannot play the recording. The provider may still support it; verify before sending.",
              )
            }
          />
          <button
            className="play-button"
            aria-label={playing ? t("Pause audio", "暂停录音") : t("Play audio", "播放录音")}
            onClick={() => {
              if (playing) player.current?.pause();
              else {
                setAudioStopToken((value) => value + 1);
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
            <span>{t("Original recording", "原始录音")}</span>
          </div>
          <span className="player-time">{formatTime(position)}</span>
          <input
            aria-label={t("Playback position", "播放位置")}
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(position, duration || 1)}
            onChange={(e) => {
              if (player.current) {
                playUntil.current = null;
                player.current.currentTime = Number(e.target.value);
                playback.refresh();
              }
            }}
          />
          <span className="player-time">{formatTime(duration)}</span>
          <select
            aria-label={t("Playback speed", "播放速度")}
            onChange={(e) => {
              if (player.current)
                player.current.playbackRate = Number(e.target.value);
            }}
            value={String(playback.rate)}
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
              ? t("Transcribe this recording?", "转录此录音吗？")
              : t("Generate a new memo version?", "生成新版本笔记吗？")
          }
          onClose={() => setConfirmStage(undefined)}
        >
          <div className="modal-body">
            <div className="notice">
              <ShieldCheck size={18} />
              <span>
                {t("You choose what leaves this device. Nothing is sent until you confirm.", "您决定发送哪些数据。确认之前不会发送任何内容。")}
              </span>
            </div>
            <dl className="confirmation-list">
              <dt>{t("Destination", "接收方")}</dt>
              <dd>
                {getSelection(confirmStage).provider === "openai"
                  ? "OpenAI · api.openai.com"
                  : t("OpenRouter · openrouter.ai (routes to a model provider)", "OpenRouter · openrouter.ai（转发给模型服务商）")}
              </dd>
              <dt>{t("Data sent", "发送的数据")}</dt>
              <dd>
                {confirmStage === "speech"
                  ? t(`Your complete recording (${((m.audio?.size || 0) / 1024 / 1024).toFixed(1)} MB)`, `完整录音（${((m.audio?.size || 0) / 1024 / 1024).toFixed(1)} MB）`)
                  : t("Transcript, speaker names and meeting context (title, date, timezone, languages, type and glossary)", "转录、说话人姓名和会议背景（标题、日期、时区、语言、类型和术语）")}
              </dd>
              <dt>{t("Model", "模型")}</dt>
              <dd>{getSelection(confirmStage).model}</dd>
              <dt>{t("Estimated charge", "预计费用")}</dt>
              <dd>
                {confirmStage === "speech" && getSpeechEstimate(m.audio?.duration) ? (() => {
                  const estimate = getSpeechEstimate(m.audio?.duration)!;
                  return `${t("About", "约")} US$${estimate.amount.toFixed(3)} · ${estimate.seconds.toFixed(1)} ${t("seconds at", "秒，费率")} US$${estimate.rate}/${t("minute", "分钟")} · ${t("checked", "核对日期")} ${estimate.date} · ${estimate.source}. ${t("Assumes the entire recording is billed at this rate.", "假设整个录音按此费率计费。")}`;
                })() : t("Unknown · provider charges apply. A dated applicable rate or duration is unavailable.", "未知 · 服务商可能收费。缺少适用的带日期费率或录音时长。")}
              </dd>
            </dl>
            <p className="muted">
              {t("Keep this page open. Cancellation does not guarantee remote processing or billing stops. The app does not automatically retry. Review the provider's retention policy for your account.", "请保持此页面打开。取消不保证远端处理或计费停止。应用不会自动重试。请查看服务商对您账户的数据保留政策。")}
            </p>
            {confirmStage === "memo" && (unknown || pending) > 0 && (
              <div className="notice sand">
                {t(`${unknown} speakers are unconfirmed and ${pending} passages are unreviewed. Unknown fields remain subject to review.`, `${unknown} 位说话人未确认，${pending} 段转录未审阅。未知字段仍需核对。`)}
              </div>
            )}
            {confirmStage === "speech" && (
              <p className="small muted">
                {t("Audio uploads are limited to 25 MB. Speaker labels and timestamps depend on the chosen model and returned result; missing evidence stays unknown.", "录音上传上限为 25 MB。说话人标签和时间戳取决于所选模型及其返回结果；缺少的证据保持未知。")}
              </p>
            )}
            {confirmStage === "speech" &&
              getSelection("speech").provider === "openai" &&
              getSelection("speech").model === "gpt-4o-transcribe-diarize" &&
              duration > 1400 && (
                <div className="notice sand">
                  <span>
                    {t("Some users have reported duration limits for this model. A shorter recording may help if this request fails.", "部分用户报告此模型存在时长限制。若请求失败，可尝试较短的录音。")}
                  </span>
                </div>
              )}
            {confirmStage === "speech" && m.segments.length > 0 && (
              <div className="notice sand">
                {t("A new transcription replaces the current view only if its source has not changed. Previous text and edits remain in revision history.", "只有来源未改变时，新转录才会替换当前视图。之前的文字和编辑会保留在修订历史中。")}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setConfirmStage(undefined)}
              >
                {t("Cancel", "取消")}
              </button>
              <button
                className="button primary"
                disabled={!getKey(getSelection(confirmStage).provider)}
                onClick={() => void process()}
              >
                {t("Confirm and send", "确认并发送")}
              </button>
            </div>
            {!getKey(getSelection(confirmStage).provider) && (
              <a
                href="#/settings"
                className="text-button"
                onClick={() => setConfirmStage(undefined)}
              >
                {t("Add your key in Settings first", "请先在设置中添加密钥")}
              </a>
            )}
          </div>
        </Modal>
      )}
      {evidence && (
        <Modal
          title={`${t("Source passage", "来源段落")} · r${evidence.revision}`}
          onClose={() => setEvidence(undefined)}
        >
          <div className="modal-body">
            <Pill>{t("Saved evidence revision", "已保存的证据版本")}</Pill>
            <p className="evidence-text">{evidence.text}</p>
            <p className="muted small">
              {evidence.start === null
                ? t("Audio time unknown", "录音时间未知")
                : `${formatTime(evidence.start)} – ${formatTime(evidence.end!)}`}{" "}
              · {evidence.speakerIds.length ? speakerName(m, evidence.speakerIds) : t("Unknown speaker", "未知说话人")}
            </p>
            <div className="toolbar-actions">
              <button
                className="button secondary"
                disabled={!url || evidence.start === null}
                onClick={() => cue(evidence)}
              >
                <Play size={15} />
                {t("Play source audio", "播放来源录音")}
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
                  {t("View current passage", "查看当前段落")}
                </button>
              )}
            </div>
            <p className="small muted">
              {t("This is the exact revision cited by the note. Current transcript wording may differ.", "这是笔记引用的确切修订版本。当前转录内容可能不同。")}
            </p>
          </div>
        </Modal>
      )}
      {metadata && (
        <Modal title={t("Meeting details", "会议资料")} onClose={() => setMetadata(false)}>
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
              {t("Title", "标题")}
              <input
                name="title"
                required
                maxLength={160}
                defaultValue={m.title}
              />
            </label>
            <div className="form-row">
              <label>
                {t("Date", "日期")}
                <input type="date" name="date" required defaultValue={m.date} />
              </label>
              <label>
                {t("Timezone", "时区")}
                <input name="timezone" required defaultValue={m.timezone} />
              </label>
            </div>
            <label>
              {t("Languages", "会议语言")}
              <input
                name="languages"
                maxLength={100}
                defaultValue={m.languages}
              />
            </label>
            <label>
              {t("Terms & context", "术语与背景")}
              <textarea
                name="glossary"
                maxLength={2000}
                defaultValue={m.glossary}
              />
            </label>
            <p className="small muted">
              {t("Changes mark generated notes for re-review.", "更改后，生成的笔记将标记为需要重新审阅。")}
            </p>
            <button type="submit" className="button primary" disabled={locked}>
              {t("Save details", "保存资料")}
            </button>
          </form>
        </Modal>
      )}
      {addText && (
        <Modal title={t("Add a transcript", "添加转录")} onClose={() => setAddText(false)}>
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const imported = importTranscript(newText);
                if (
                  m.segments.length &&
                  !confirm(
                    t("Replace the transcript view? Original and revised text stay in history.", "替换当前转录视图吗？原文及修改后的文字会保留在历史记录中。"),
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
              {t("Paste plain text, optionally one speaker per line as “Name: words”. Names are unconfirmed and times remain unknown.", "粘贴纯文本，可按每行“姓名：内容”输入。姓名未确认，时间保持未知。")}
            </p>
            <label>
              {t("Transcript", "转录")}
              <textarea
                rows={9}
                required
                maxLength={2_000_000}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
            </label>
            <button type="submit" className="button primary" disabled={locked}>
              {t("Save transcript locally", "将转录保存在本地")}
            </button>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title={t("Edit this passage", "编辑此段落")} onClose={() => setEditing(undefined)}>
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
              {t("Transcript text", "转录文字")}
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
                {t("Speakers · leave empty for unknown; select multiple for overlap", "说话人 · 留空表示未知；声音重叠时可多选")}
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
              {t("I reviewed this passage", "我已审阅此段落")}
            </label>
            <details>
              <summary>{t("Original text", "原始文字")}</summary>
              <p>{editing.originalText}</p>
            </details>
            <button className="button primary" disabled={locked}>
              {t("Save correction", "保存更正")}
            </button>
          </form>
        </Modal>
      )}
      {splitting && (
        <Modal
          title={t("Split this passage", "拆分此段落")}
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
              {t("Split after character", "在第几个字符之后拆分")}
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
                {t("Exact audio boundary in seconds · optional", "精确录音分界时间（秒）· 可选")}
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
              {t("Without a verified boundary, both new passages have unknown timing. The original timed source remains in history.", "若没有经过核实的分界点，新段落的时间均为未知。原始带时间的来源保留在历史记录中。")}
            </p>
            <button className="button primary" disabled={locked}>
              {t("Split passage", "拆分段落")}
            </button>
          </form>
        </Modal>
      )}
      {merge && (
        <Modal
          title={t("Merge this voice into another", "将此声音合并到另一说话人")}
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
              {t(`All passages assigned to ${speakerName(m, [merge])} will be reassigned. The combined identity needs confirmation again. You can undo this change.`, `分配给 ${speakerName(m, [merge])} 的所有段落都将重新分配。合并后的身份需要重新确认。您可以撤销此更改。`)}
            </p>
            <label>
              {t("Merge into", "合并到")}
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
              {t("Confirm merge", "确认合并")}
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
  const language = useUiLanguage();
  const t = (en: string, zh: string) => language === "zh-CN" ? zh : en;
  return (
    <details className="original-text">
      <summary>{t("Original generated item", "原始生成项目")}</summary>
      {item ? (
        <>
          <p>{item.text}</p>
          <p className="small muted">
            {t("Owner", "负责人")}: {" "}
            {item.ownerId ? speakerName(meeting, [item.ownerId]) : t("To confirm", "待确认")}
            {" · "}{t("Due", "截止日期")}: {item.dueDate || t("To confirm", "待确认")}
            {item.dueOriginal ? ` · ${t("Said", "原文")}: ${item.dueOriginal}` : ""}
          </p>
        </>
      ) : (
        <p>
          {t("This older memo version did not save a separate original. Its original cannot be reconstructed from human edits.", "此旧版笔记没有单独保存原始内容，无法从人工编辑中还原原文。")}
        </p>
      )}
    </details>
  );
}
