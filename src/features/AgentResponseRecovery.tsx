import { useEffect, useState } from "react";
import { Button } from "../components/controls";
import type { Meeting } from "../domain/model";
import {
  acknowledgeAgentExport,
  pendingAgentReceipt,
  recoverAgentReceipt,
} from "../jobs/agent-recovery";
import { download, safeFilename } from "../storage/backup";

export function AgentResponseRecovery({
  meeting,
  onUpdate,
  t,
  onError,
}: {
  meeting: Meeting;
  onUpdate: (meeting: Meeting) => void;
  t: (en: string, zh: string) => string;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(() => pendingAgentReceipt(meeting.id));
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  useEffect(() => {
    const changed = () => {
      setPending(pendingAgentReceipt(meeting.id));
      setExported(false);
    };
    changed();
    window.addEventListener("memo-agent-recovery-changed", changed);
    return () =>
      window.removeEventListener("memo-agent-recovery-changed", changed);
  }, [meeting.id]);
  if (!pending) return null;
  return (
    <section
      className="notice sand"
      role="alert"
      data-unsaved-edit="true"
      aria-label={t("Unsaved review response", "尚未保存的复核回应")}
    >
      <strong>
        {t("A request outcome could not be saved", "请求结果无法保存")}
      </strong>
      <p>
        {t(
          "This page still holds its sanitized receipt and any bounded response. Keep it open. Retry local saving or export this response before leaving; no request will be repeated. The provider charge is unknown.",
          "此页面仍保留已移除密钥的请求记录及限制内的回应。请保持页面开启，重试本地保存或先导出回应；不会重复发送请求。服务商收费仍未知。",
        )}
      </p>
      {pending.wireResponse && (
        <p>
          {t(
            "This response could not be decoded within the supported record format. Local retry saves only its receipt; export the raw response before releasing this page copy.",
            "此回应无法转换为受支持的记录格式。本地重试仅保存请求记录；释放页面副本前请先导出原始回应。",
          )}
        </p>
      )}
      <Button
        className="button secondary"
        pending={busy}
        onClick={async () => {
          setBusy(true);
          try {
            onUpdate(await recoverAgentReceipt(meeting.id));
          } catch (error) {
            onError(
              error instanceof Error ? error.message : "Local recovery failed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Retry local save only", "仅重试本地保存")}
      </Button>
      <Button
        className="button secondary"
        disabled={busy}
        onClick={() => {
          download(
            new Blob(
              [
                JSON.stringify({
                  format: "meeting-memo-agent-receipt",
                  version: 1,
                  ...pending,
                }),
              ],
              { type: "application/json" },
            ),
            `${safeFilename(meeting.title)}-unsaved-review-response.json`,
          );
          setExported(true);
        }}
      >
        {t("Export unsaved response", "导出未保存回应")}
      </Button>
      {exported && (
        <Button
          className="button secondary"
          onClick={() => acknowledgeAgentExport(meeting.id)}
        >
          {t(
            "I saved the export; release this page copy",
            "我已保存导出文件，释放页面副本",
          )}
        </Button>
      )}
    </section>
  );
}
