import { useState } from "react";
import { Button } from "../../components/controls";
import { translateUi, type UiLanguage } from "../../i18n";
import { uiLanguageOptions } from "../../ui-language-options";
import { translateMessage } from "../../ui-messages";
import {
  saveFont,
  useFontChoice,
  saveFontSize,
  useFontSize,
  saveTheme,
  useThemeChoice,
  savePalette,
  usePaletteChoice,
  paletteOptions,
  type FontChoice,
  type FontSize,
  type ThemeChoice,
  type PaletteChoice,
} from "../../appearance";
import "./AppearanceSettings.css";

/** Appearance owns local-only preferences; the parent retains unsaved language/API drafts. */
export function AppearanceSettings({
  language,
  draftLanguage,
  languageDirty,
  saving,
  saveError,
  onLanguageChange,
}: {
  language: UiLanguage;
  draftLanguage: UiLanguage;
  languageDirty: boolean;
  saving: boolean;
  saveError: string;
  onLanguageChange: (language: UiLanguage) => void;
}) {
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const font = useFontChoice();
  const fontSize = useFontSize();
  const theme = useThemeChoice();
  const palette = usePaletteChoice();
  const [themeError, setThemeError] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [fontError, setFontError] = useState(false);
  const [fontSaved, setFontSaved] = useState(false);
  function changeFont(value: FontChoice) {
    try {
      saveFont(value);
      setFontError(false);
      setFontSaved(true);
    } catch {
      setFontError(true);
      setFontSaved(false);
    }
  }
  return (
    <>
      <h2>{t("Appearance", "外观")}</h2>
      <p className="muted">
        {t(
          "Choose how the workspace looks on this device.",
          "选择此设备上的工作区外观。",
        )}
      </p>
      <div className="appearance-layout">
        <div className="appearance-controls">
          <section
            className="appearance-section"
            aria-labelledby="appearance-language-heading"
          >
            <div className="appearance-section-heading">
              <h3 id="appearance-language-heading">{t("Language", "语言")}</h3>
              <span className="appearance-save-hint">
                {t("Save required", "需要保存")}
              </span>
            </div>
            <label>
              Display language / 显示语言
              <select
                aria-label="Display language / 显示语言"
                value={draftLanguage}
                onChange={(event) =>
                  onLanguageChange(event.target.value as UiLanguage)
                }
                disabled={saving}
              >
                {uiLanguageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.nativeLabel}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted">
              {t(
                "Save settings to keep your language choice.",
                "请保存设置以保留语言选择。",
              )}
            </p>
            {languageDirty && (
              <div className="appearance-language-save">
                <p role="status">
                  {t(
                    "Language change is not saved. Saving also saves any API and model drafts.",
                    "语言更改尚未保存。保存时也会保存 API 和模型草稿。",
                  )}
                </p>
                <Button
                  type="submit"
                  className="button primary compact"
                  disabled={saving}
                >
                  {t("Save all settings", "保存所有设置")}
                </Button>
              </div>
            )}
            {languageDirty && saveError && (
              <div className="notice danger" role="alert">
                {translateMessage(saveError, language)}
              </div>
            )}
          </section>
          <section
            className="appearance-section"
            aria-labelledby="appearance-interface-heading"
          >
            <div className="appearance-section-heading">
              <h3 id="appearance-interface-heading">
                {t("Interface appearance", "界面外观")}
              </h3>
              <span className="appearance-save-hint">
                {t("Saved immediately", "即时保存")}
              </span>
            </div>
            <p className="small muted">
              {t(
                "Theme and palette changes save immediately on this device.",
                "主题和配色更改会立即保存在此设备。",
              )}
            </p>
            <div className="appearance-fields">
              <label>
                {t("Theme", "\u4e3b\u9898")}
                <select
                  aria-label={t("Theme", "\u4e3b\u9898")}
                  value={theme}
                  onChange={(event) => {
                    try {
                      saveTheme(event.target.value as ThemeChoice);
                      setThemeError(false);
                    } catch {
                      setThemeError(true);
                    }
                  }}
                >
                  <option value="light">{t("Light", "\u6d45\u8272")}</option>
                  <option value="dark">{t("Dark", "\u6df1\u8272")}</option>
                </select>
              </label>
              <label>
                {t("Color palette", "\u914d\u8272")}
                <select
                  aria-label={t("Color palette", "\u914d\u8272")}
                  value={palette}
                  onChange={(event) => {
                    try {
                      savePalette(event.target.value as PaletteChoice);
                      setThemeError(false);
                    } catch {
                      setThemeError(true);
                    }
                  }}
                >
                  {Object.entries(paletteOptions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label.en, label.zh)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {themeError && (
              <p className="notice danger" role="alert">
                {t(
                  "Could not save the theme on this device.",
                  "\u65e0\u6cd5\u5728\u6b64\u8bbe\u5907\u4fdd\u5b58\u4e3b\u9898\u3002",
                )}
              </p>
            )}
          </section>
          <section
            className="appearance-section"
            aria-labelledby="appearance-text-heading"
          >
            <div className="appearance-section-heading">
              <h3 id="appearance-text-heading">
                {t("Text and preview", "文字与预览")}
              </h3>
              <span className="appearance-save-hint">
                {t("Saved immediately", "即时保存")}
              </span>
            </div>
            <div className="appearance-fields">
              <label>
                {t("Font family", "字体")}
                <select
                  aria-label={t("Font family", "字体")}
                  value={font}
                  onChange={(event) =>
                    changeFont(event.target.value as FontChoice)
                  }
                >
                  <option value="default">
                    {t("Current default", "当前默认")}
                  </option>
                  <option value="system">
                    {t("System sans-serif", "系统无衬线")}
                  </option>
                  <option value="segoe">Segoe UI</option>
                  <option value="georgia">Georgia</option>
                  <option value="arial">Arial</option>
                  <option value="verdana">Verdana</option>
                  <option value="tahoma">Tahoma</option>
                  <option value="trebuchet">Trebuchet MS</option>
                  <option value="times">Times New Roman</option>
                  <option value="courier">Courier New</option>
                </select>
              </label>
              <label>
                {t("Font size", "\u5b57\u53f7")}
                <select
                  aria-label={t("Font size", "\u5b57\u53f7")}
                  value={fontSize}
                  onChange={(event) => {
                    try {
                      saveFontSize(event.target.value as FontSize);
                      setSizeError(false);
                    } catch {
                      setSizeError(true);
                    }
                  }}
                >
                  <option value="small">{t("Small", "\u5c0f")}</option>
                  <option value="normal">{t("Normal", "\u6807\u51c6")}</option>
                  <option value="large">{t("Large", "\u5927")}</option>
                  <option value="xlarge">
                    {t("Extra large", "\u7279\u5927")}
                  </option>
                  <option value="xxlarge">
                    {t("Largest", "\u6700\u5927")}
                  </option>
                </select>
              </label>
            </div>
            {sizeError && (
              <p className="notice danger" role="alert">
                {t(
                  "Could not save the font size on this device.",
                  "\u65e0\u6cd5\u5728\u6b64\u8bbe\u5907\u4fdd\u5b58\u5b57\u53f7\u3002",
                )}
              </p>
            )}
            <p className="small muted">
              {t(
                "Font and size changes save immediately on this device. Unavailable fonts use a system fallback.",
                "字体和字号更改会立即保存在此设备。不可用的字体将使用系统替代字体。",
              )}
            </p>
            {fontError && (
              <p className="notice danger" role="alert">
                {t(
                  "Could not save the font on this device. The previous font is still in use.",
                  "无法在此设备保存字体，仍使用之前的字体。",
                )}
              </p>
            )}
            {fontSaved && !fontError && (
              <p role="status" className="small muted">
                {t("Font saved on this device", "字体已保存在此设备")}
              </p>
            )}

            <Button
              type="button"
              className="button secondary"
              onClick={() => changeFont("default")}
            >
              {t("Restore default font", "恢复默认字体")}
            </Button>
          </section>
        </div>
        <aside className="appearance-preview-column">
          <div
            className="font-preview"
            role="region"
            aria-label={t("Appearance preview", "外观预览")}
          >
            <span className="font-preview-label">
              {t("Appearance preview", "外观预览")}
            </span>
            <strong>
              {t("A clearer meeting workspace", "更清晰的会议工作区")}
            </strong>
            <p>Meeting notes · 1234567890 · 会议记录与说话人</p>
            <p className="small muted">
              {t(
                "Review decisions, sources and next steps.",
                "审阅决定、来源和下一步。",
              )}
            </p>
            <div className="appearance-preview-samples">
              <span className="appearance-preview-action">
                {t("Example button", "示例按钮")}
              </span>
              <span className="pill green">{t("Ready", "已就绪")}</span>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
