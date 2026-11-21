import { Moon, Sun } from "lucide-react";
import { toggleTheme, useThemeChoice } from "../appearance";
import { translateUi, type UiLanguage } from "../i18n";
import { IconButton } from "./controls";
import { Icon } from "./Icon";
import { showToast } from "./ToastLayer";

export function ThemeToggle({ language }: { language: UiLanguage }) {
  const toDark = useThemeChoice() === "light";
  const t = (en: string, zh: string, ms: string) =>
    language === "ms" ? ms : translateUi(language, en, zh);
  const label = toDark
    ? t("Switch to dark theme", "切换到深色主题", "Tukar kepada tema gelap")
    : t("Switch to light theme", "切换到浅色主题", "Tukar kepada tema cerah");
  return (
    <IconButton className="icon-button topbar-theme" label={label} title={label} onClick={() => {
      if (!toggleTheme()) showToast(t("Theme changed for this tab only.", "主题更改仅对当前标签页生效。", "Tema ditukar untuk tab ini sahaja."));
    }}>
      <Icon glyph={toDark ? Moon : Sun} size="transport" aria-hidden="true" />
    </IconButton>
  );
}
