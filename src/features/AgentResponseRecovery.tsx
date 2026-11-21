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
  const canExport = !pending.receiptOnly;
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
        {pending.receiptOnly ? t(
          "The stream ended before the response finished. The app cannot recover its text. Check the provider usage page before submitting another request.",
          "\u56de\u5e94\u4f20\u8f93\u63d0\u524d\u4e2d\u65ad\u3002\u5e94\u7528\u65e0\u6cd5\u6062\u590d\u5176\u4e2d\u7684\u6587\u5b57\u3002\u518d\u6b21\u63d0\u4ea4\u8bf7\u6c42\u524d\uff0c\u8bf7\u67e5\u770b\u670d\u52a1\u5546\u7684\u7528\u91cf\u9875\u9762\u3002",
        ) : !localSave ? t(
          "This meeting is unavailable. Keep this page open until you have saved the response export.",
          "\u65e0\u6cd5\u6253\u5f00\u6b64\u4f1a\u8bae\u3002\u8bf7\u4fdd\u6301\u9875\u9762\u6253\u5f00\uff0c\u76f4\u5230\u4fdd\u5b58\u5bfc\u51fa\u7684\u56de\u5e94\u3002",
        ) : t(
          "This page still holds its sanitized receipt and any bounded response. Keep it open. Retry local saving or export this response before leaving; no request will be repeated. The provider charge is unknown.",
          "此页面仍保留已移除密钥的请求记录及限制内的回应。请保持页面开启，重试本地保存或先导出回应；不会重复发送请求。服务商收费仍未知。",
        )}
      </p>
      {pending.wireResponse !== undefined && (
        <p>
          {t(
            "The full response was received, but the app could not decode it as a usable review. Local retry saves its receipt. Export the raw response to keep the received text.",
            "\u5df2\u6536\u5230\u5b8c\u6574\u56de\u5e94\uff0c\u4f46\u5e94\u7528\u65e0\u6cd5\u5c06\u5176\u8f6c\u6362\u4e3a\u53ef\u7528\u7684\u590d\u6838\u7ed3\u679c\u3002\u672c\u5730\u91cd\u8bd5\u4f1a\u4fdd\u5b58\u8bf7\u6c42\u8bb0\u5f55\u3002\u5bfc\u51fa\u539f\u59cb\u56de\u5e94\u53ef\u4fdd\u7559\u6536\u5230\u7684\u6587\u5b57\u3002",
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
      {canExport && <Button
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
      </Button>}
      {(exported || (!canExport && !localSave)) && (
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
          {canExport ? t(
            "I saved the export; release this page copy",
            "我已保存导出文件，释放页面副本",
          ) : t("Dismiss receipt", "\u5173\u95ed\u8bf7\u6c42\u8bb0\u5f55")}
        </Button>
      )}
    </section>
  );
}
