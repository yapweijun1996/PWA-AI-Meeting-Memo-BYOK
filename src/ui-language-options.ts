import type { UiLanguage } from "./i18n";

/** Shared display-language inventory; Malay keeps an explicit English fallback. */
export const uiLanguageOptions: readonly {
  value: UiLanguage;
  label: string;
  nativeLabel: string;
  description?: string;
}[] = [
  { value: "en", label: "English", nativeLabel: "English" },
  { value: "zh-CN", label: "简体中文", nativeLabel: "简体中文" },
  {
    value: "ms",
    label: "Bahasa Melayu",
    nativeLabel: "Bahasa Melayu (partial)",
    description: "Partial translation · English fallback",
  },
];
