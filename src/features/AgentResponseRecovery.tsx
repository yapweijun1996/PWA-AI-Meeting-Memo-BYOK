import { useEffect, useState } from "react";
import { Button } from "../components/controls";
import type { Meeting } from "../domain/model";
import {
  acknowledgeAgentExport,
  pendingAgentReceipt,
  receiptExport,
  recoverAgentReceipt,
  subscribeAgentRecovery,
} from "../jobs/agent-recovery";
import { download, safeFilename } from "../storage/backup";
import { clearDeletedMeetingWriteFailure } from "../storage/repository";

export function AgentResponseRecovery({
  meetingId,
  localSave,
  t,
}: {
  meetingId: string;
  localSave?: {
    title: string;
    onUpdate: (meeting: Meeting) => void;
    onError: (message: string) => void;
  };
  t: (en: string, zh: string) => string;
}) {
  const [pending, setPending] = useState(() => pendingAgentReceipt(meetingId));
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  useEffect(() => {
    const changed = () => {
      setPending(pendingAgentReceipt(meetingId));
      setExported(false);
    };
    changed();
    return subscribeAgentRecovery(changed);
  }, [meetingId]);
  if (!pending) return null;
  return (
    <section
      className="notice sand"
      role="alert"
      data-unsaved-edit={localSave ? true : undefined}
      aria-label={t("Unsaved review response", "尚未保存的复核回应")}
    >
      <strong>
        {t("A request outcome could not be saved", "请求结果无法保存")}
      </strong>
      <p>
        {!localSave ? t(
          "This meeting is unavailable. Keep this page open until you have saved the response export.",
          "\u65e0\u6cd5\u6253\u5f00\u6b64\u4f1a\u8bae\u3002\u8bf7\u4fdd\u6301\u9875\u9762\u6253\u5f00\uff0c\u76f4\u5230\u4fdd\u5b58\u5bfc\u51fa\u7684\u56de\u5e94\u3002",
        ) : t(
          "This page still holds its sanitized receipt and any bounded response. Keep it open. Retry local saving or export this response before leaving; no request will be repeated. The provider charge is unknown.",
          "此页面仍保留已移除密钥的请求记录及限制内的回应。请保持页面开启，重试本地保存或先导出回应；不会重复发送请求。服务商收费仍未知。",
        )}
      </p>
      {pending.recoveryArtifact && (
        <p>
          {t(
            "Local retry saves only the receipt. Export the recovery artifact to keep the available text grouped by content type. The file omits raw frames and cannot be imported as a backup.",
            "\u672c\u5730\u91cd\u8bd5\u4ec5\u4fdd\u5b58\u8bf7\u6c42\u8bb0\u5f55\u3002\u8bf7\u5bfc\u51fa\u6062\u590d\u6587\u4ef6\u4ee5\u4fdd\u7559\u6309\u5185\u5bb9\u7c7b\u578b\u6574\u7406\u7684\u6587\u5b57\u3002\u6587\u4ef6\u7701\u7565\u539f\u59cb\u6570\u636e\u5e27\uff0c\u4e14\u65e0\u6cd5\u4f5c\u4e3a\u5907\u4efd\u5bfc\u5165\u3002",
          )}
        </p>
      )}
      {localSave && <Button
        className="button secondary"
        pending={busy}
        onClick={async () => {
          setBusy(true);
          try {
            localSave.onUpdate(await recoverAgentReceipt(meetingId));
          } catch (error) {
            localSave.onError(
              error instanceof Error ? error.message : "Local recovery failed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Retry local save only", "仅重试本地保存")}
      </Button>}
      <Button
        className="button secondary"
        disabled={busy}
        onClick={() => {
          download(
            new Blob(
              [
                JSON.stringify(receiptExport(pending)),
              ],
              { type: "application/json" },
            ),
            `${safeFilename(localSave?.title ?? meetingId)}-unsaved-review-response.json`,
          );
          setExported(true);
        }}
      >
        {t("Export unsaved response", "导出未保存回应")}
      </Button>
      {exported && (
        <Button
          className="button secondary"
          pending={busy}
          onClick={async () => {
            if (pendingAgentReceipt(meetingId) !== pending) return;
            if (!localSave) {
              setBusy(true);
              try { await clearDeletedMeetingWriteFailure(meetingId); }
              catch { /* Keep the write guard if deletion cannot be verified. */ }
              finally { setBusy(false); }
            }
            if (pendingAgentReceipt(meetingId) === pending) acknowledgeAgentExport(meetingId);
          }}
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
