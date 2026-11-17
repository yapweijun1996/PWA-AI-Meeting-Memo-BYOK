import type { ReactNode } from "react";
import { Pause, Plus } from "lucide-react";
import { Button, Field } from "../../components/controls";
import { Icon } from "../../components/Icon";

type Props = {
  mode: "playback" | "naming";
  canPlayback: boolean;
  locked: boolean;
  playing: boolean;
  windowSeconds: number;
  onWindowSecondsChange: (seconds: number) => void;
  onModeChange: (mode: "playback" | "naming") => void;
  onPause: () => void;
  onAdd: () => void;
  t: (english: string, chinese: string) => string;
  immersive?: ReactNode;
  children: ReactNode;
};

/** Presentation only: the review owner keeps draft, playback and mode guards. */
export function SpeakerReviewToolbar({ mode, canPlayback, locked, playing, windowSeconds, onWindowSecondsChange, onModeChange, onPause, onAdd, t, immersive, children }: Props) {
  return <div className="speaker-review-toolbar">
    <div className="speaker-review-context">{children}</div>
    <div className="speaker-review-controls">
      <div className="speaker-mode-switch" role="group" aria-label={t("Speaker review mode", "说话人审阅模式")}>
        <Button className={`button compact ${mode === "playback" ? "primary" : "secondary"}`} aria-pressed={mode === "playback"} disabled={!canPlayback} onClick={() => onModeChange("playback")}>{t("Playback mode", "播放模式")}</Button>
        <Button className={`button compact ${mode === "naming" ? "primary" : "secondary"}`} aria-pressed={mode === "naming"} onClick={() => onModeChange("naming")}>{t("Edit speakers", "编辑说话人")}</Button>
      </div>
      {immersive}
      {mode === "naming" && <div className="speaker-review-edit-actions">
        <Field className="speaker-sample-length small muted" label={t("Sample length", "样本长度")}>
          <select aria-label={t("Sample length", "样本长度")} value={windowSeconds} disabled={locked} onChange={event => onWindowSecondsChange(Number(event.target.value))}>
            <option value="10">10s</option><option value="20">20s</option><option value="30">30s</option>
          </select>
        </Field>
        {playing && <Button className="button secondary compact" onClick={onPause}><Icon glyph={Pause} size="small" />{t("Pause", "暂停")}</Button>}
        <Button className="button secondary compact" disabled={locked} onClick={onAdd}><Icon glyph={Plus} size="small" />{t("Add speaker", "添加说话人")}</Button>
      </div>}
    </div>
  </div>;
}
