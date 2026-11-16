import { useRef, useState } from "react";
import { formatBytes, scanStorage, type MeetingStorageRow, type StorageReport } from "../storage/storage-report";

type Translate = (en: string, zh: string) => string;
/** From this share of the meeting size limit the row is flagged. */
const NEAR_LIMIT = 0.75;

const percent = (value: number) => `${Math.min(999, Math.round(value * 100))}%`;

function Meter({ label, value, max, warn }: { label: string; value: number; max: number; warn?: boolean }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div
      className={`storage-meter${warn ? " is-warn" : ""}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={`${formatBytes(value)} / ${formatBytes(max)}`}
    >
      <span style={{ width: `${share * 100}%` }} />
    </div>
  );
}

function Composition({ row, t }: { row: MeetingStorageRow; t: Translate }) {
  const parts: [string, string, number][] = [
    ["Transcript passages", "转录片段", row.recordParts.segments],
    ["Edit history", "修改历史", row.recordParts.history],
    ["Undo copies", "撤销副本", row.recordParts.undo],
    ["Provider runs (original output)", "服务商原始输出", row.recordParts.providerRuns],
    ["Memo versions", "纪要版本", row.recordParts.memos],
    ["Memo plans", "纪要计划", row.recordParts.memoPlans],
    ["Everything else", "其他", row.recordParts.other],
  ];
  return (
    <dl className="storage-parts">
      {parts.map(([en, zh, bytes]) => (
        <div key={en}>
          <dt>{t(en, zh)}</dt>
          <dd>{formatBytes(bytes)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Settings panel: how much of this browser's storage the app uses, per meeting. Read-only. */
export function StorageMonitor({ t }: { t: Translate }) {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [state, setState] = useState<"idle" | "scanning" | "error">("idle");
  const [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);

  async function scan() {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState("scanning");
    try {
      const result = await scanStorage({
        signal: next.signal,
        onProgress: (done, total) => setProgress(`${done}/${total}`),
      });
      if (controller.current !== next) return;
      setReport(result);
      setState("idle");
    } catch {
      if (controller.current === next) setState("error");
    } finally {
      if (controller.current === next) setProgress("");
    }
  }

  const share = report?.usageBytes != null && report.quotaBytes ? report.usageBytes / report.quotaBytes : null;
  const near = report?.meetings.filter((row) => row.limitShare >= NEAR_LIMIT) ?? [];

  return (
    <section className="settings-panel" aria-labelledby="storage-monitor-heading">
      <h2 id="storage-monitor-heading">{t("Storage monitor", "存储监控")}</h2>
      <p className="muted">
        {t(
          "Shows what this app keeps in your browser's IndexedDB. Read-only: nothing is changed or deleted, and provider keys are not read. Sizes are estimates.",
          "显示此应用保存在浏览器 IndexedDB 中的内容。只读：不会修改或删除任何内容，也不会读取服务商密钥。大小为估算值。",
        )}
      </p>
      <button className="button secondary" disabled={state === "scanning"} onClick={() => void scan()}>
        {state === "scanning" ? t(`Scanning ${progress}`, `正在扫描 ${progress}`) : report ? t("Scan again", "重新扫描") : t("Scan storage", "扫描存储")}
      </button>
      {state === "error" && (
        <p className="notice" role="alert">
          {t("Storage could not be read. Close other tabs of this app and try again.", "无法读取存储。请关闭此应用的其他标签页后重试。")}
        </p>
      )}
      {report && (
        <div className="storage-report" aria-live="polite">
          <h3>{t("This site in this browser", "此网站在此浏览器中")}</h3>
          {report.usageBytes != null && report.quotaBytes ? (
            <>
              <Meter label={t("Browser storage used", "浏览器存储已用")} value={report.usageBytes} max={report.quotaBytes} warn={(share ?? 0) >= 0.8} />
              <p>
                {t(
                  `${formatBytes(report.usageBytes)} used of about ${formatBytes(report.quotaBytes)} available (${percent(share ?? 0)}).`,
                  `已用 ${formatBytes(report.usageBytes)}，约 ${formatBytes(report.quotaBytes)} 可用（${percent(share ?? 0)}）。`,
                )}
              </p>
            </>
          ) : (
            <p>{t("This browser does not report a usage estimate.", "此浏览器不提供用量估算。")}</p>
          )}
          <p className="muted">
            {report.persisted === true
              ? t("Persistent storage is granted: the browser should not clear this data when space is low.", "已授予持久化存储：存储空间不足时，浏览器不应清除这些数据。")
              : report.persisted === false
                ? t("Persistent storage is not granted: the browser may clear this data when space is low. Export backups regularly.", "未授予持久化存储：存储空间不足时，浏览器可能清除这些数据。请定期导出备份。")
                : t("Persistent storage status is unknown.", "持久化存储状态未知。")}
          </p>
          <p className="muted">
            {t(
              "The browser figure also counts other apps on this site, the speaker model, app caches and settings. The meetings below are only what this app measured.",
              "浏览器给出的总数还包括此网站上的其他应用、说话人模型、应用缓存和设置。下面的会议只是本应用测得的部分。",
            )}
          </p>

          <h3>{t("Meetings", "会议")} · {formatBytes(report.measuredBytes)}</h3>
          <p className="muted">
            {t(
              `Each meeting is saved as one document, limited to ${formatBytes(report.meetingLimitBytes)}. Recordings, voice data and images are stored separately and are not part of that limit.`,
              `每场会议保存为一个文档，上限为 ${formatBytes(report.meetingLimitBytes)}。录音、声音数据和图片单独保存，不计入该上限。`,
            )}
          </p>
          {near.length > 0 && (
            <p className="notice sand" role="status">
              {t(
                `${near.length} meeting(s) use more than ${percent(NEAR_LIMIT)} of the meeting size limit. Export a backup before editing further.`,
                `${near.length} 场会议已使用超过 ${percent(NEAR_LIMIT)} 的会议大小上限。继续编辑前请先导出备份。`,
              )}
            </p>
          )}
          {report.meetings.length === 0 && <p>{t("No meetings are stored.", "没有保存的会议。")}</p>}
          <ul className="storage-meetings">
            {report.meetings.map((row) => (
              <li key={row.meetingId}>
                <div className="storage-meeting-head">
                  <strong>{row.title}</strong>
                  <span>{formatBytes(row.totalBytes)}</span>
                </div>
                <Meter label={t(`${row.title}: meeting document`, `${row.title}：会议文档`)} value={row.recordBytes} max={report.meetingLimitBytes} warn={row.limitShare >= NEAR_LIMIT} />
                <p className="muted">
                  {t(
                    `Meeting document ${formatBytes(row.recordBytes)} (${percent(row.limitShare)} of the limit) · recording ${formatBytes(row.recordingBytes)} · voice data ${formatBytes(row.voiceAndPartBytes)} · images ${formatBytes(row.imageBytes)}`,
                    `会议文档 ${formatBytes(row.recordBytes)}（占上限 ${percent(row.limitShare)}）· 录音 ${formatBytes(row.recordingBytes)} · 声音数据 ${formatBytes(row.voiceAndPartBytes)} · 图片 ${formatBytes(row.imageBytes)}`,
                  )}
                </p>
                <details>
                  <summary>{t("What is in the meeting document", "会议文档里有什么")}</summary>
                  <Composition row={row} t={t} />
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
