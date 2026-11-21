import { useEffect, useState } from "react";
import { Button } from "../components/controls";
import type { Meeting } from "../domain/model";
import {
  acknowledgeAgentExport,
  pendingAgentReceipt,
  recoverAgentReceipt,
  subscribeAgentRecovery,
} from "../jobs/agent-recovery";
import { download, safeFilename } from "../storage/backup";

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
      {pending.wireResponse && (
        <p>
          {t(
            "This response could not be decoded within the supported record format. Local retry saves only its receipt; export the raw response before releasing this page copy.",
            "此回应无法转换为受支持的记录格式。本地重试仅保存请求记录；释放页面副本前请先导出原始回应。",
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
                JSON.stringify({
                  format: "meeting-memo-agent-receipt",
                  version: 1,
                  ...pending,
                }),
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
          onClick={() => {
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
