const sources = {
  upstream: "https://huggingface.co/microsoft/wavlm-base-plus-sv/blob/feb593a6c23c1cc3d9510425c29b0a14d2b07b1e/README.md",
  licence: "https://github.com/microsoft/UniSpeech/blob/8f8cbd22d352fc59dfd5bf19de979b05bb5c7938/LICENSE",
  conversion: "https://huggingface.co/Xenova/wavlm-base-plus-sv/blob/e61029603001bd11295c36d878698708bf59190f/README.md",
};

export function SpeakerModelNotice({ t, context }: {
  t: (english: string, chinese: string) => string;
  context: "local-analysis" | "transcription";
}) {
  return (
    <div>
      <p>
        {t("If this build does not include the speaker model, confirming voice analysis starts a one-time download (about 102 MB) from huggingface.co, checked against a pinned SHA-256. That host sees your IP address and browser details. The model stays in this browser and can be deleted in Settings.", "如果此版本未内置说话人模型，确认进行声音分析后会从 huggingface.co 一次性下载（约 102 MB），并用固定的 SHA-256 校验。该网站会看到您的 IP 地址和浏览器信息。模型保存在此浏览器中，可在设置中删除。")}
      </p>
      <p>
        {context === "local-analysis"
          ? t("Audio is decoded in bounded windows; no audio, transcript, vector or key is sent anywhere.", "录音只在受限窗口中解码；不会发送录音、转录、向量或密钥。")
          : t("Uses bounded local acoustic samples only; model thresholds are uncalibrated. Unknown or conflicting voices remain unresolved. The model and vectors stay in this browser and are not sent with the transcription request.", "仅使用受限的本地声学样本；模型阈值尚未校准。未知或冲突声音会保持未解决。模型和向量保留在此浏览器中，不会随转录请求发送。")}
      </p>
      <p>
        {t("Microsoft’s upstream model card links CC BY-SA 3.0. Review of the ONNX conversion’s attribution and licence notices is still open.", "Microsoft 上游模型卡链接至 CC BY-SA 3.0。ONNX 转换版本的署名与许可证声明仍待核查。")}
      </p>
      <details>
        <summary>{t("Model sources and licence", "模型来源与许可证")}</summary>
        <a className="text-button" href={sources.upstream} target="_blank" rel="noopener noreferrer">{t("Microsoft model card", "Microsoft 模型卡")}</a>
        <br />
        <a className="text-button" href={sources.licence} target="_blank" rel="noopener noreferrer">{t("Upstream licence (CC BY-SA 3.0)", "上游许可证（CC BY-SA 3.0）")}</a>
        <br />
        <a className="text-button" href={sources.conversion} target="_blank" rel="noopener noreferrer">{t("Xenova ONNX model card", "Xenova ONNX 模型卡")}</a>
      </details>
    </div>
  );
}
