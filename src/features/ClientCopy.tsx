import { useState } from "react";
import { Button } from "../components/controls";
import { MemoEditorField } from "./MemoEditorField";

type Props = {
  text: string;
  version: string;
  disabled: boolean;
  locked: boolean;
  t: (en: string, zh: string) => string;
  save: (text: string) => Promise<void>;
  dirty: (value: boolean) => void;
  download: () => void;
};

export function ClientCopy({
  text,
  version,
  disabled,
  locked,
  t,
  save,
  dirty,
  download,
}: Props) {
  const [approved, setApproved] = useState<string>();
  const receipt = JSON.stringify([version, text]);
  return (
    <details className="memo-document-section">
      <summary>
        {t("Client copy · edit and preview", "对外正文 · 编辑与预览")}
      </summary>
      <MemoEditorField
        allowEmpty
        label={t("Client-facing text", "对外正文")}
        value={text}
        disabled={disabled}
        showTools={false}
        headingText=""
        bulletText=""
        failureText={t("Could not save the client copy.", "对外正文保存失败。")}
        onSelectionChange={() => {}}
        onDirtyChange={(value) => {
          if (value) setApproved(undefined);
          dirty(value);
        }}
        onSave={save}
      />
      <h4>{t("External preview", "对外预览")}</h4>
      <p className="memo-reading-text">{text}</p>
      <label>
        <input
          type="checkbox"
          disabled={locked || !text.trim()}
          checked={approved === receipt}
          onChange={(event) =>
            setApproved(event.target.checked ? receipt : undefined)
          }
        />
        {t(
          "I reviewed this exact text for sharing with the client.",
          "我已核对以上正文，确认适合提供给客户。",
        )}
      </label>
      <Button
        disabled={!text.trim() || locked || approved !== receipt}
        onClick={download}
      >
        {t("Download client copy", "下载对外正文")}
      </Button>
    </details>
  );
}
