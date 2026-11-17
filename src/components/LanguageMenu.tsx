import { Languages } from "lucide-react";
import type { UiLanguage } from "../i18n";
import { uiLanguageOptions } from "../ui-language-options";
import { ChoiceMenu } from "./ChoiceMenu";
import { Icon } from "./Icon";

export function LanguageMenu({
  language,
  label,
  saving,
  onChange,
}: {
  language: string;
  label: string;
  saving: boolean;
  onChange: (language: UiLanguage) => void;
}) {
  return (
    <ChoiceMenu
      className="topbar-language"
      label={label}
      value={language === "zh-CN" || language === "ms" ? language : "en"}
      options={uiLanguageOptions}
      busy={saving}
      onChange={onChange}
      icon={<Icon glyph={Languages} size="transport" />}
    />
  );
}
