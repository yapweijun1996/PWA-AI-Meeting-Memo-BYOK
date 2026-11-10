import { translateUi } from "../i18n";
import { useState, type FormEvent } from "react";
import { FileAudio, FileText, Plus, Upload, Check } from "lucide-react";
import {
  createMeeting,
  localDate,
  importTranscript,
  validateMeeting,
  type Meeting,
} from "../domain/model";
import { saveMeeting } from "../storage/repository";
import { inspectAudio } from "../audio/files";
import { importLongRecording, isLongRecordingCandidate } from "../audio/long-import";
import { deleteLongAudio } from "../storage/long-audio-store";
import { Modal } from "../components/ui";
import { useUiLanguage } from "../ui-language";
import { translateMessage } from "../ui-messages";
export function NewMeeting({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (m: Meeting) => void;
  onError: (s: string) => void;
}) {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const [date, setDate] = useState(() => localDate());
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [timezones] = useState(() => {
    try {
      const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
      return [...new Set([timezone, "UTC", ...(intl.supportedValuesOf?.("timeZone") ?? [])])];
    } catch {
      return [timezone, "UTC"];
    }
  });
  const dateLabel = date && !Number.isNaN(Date.parse(`${date}T12:00:00Z`))
    ? new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))
    : "";
  const [file, setFile] = useState<File>(),
    [dragOver, setDragOver] = useState(false),
    [transcript, setTranscript] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    let importedMeetingId = "";
    let storedChunks = false;
    try {
      const form = new FormData(e.currentTarget);
      const selectedTimezone = String(form.get("timezone")).trim();
      try {
        new Intl.DateTimeFormat("en", { timeZone: selectedTimezone }).format();
      } catch {
        throw new Error(t("Enter a valid timezone, such as Asia/Singapore or UTC.", "请输入有效时区，例如 Asia/Singapore 或 UTC。"));
      }
      let m = createMeeting({
        title: String(form.get("title")).trim(),
        date: String(form.get("date")),
        timezone: selectedTimezone,
        languages: String(form.get("languages")),
        kind: form.get("kind") === "erp" ? "erp" : "general",
        attendees: String(form.get("attendees"))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        glossary: String(form.get("glossary")),
      });
      if (transcript.trim()) {
        if (transcript.trim().startsWith("{")) {
          const imported = validateMeeting(JSON.parse(transcript));
          m = {
            ...m,
            speakers: imported.speakers,
            segments: imported.segments,
            history: imported.history,
            runs: imported.runs,
            audio: imported.audio
              ? { ...imported.audio, present: false }
              : null,
          };
        } else {
          m = { ...m, ...importTranscript(transcript) };
        }
      }
      if (file) {
        if (isLongRecordingCandidate(file)) {
          const result = await importLongRecording(file, m.id, {
            onProgress: (p) => setProgress(`${p.phase}: ${p.done}/${p.total}`),
          });
          importedMeetingId = m.id;
          storedChunks = true;
          if (m.audio && m.audio.hash !== result.audio.hash)
            throw new Error(t("This recording does not match the imported transcript's source. Use its original recording or create a separate meeting.", "录音与导入转录的来源不符。请使用原录音或另建会议。"));
          if (!m.audio && m.segments.some((s) => s.start !== null) && !confirm(t("Confirm this is the original recording for the imported timestamps. Verify playback before relying on them.", "请确认这是导入时间戳对应的原始录音，并在使用前验证播放。"))) {
            await deleteLongAudio(m.id);
            return;
          }
          m.audio = result.audio;
        } else {
          const info = await inspectAudio(file);
          if (m.audio && m.audio.hash !== info.hash)
            throw new Error(t("This recording does not match the imported transcript's source. Use its original recording or create a separate meeting.", "录音与导入转录的来源不符。请使用原录音或另建会议。"));
          if (!m.audio && m.segments.some((s) => s.start !== null) && !confirm(t("Confirm this is the original recording for the imported timestamps. Verify playback before relying on them.", "请确认这是导入时间戳对应的原始录音，并在使用前验证播放。"))) return;
          m.audio = info;
        }
      }
      const saved = storedChunks ? await saveMeeting(m) : await saveMeeting(m, file);
      onCreated(saved);
    } catch (err) {
      if (storedChunks && importedMeetingId) {
        try { await deleteLongAudio(importedMeetingId); } catch { /* preserve the original import error */ }
      }
      const message = err instanceof Error ? err.message : t("The meeting could not be saved.", "无法保存会议。");
      setError(message);
      onError("");
    } finally {
      setProgress("");
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("Make space for a new meeting", "创建新会议")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="modal-body new-meeting-form">
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <p className="muted new-meeting-intro">
          {t("A recording, a transcript, or just a title to get started.", "从录音、转录或会议标题开始。")}
        </p>
        {error && (
          <div className="notice danger" role="alert">
            {translateMessage(error, language)}
          </div>
        )}
        {progress && <div className="notice" role="status">{t("Importing long recording", "正在导入长录音")} · {progress}</div>}
        <label>
          {t("Meeting title", "会议标题")}
          <input
            name="title"
            required
            maxLength={160}
            placeholder={t("e.g. ERP workflow discovery", "例如：ERP 工作流程讨论")}
            data-initial-focus
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            {t("Date", "日期")}
            <input
              type="date"
              name="date"
              aria-label={t("Date", "日期")}
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-describedby="meeting-date-description"
            />
            <span id="meeting-date-description" className="field-description">{dateLabel}</span>
          </label>
          <label>
            {t("Timezone", "时区")}
            <input
              name="timezone"
              aria-label={t("Timezone", "时区")}
              required
              maxLength={80}
              defaultValue={timezone}
              list="meeting-timezones"
              aria-describedby="meeting-timezone-description"
            />
            <span id="meeting-timezone-description" className="field-description">{t("Search or enter a timezone, for example Asia/Singapore.", "搜索或输入时区，例如 Asia/Singapore。")}</span>
          </label>
        </div>
        <datalist id="meeting-timezones">{timezones.map((zone) => <option key={zone} value={zone} />)}</datalist>
        <div className="new-meeting-source-heading">
          <strong>{t("Meeting content", "会议内容")}</strong>
          <span>{t("Optional · you can add content later", "可选 · 可稍后添加内容")}</span>
        </div>
        <label
          className={`upload-zone ${file ? "has-file" : ""} ${dragOver ? "is-dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
        >
          <span>{file ? <Check size={25} /> : <Upload size={25} />}</span>
          <strong>{file ? file.name : t("Add a meeting recording", "添加会议录音")}</strong>
          <small>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ${t("stays on this device until you confirm", "确认发送前保留在本设备")}`
              : t("Drag or browse · up to 4 GiB, subject to device storage", "拖放或浏览文件 · 最大 4 GiB，受设备存储限制")}
          </small>
          <input
            aria-label={t("Audio recording", "会议录音")}
            type="file"
            accept="audio/*,.mp4,.m4a,.webm,.flac"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
          <span className="button secondary compact">
            <FileAudio size={15} />
            {file ? t("Change recording", "更换录音") : t("Browse files", "浏览文件")}
          </span>
        </label>
        <details className="new-meeting-details">
          <summary>
            <FileText size={16} />
            {t("Start from a transcript instead", "使用已有转录")}
          </summary>
          <label className="text-file">
            {t("Import TXT or a Meeting Memo JSON file", "导入 TXT 或 Meeting Memo JSON 文件")}
            <input
              type="file"
              accept=".txt,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 2_000_000) {
                  setError(t("Transcript import is limited to 2 MB.", "导入的转录不能超过 2 MB。"));
                  return;
                }
                setTranscript(await f.text());
              }}
            />
          </label>
          <label>
            {t("Transcript", "转录")}
            <textarea
              rows={5}
              maxLength={2_000_000}
              value={transcript}
              placeholder={
                t("Jamie: What should we review?\nAlex: The inventory workflow.", "小明：我们需要讨论什么？\n小华：库存工作流程。")
              }
              onChange={(e) => setTranscript(e.target.value)}
            />
          </label>
          <p className="small muted">
            {t("JSON imports transcript evidence only; use Restore backup to retain notes. Names are unconfirmed. Plain text has no audio timing; playback links are only created for real timed evidence.", "JSON 仅导入转录证据；如需保留笔记，请使用恢复备份。姓名尚未确认。纯文本没有音频时间戳；只有真实带时间的证据才会生成播放链接。")}
          </p>
        </details>
        <details className="new-meeting-details">
          <summary>
            {t("Meeting context", "会议背景")} <span className="small muted">{t("optional", "可选")}</span>
          </summary>
          <div className="form-row">
            <label>
              {t("Languages", "会议语言")}
              <input
                name="languages"
                defaultValue="Chinese, English"
                maxLength={100}
              />
            </label>
            <label>
              {t("Meeting type", "会议类型")}
              <select name="kind">
                <option value="general">{t("General meeting", "一般会议")}</option>
                <option value="erp">{t("ERP discovery", "ERP 需求讨论")}</option>
              </select>
            </label>
          </div>
          <label>
            {t("Attendees", "参会者")}
            <input
              name="attendees"
              placeholder="Jamie, Alex"
              maxLength={1000}
            />
          </label>
          <label>
            {t("Terms & context", "术语与背景")}
            <textarea
              name="glossary"
              rows={2}
              maxLength={2000}
              placeholder={t("Product names, ERP modules, acronyms…", "产品名称、ERP 模块、缩略词…")}
            />
          </label>
        </details>
        <div className="new-meeting-footer">
        <p className="small muted">
          {t("No AI request is made when you create a meeting.", "创建会议不会发送 AI 请求。")}
        </p>
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t("Cancel", "取消")}
          </button>
          <button className="button primary" disabled={busy} type="submit">
            <Plus size={17} />
            {busy ? t("Saving locally…", "正在保存到本地…") : t("Create meeting", "创建会议")}
          </button>
        </div>
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}
