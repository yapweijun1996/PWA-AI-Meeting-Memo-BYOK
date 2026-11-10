import { FileText } from "lucide-react";
import { Modal } from "../components/ui";

export function HelpModal({ t, onClose, onExplore }: {
  t: (en: string, zh: string) => string;
  onClose: () => void;
  onExplore: () => void;
}) {
  const steps = [
    [t("Bring your conversation", "添加会议内容"), t("Create a meeting and import a recording or transcript.", "创建会议并导入录音或转录。")],
    [t("Review who said what", "审阅发言人和内容"), t("Connect your own keys in Settings. Speaker labels are anonymous until you confirm them.", "在设置中连接自己的密钥。说话人标签在您确认之前保持匿名。")],
    [t("Make your notes yours", "审阅您的笔记"), t("Review suggested decisions and actions against the source. Export a full backup to keep a separate copy.", "对照来源审阅建议的决定和行动，并导出完整备份以保留副本。")],
  ];
  return (
    <Modal title={t("A little clarity, step by step", "使用步骤")} onClose={onClose}>
      <div className="modal-body help-guide">
        <ol className="help-steps" role="list">
          {steps.map(([title, description]) => (
            <li key={title}>
              <div><strong>{title}</strong><p>{description}</p></div>
            </li>
          ))}
        </ol>
        <div className="notice help-notice">
          {t("Cloud AI needs a connection. Keep this page open while processing. Local storage can be cleared by your browser; backups matter.", "云端 AI 需要网络连接。处理期间请保持页面打开。浏览器可能清除本地数据，请定期备份。")}
        </div>
        <div className="help-example">
          <button className="button secondary full" onClick={onExplore}>
            <FileText size={17} aria-hidden="true" />
            {t("Explore a synthetic example", "查看模拟示例")}
          </button>
          <p className="small muted">{t("The example contains invented text, no recorded audio and no AI-generated results.", "示例使用虚构文字，不含录音或 AI 生成结果。")}</p>
        </div>
      </div>
    </Modal>
  );
}
