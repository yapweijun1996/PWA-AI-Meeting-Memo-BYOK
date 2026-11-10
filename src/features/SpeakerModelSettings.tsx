import { useEffect, useState } from "react";
import { SPEAKER_REMOTE_MODEL_FILES, SPEAKER_REMOTE_MODEL_SOURCE } from "../audio/speaker-embedding";
import { deleteRemoteSpeakerModel, isRemoteSpeakerModelInstalled } from "../audio/speaker-model-store";

/** Shows and removes the speaker model that voice matching downloaded to this browser. */
export function SpeakerModelSettings({ t }: { t: (en: string, zh: string) => string }) {
  const [state, setState] = useState<"checking" | "installed" | "absent" | "error">("checking");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const installed = await isRemoteSpeakerModelInstalled(SPEAKER_REMOTE_MODEL_FILES, SPEAKER_REMOTE_MODEL_SOURCE);
      setState(installed ? "installed" : "absent");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function remove() {
    setBusy(true);
    try {
      await deleteRemoteSpeakerModel();
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <section className="settings-panel" aria-labelledby="speaker-model-heading">
      <h2 id="speaker-model-heading">{t("Speaker model", "说话人模型")}</h2>
      <p>
        {state === "installed"
          ? t("The speaker model (about 102 MB) is stored in this browser and verified against a pinned SHA-256.", "说话人模型（约 102 MB）已保存在此浏览器中，并已用固定的 SHA-256 校验。")
          : state === "absent"
            ? t("No downloaded speaker model. If this build does not include one, voice matching asks before downloading it once.", "没有已下载的说话人模型。如果此版本未内置模型，声音匹配会先询问，再一次性下载。")
            : state === "error"
              ? t("Browser storage could not be read, so the model state is unknown.", "无法读取浏览器存储，因此模型状态未知。")
              : t("Checking the speaker model…", "正在检查说话人模型…")}
      </p>
      <p className="muted">
        {t("The model is fetched from huggingface.co only after you confirm. No recording, transcript, vector or key is sent. Deleting it does not affect meetings.", "只有在您确认后才会从 huggingface.co 获取模型。不会发送录音、转录、向量或密钥。删除模型不会影响会议。")}
      </p>
      <button className="button secondary" disabled={state !== "installed" || busy} onClick={() => void remove()}>
        {t("Delete speaker model", "删除说话人模型")}
      </button>
    </section>
  );
}
