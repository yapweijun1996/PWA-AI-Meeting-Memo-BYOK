import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Eye, Save, StopCircle } from "lucide-react";
import { useUiLanguage } from "../ui-language";
import {
  buildYouTubeEmbedUrl,
  buildYouTubeUrl,
  parseVideoUrl,
  ReferenceVideoSchema,
  suggestVideoId,
  type ReferenceVideo,
} from "../domain/reference-video";

type AudioRange = { start: number; end: number };

export function ReferenceVideo({
  value,
  audioName,
  range,
  disabled,
  stopToken,
  onSave,
  onBeforeWatch,
}: {
  value: ReferenceVideo | null | undefined;
  audioName?: string;
  range: AudioRange | null;
  disabled: boolean;
  stopToken: number;
  onSave: (value: ReferenceVideo | null) => Promise<void>;
  onBeforeWatch: () => void;
}) {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => (language === "zh-CN" ? zh : en);
  const [videoUrl, setVideoUrl] = useState(() =>
    value?.youtubeId ? buildYouTubeUrl(value.youtubeId) : "",
  );
  const [offsetText, setOffsetText] = useState(() =>
    String(value?.offsetSeconds ?? 0),
  );
  const [error, setError] = useState("");
  const [active, setActive] = useState<{
    video: ReferenceVideo;
    source: string;
    audioRange: AudioRange | null;
  } | null>(null);

  useEffect(() => {
    setVideoUrl(value?.youtubeId ? buildYouTubeUrl(value.youtubeId) : "");
    setOffsetText(String(value?.offsetSeconds ?? 0));
    setError("");
    setActive((current) =>
      current &&
      current.video.youtubeId === (value?.youtubeId ?? "") &&
      current.video.offsetSeconds === (value?.offsetSeconds ?? 0)
        ? current
        : null,
    );
  }, [value?.youtubeId, value?.offsetSeconds]);

  useEffect(() => {
    // A new sample or local-audio playback must unload the old embed. This is
    // intentionally keyed by the explicit stop token, not by playback ticks.
    setActive(null);
  }, [stopToken]);

  const suggestedId = useMemo(() => suggestVideoId(audioName), [audioName]);
  const draftId = parseVideoUrl(videoUrl);
  const persistedId = value?.youtubeId ?? "";
  const draftOffset = Number(offsetText);
  const persistedOffset = value?.offsetSeconds ?? 0;
  const isDraftDifferent = videoUrl.trim()
    ? !draftId || !Number.isFinite(draftOffset) || draftId !== persistedId || draftOffset !== persistedOffset
    : Boolean(persistedId) || !Number.isFinite(draftOffset) || draftOffset !== persistedOffset;

  function readDraft(): ReferenceVideo | null {
    if (!videoUrl.trim()) return null;
    const youtubeId = parseVideoUrl(videoUrl);
    if (!youtubeId) {
      setError(
        t(
          "Enter an HTTPS YouTube watch, youtu.be, embed or shorts URL.",
          "请输入 HTTPS YouTube watch、youtu.be、embed 或 shorts 链接。",
        ),
      );
      return null;
    }
    const parsed = ReferenceVideoSchema.safeParse({
      youtubeId,
      offsetSeconds: Number(offsetText),
    });
    if (!parsed.success) {
      setError(
        t(
          "Offset must be a finite number between -86400 and 86400 seconds.",
          "偏移必须是 -86400 到 86400 秒之间的有限数字。",
        ),
      );
      return null;
    }
    return parsed.data;
  }

  async function saveDraft() {
    setError("");
    const next = readDraft();
    if (videoUrl.trim() && !next) return;
    try {
      await onSave(next);
    } catch {
      setError(
        t(
          "Could not save the video reference. Your draft is still here.",
          "无法保存视频参考。您的草稿仍保留在此处。",
        ),
      );
    }
  }

  async function watchSample() {
    setError("");
    const next = readDraft();
    if (!next) {
      if (!videoUrl.trim())
        setError(
          t(
            "Add a YouTube URL before loading the reference video.",
            "加载参考视频前，请先添加 YouTube 链接。",
          ),
        );
      return;
    }
    let shifted: AudioRange | null = null;
    if (range && Number.isFinite(range.start) && Number.isFinite(range.end)) {
      const start = range.start + next.offsetSeconds;
      const end = range.end + next.offsetSeconds;
      if (end <= 0) {
        setError(
          t(
            "The offset places this sample before the start of the video. Adjust the offset first.",
            "此偏移会让样本落在视频开始之前。请先调整偏移。",
          ),
        );
        return;
      }
      shifted = { start: Math.max(0, start), end };
    }
    try {
      if (next.youtubeId !== persistedId || next.offsetSeconds !== persistedOffset)
        await onSave(next);
      onBeforeWatch();
      setActive({
        video: next,
        source: buildYouTubeEmbedUrl(next.youtubeId, shifted),
        audioRange: range,
      });
    } catch {
      setError(
        t(
          "Could not save the video reference. Your draft is still here.",
          "无法保存视频参考。您的草稿仍保留在此处。",
        ),
      );
    }
  }

  function useSuggestion() {
    if (!suggestedId) return;
    setVideoUrl(buildYouTubeUrl(suggestedId));
    setActive(null);
    setError("");
  }

  const external = active
    ? buildYouTubeUrl(
        active.video.youtubeId,
        active.audioRange ? active.audioRange.start + active.video.offsetSeconds : undefined,
      )
    : draftId
      ? buildYouTubeUrl(draftId, range ? range.start + (Number.isFinite(draftOffset) ? draftOffset : 0) : undefined)
      : "";

  return (
    <section className="reference-video" data-unsaved-edit={isDraftDifferent ? "true" : undefined}>
      <div className="reference-video-head">
        <div>
          <h3>{t("See the people in the source video", "查看原视频中的人物")}</h3>
          <p className="small muted">
            {t(
              "Load a public video only when you choose. It is a visual reference for manual review, not face or voice identification.",
              "仅在您选择后加载公开视频。它用于人工核对画面，不会进行人脸或声音识别。",
            )}
          </p>
        </div>
        {suggestedId && !value?.youtubeId && (
          <button
            type="button"
            className="button secondary compact"
            onClick={useSuggestion}
            disabled={disabled}
          >
            {t("Use filename suggestion", "使用文件名建议")}
          </button>
        )}
      </div>

      {active && (
        <div className="reference-video-player">
          <div className="reference-video-player-head">
            <strong>{t("Reference video loaded", "参考视频已加载")}</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => setActive(null)}
              aria-label={t("Stop reference video", "停止参考视频")}
            >
              <StopCircle size={14} /> {t("Stop", "停止")}
            </button>
          </div>
          <iframe
            src={active.source}
            title={t("Reference video", "参考视频")}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <p className="small muted">
            {t(
              "YouTube may seek a little before the requested timestamp. Use the player controls to check the person manually.",
              "YouTube 可能会定位到请求时间点前几秒。请使用播放器控件人工核对人物。",
            )}
          </p>
        </div>
      )}

      <div className="reference-video-form">
        <label>
          {t("YouTube URL", "YouTube 链接")}
          <input
            aria-label={t("YouTube URL", "YouTube 链接")}
            value={videoUrl}
            placeholder="https://www.youtube.com/watch?v=…"
            onChange={(event) => {
              setVideoUrl(event.target.value);
              setActive(null);
              setError("");
            }}
            disabled={disabled}
          />
        </label>
        <label>
          {t("Audio-to-video offset (seconds)", "音频到视频的偏移（秒）")}
          <input
            aria-label={t("Audio-to-video offset (seconds)", "音频到视频的偏移（秒）")}
            type="number"
            step="1"
            min="-86400"
            max="86400"
            value={offsetText}
            onChange={(event) => {
              setOffsetText(event.target.value);
              setActive(null);
              setError("");
            }}
            disabled={disabled}
          />
        </label>
      </div>
      <p className="small muted">
        {t(
          "Positive offset moves the video later than the local recording. Adjust it after checking the first sample.",
          "正偏移会让视频相对本地录音延后。请先检查第一个样本，再调整偏移。",
        )}
      </p>
      {range && (
        <p className="small muted">
          {t("Current audio sample", "当前音频样本")} {Math.floor(range.start)}s–{Math.ceil(range.end)}s
        </p>
      )}
      {error && <p className="notice danger" role="alert">{error}</p>}
      <div className="reference-video-actions">
        <button
          type="button"
          className="button secondary compact"
          onClick={() => void saveDraft()}
          disabled={disabled || !isDraftDifferent}
        >
          <Save size={15} /> {t("Save reference", "保存参考")}
        </button>
        <button
          type="button"
          className="button primary compact"
          onClick={() => void watchSample()}
          disabled={disabled || !draftId}
        >
          <Eye size={15} /> {t("Watch this sample", "观看此样本")}
        </button>
        {external && (
          <a
            className="text-button"
            href={external}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={14} /> {t("Open on YouTube", "在 YouTube 打开")}
          </a>
        )}
      </div>

    </section>
  );
}
