import { translateUi } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Trash2,
  HardDrive,
} from "lucide-react";
import {
  getKey,
  getSpeechRate,
  getSpeechRateContext,
  getUiLanguage,
  setUiLanguageOverride,
  getSelection,
  getSettingsRevision,
  getSettingsStorageError,
  saveSettings,
  setSettingsDirty,
  defaultModel,
  type Provider,
  type Stage,
} from "../providers/credentials";
import { translateMessage } from "../ui-messages";
import { SpeakerModelSettings } from "./SpeakerModelSettings";
import { saveFont, useFontChoice, saveFontSize, useFontSize, saveTheme, useThemeChoice, savePalette, usePaletteChoice, type FontChoice, type FontSize, type ThemeChoice, type PaletteChoice } from "../appearance";
export function Settings() {
  const [activeTab, setActiveTab] = useState<"api" | "appearance">("api");
  const [displayLanguage, setDisplayLanguage] = useState(getUiLanguage());
  const observedLanguage = useRef(getUiLanguage());
  const font = useFontChoice();
  const fontSize = useFontSize();
  const theme = useThemeChoice();
  const palette = usePaletteChoice();
  const [themeError, setThemeError] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [fontError, setFontError] = useState(false);
  const [fontSaved, setFontSaved] = useState(false);
  const [openai, setOpenai] = useState(getKey("openai")),
    [openrouter, setOpenrouter] = useState(getKey("openrouter")),
    [speech, setSpeech] = useState(getSelection("speech")),
    [memo, setMemo] = useState(getSelection("memo")),
    [speechRate, setSpeechRate] = useState(
      () => getSpeechRate()?.toString() ?? "",
    ),
    [rateSource, setRateSource] = useState(() => getSpeechRateContext()?.source ?? ""),
    [rateDate, setRateDate] = useState(() => getSpeechRateContext()?.date ?? ""),
    [rateFor, setRateFor] = useState(() => {
      const context = getSpeechRateContext();
      return context ? { provider: context.provider, model: context.model } : null;
    }),
    [uiLanguage, setUiLanguage] = useState(getUiLanguage()),
    [revision, setRevision] = useState(getSettingsRevision()),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(getSettingsStorageError()),
    [saved, setSaved] = useState(false),
    [notice, setNotice] = useState(""),
    [baseline, setBaseline] = useState(() =>
      JSON.stringify({
        keys: { openai: getKey("openai"), openrouter: getKey("openrouter") },
        speech: getSelection("speech"),
        memo: getSelection("memo"),
        speechRate: getSpeechRate()?.toString() ?? "",
        rateSource: getSpeechRateContext()?.source ?? "",
        rateDate: getSpeechRateContext()?.date ?? "",
        rateFor: getSpeechRateContext() ? { provider: getSpeechRateContext()!.provider, model: getSpeechRateContext()!.model } : null,
        uiLanguage: getUiLanguage(),
      }),
    ),
    [usage, setUsage] = useState("Calculating…");
  const formDirty =
    JSON.stringify({
      keys: { openai, openrouter },
      speech,
      memo,
      speechRate,
      rateSource,
      rateDate,
      rateFor,
      uiLanguage,
    }) !== baseline;
  const languageDirty = uiLanguage !== (JSON.parse(baseline) as { uiLanguage: string }).uiLanguage;
  const t = (en: string, zh: string) => translateUi(displayLanguage, en, zh);
  function changeFont(value: FontChoice) {
    try { saveFont(value); setFontError(false); setFontSaved(true); }
    catch { setFontError(true); setFontSaved(false); }
  }
  function tabKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "appearance" : event.key === "End" ? "api" : activeTab === "api" ? "appearance" : "api";
    setActiveTab(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  }
  useEffect(() => {
    setSettingsDirty(formDirty);
    return () => setSettingsDirty(false);
  }, [formDirty]);
  useEffect(() => {
    const changed = () => {
      const next = getUiLanguage();
      if (next === observedLanguage.current) return;
      observedLanguage.current = next;
      setDisplayLanguage(next);
      if (languageDirty) return;
      setUiLanguage(next);
      setBaseline((previous) => JSON.stringify({ ...JSON.parse(previous), uiLanguage: next }));
    };
    window.addEventListener("memo-keys-changed", changed);
    return () => window.removeEventListener("memo-keys-changed", changed);
  }, [languageDirty]);
  useEffect(() => {
    void navigator.storage
      ?.estimate()
      .then((s) =>
        setUsage(
          `${((s.usage || 0) / 1024 / 1024).toFixed(1)} MB used · browser-managed storage`,
        ),
      )
      .catch(() => setUsage("Usage estimate is unavailable."));
  }, []);
  useEffect(() => {
    const changed = () => {
      const prior = JSON.parse(baseline) as {
        keys: { openai: string; openrouter: string };
      };
      if (!getKey("openai"))
        setOpenai((value) => (value === prior.keys.openai ? "" : value));
      if (!getKey("openrouter"))
        setOpenrouter((value) =>
          value === prior.keys.openrouter ? "" : value,
        );
      setSaveError(
        "Settings changed in another tab. Copy any unsaved changes, then reload before saving.",
      );
    };
    window.addEventListener("memo-settings-external", changed);
    return () => window.removeEventListener("memo-settings-external", changed);
  }, [baseline]);
  async function save() {
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      if (!speech.model.trim() || !memo.model.trim())
        throw new Error(t("Choose a model ID for transcription and notes.", "请选择转录和笔记模型。"));
      if (rateSource || rateDate || rateFor) {
        if (!rateSource.trim() || !rateDate || !rateFor || speechRate === "")
          throw new Error(t("Enter a rate, source, date and bind the rate to a model, or clear its source and date.", "请输入费率、来源和日期并绑定模型，或清除费率来源。"));
        let url: URL;
        try { url = new URL(rateSource.trim()); } catch { throw new Error(t("Enter a public HTTPS pricing URL without query parameters.", "请输入不含查询参数的公开 HTTPS 定价网址。")); }
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
          throw new Error(t("Enter a public HTTPS pricing URL without query parameters.", "请输入不含查询参数的公开 HTTPS 定价网址。"));
      }
      await saveSettings(
        {
          keys: { openai: openai.trim(), openrouter: openrouter.trim() },
          speech: { ...speech, model: speech.model.trim() },
          memo: { ...memo, model: memo.model.trim() },
          speechRate: speechRate === "" ? null : Number(speechRate),
          speechRateContext: rateFor && rateSource.trim() && rateDate ? { ...rateFor, source: rateSource.trim(), date: rateDate } : null,
          uiLanguage: uiLanguage === "ms" ? "en" : uiLanguage,
        },
        revision,
      );
      let savedLanguage = uiLanguage;
      try { setUiLanguageOverride(uiLanguage); }
      catch {
        savedLanguage = getUiLanguage();
        setUiLanguage(savedLanguage);
        setNotice("Settings were saved, but the language preference could not be saved on this device.");
      }
      setRevision(getSettingsRevision());
      setBaseline(
        JSON.stringify({
          keys: { openai: openai.trim(), openrouter: openrouter.trim() },
          speech: { ...speech, model: speech.model.trim() },
          memo: { ...memo, model: memo.model.trim() },
          speechRate,
          rateSource: rateSource.trim(),
          rateDate,
          rateFor,
          uiLanguage: savedLanguage,
        }),
      );
      setOpenai(openai.trim());
      setOpenrouter(openrouter.trim());
      setSpeech({ ...speech, model: speech.model.trim() });
      setMemo({ ...memo, model: memo.model.trim() });
      setRateSource(rateSource.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save settings on this device.",
      );
      window.dispatchEvent(new Event("memo-settings-save-failed"));
    } finally {
      setSaving(false);
    }
  }
  async function forget() {
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      await saveSettings(
        {
          keys: { openai: "", openrouter: "" },
          speech: getSelection("speech"),
          memo: getSelection("memo"),
          speechRate: getSpeechRate(),
          speechRateContext: getSpeechRateContext(),
          uiLanguage: getUiLanguage() === "ms" ? "en" : getUiLanguage() as "en" | "zh-CN",
        },
        revision,
      );
      setRevision(getSettingsRevision());
      setBaseline(JSON.stringify({ ...JSON.parse(baseline), keys: { openai: "", openrouter: "" } }));
      setOpenai("");
      setOpenrouter("");
      setNotice("Stored keys forgotten on this device.");
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not remove stored keys.",
      );
      window.dispatchEvent(new Event("memo-settings-save-failed"));
    } finally {
      setSaving(false);
    }
  }
  async function persist() {
    try {
      const result = await navigator.storage?.persist();
      setNotice(
        result
          ? "Persistent storage granted. Keep a separate backup too."
          : "Persistent storage was not granted. Export backups regularly.",
      );
    } catch {
      setNotice("This browser does not support a persistence request.");
    }
  }
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">{t("YOUR WORKSPACE, YOUR CHOICE", "您的工作空间，由您作主")}</div>
          <h1>
            {t("Settings", "设置")}<span className="heading-dot">.</span>
          </h1>
          <p>{t("Personalize your workspace and connect your own keys.", "个性化工作区并连接您自己的密钥。")}</p>
        </div>
      </section>
      <div className="settings-tabs" role="tablist" aria-label={t("Settings sections", "设置分类")}>
        {(["appearance", "api"] as const).map((name) => <button key={name} id={`settings-tab-${name}`} type="button" role="tab"
          aria-selected={activeTab === name} aria-controls={`settings-panel-${name}`} tabIndex={activeTab === name ? 0 : -1}
          onClick={() => setActiveTab(name)} onKeyDown={tabKey}>
          {name === "appearance" ? t("Appearance", "外观") : t("API & models", "API 与模型")}
        </button>)}
      </div>
      {formDirty && <p className="settings-dirty" role="status">{t("Unsaved settings", "设置尚未保存")}</p>}
      <section className="settings-panel">
        <form onInvalid={(event) => {
          if (activeTab === "appearance") {
            event.preventDefault();
            const target = event.target as HTMLElement;
            setActiveTab("api");
            setTimeout(() => target.focus(), 0);
          }
        }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={activeTab !== "appearance"}>
          <h2>{t("Appearance", "外观")}</h2>
          <p className="muted">{t("Choose how the workspace looks on this device.", "选择此设备上的工作区外观。")}</p>
          <section className="appearance-section" aria-labelledby="appearance-language-heading">
          <div className="appearance-section-heading"><h3 id="appearance-language-heading">{t("Language", "语言")}</h3><span className="appearance-save-hint">{t("Save required", "需要保存")}</span></div>
          <label>Display language / 显示语言<select aria-label="Display language / 显示语言" value={uiLanguage} onChange={(e) => { const next = e.target.value as "en" | "zh-CN" | "ms"; setUiLanguage(next); setDisplayLanguage(next); }} disabled={saving}><option value="en">English</option><option value="zh-CN">简体中文</option><option value="ms">Bahasa Melayu (partial)</option></select></label>
          <p className="small muted">{t("Save settings to keep your language choice.", "请保存设置以保留语言选择。")}</p>
          {languageDirty && <div className="appearance-language-save">
            <p role="status">{t("Language change is not saved. Saving also saves any API and model drafts.", "语言更改尚未保存。保存时也会保存 API 和模型草稿。")}</p>
            <button type="submit" className="button primary compact" disabled={saving}>{t("Save all settings", "保存所有设置")}</button>
          </div>}
          {languageDirty && saveError && <div className="notice danger" role="alert">{translateMessage(saveError, displayLanguage)}</div>}
          </section>
          <section className="appearance-section" aria-labelledby="appearance-interface-heading">
          <div className="appearance-section-heading"><h3 id="appearance-interface-heading">{t("Interface appearance", "界面外观")}</h3><span className="appearance-save-hint">{t("Saved immediately", "即时保存")}</span></div>
          <p className="small muted">{t("Theme and palette changes save immediately on this device.", "主题和配色更改会立即保存在此设备。")}</p>
          <div className="appearance-fields">
          <label>{t("Theme", "\u4e3b\u9898")}
            <select aria-label={t("Theme", "\u4e3b\u9898")} value={theme} onChange={(event) => { try { saveTheme(event.target.value as ThemeChoice); setThemeError(false); } catch { setThemeError(true); } }}><option value="light">{t("Light", "\u6d45\u8272")}</option><option value="dark">{t("Dark", "\u6df1\u8272")}</option></select>
          </label>
          <label>{t("Color palette", "\u914d\u8272")}
            <select aria-label={t("Color palette", "\u914d\u8272")} value={palette} onChange={(event) => { try { savePalette(event.target.value as PaletteChoice); setThemeError(false); } catch { setThemeError(true); } }}><option value="forest">{t("Forest", "\u68ee\u6797")}</option><option value="ocean">{t("Ocean", "\u6d77\u6d0b")}</option><option value="violet">{t("Violet", "\u7d2b\u7f57\u5170")}</option><option value="amber">{t("Amber", "\u7425\u73c0")}</option></select>
          </label>
          </div>
          {themeError && <p className="notice danger" role="alert">{t("Could not save the theme on this device.", "\u65e0\u6cd5\u5728\u6b64\u8bbe\u5907\u4fdd\u5b58\u4e3b\u9898\u3002")}</p>}
          </section>
          <section className="appearance-section" aria-labelledby="appearance-text-heading">
          <div className="appearance-section-heading"><h3 id="appearance-text-heading">{t("Text and preview", "文字与预览")}</h3><span className="appearance-save-hint">{t("Saved immediately", "即时保存")}</span></div>
          <div className="appearance-fields">
          <label>{t("Font family", "字体")}
            <select aria-label={t("Font family", "字体")} value={font} onChange={(event) => changeFont(event.target.value as FontChoice)}>
              <option value="default">{t("Current default", "当前默认")}</option>
              <option value="system">{t("System sans-serif", "系统无衬线")}</option>
              <option value="segoe">Segoe UI</option>
              <option value="georgia">Georgia</option>
              <option value="arial">Arial</option><option value="verdana">Verdana</option><option value="tahoma">Tahoma</option>
              <option value="trebuchet">Trebuchet MS</option><option value="times">Times New Roman</option><option value="courier">Courier New</option>
            </select>
          </label>
          <label>{t("Font size", "\u5b57\u53f7")}
            <select aria-label={t("Font size", "\u5b57\u53f7")} value={fontSize} onChange={(event) => { try { saveFontSize(event.target.value as FontSize); setSizeError(false); } catch { setSizeError(true); } }}>
              <option value="small">{t("Small", "\u5c0f")}</option><option value="normal">{t("Normal", "\u6807\u51c6")}</option><option value="large">{t("Large", "\u5927")}</option><option value="xlarge">{t("Extra large", "\u7279\u5927")}</option><option value="xxlarge">{t("Largest", "\u6700\u5927")}</option>
            </select>
          </label>
          </div>
          {sizeError && <p className="notice danger" role="alert">{t("Could not save the font size on this device.", "\u65e0\u6cd5\u5728\u6b64\u8bbe\u5907\u4fdd\u5b58\u5b57\u53f7\u3002")}</p>}
          <p className="small muted">{t("Font and size changes save immediately on this device. Unavailable fonts use a system fallback.", "字体和字号更改会立即保存在此设备。不可用的字体将使用系统替代字体。")}</p>
          {fontError && <p className="notice danger" role="alert">{t("Could not save the font on this device. The previous font is still in use.", "无法在此设备保存字体，仍使用之前的字体。")}</p>}
          {fontSaved && !fontError && <p role="status" className="small muted">{t("Font saved on this device", "字体已保存在此设备")}</p>}
          <div className="font-preview" role="region" aria-label={t("Appearance preview", "外观预览")}>
            <span className="font-preview-label">{t("Appearance preview", "外观预览")}</span>
            <strong>{t("A clearer meeting workspace", "更清晰的会议工作区")}</strong>
            <p>Meeting notes · 1234567890 · 会议记录与说话人</p>
            <p className="small muted">{t("Review decisions, sources and next steps.", "审阅决定、来源和下一步。")}</p>
            <div className="appearance-preview-samples"><span className="appearance-preview-action">{t("Example button", "示例按钮")}</span><span className="pill green">{t("Ready", "已就绪")}</span></div>
          </div>
          <button type="button" className="button secondary" onClick={() => changeFont("default")}>{t("Restore default font", "恢复默认字体")}</button>
          </section>
        </div>
        <div id="settings-panel-api" role="tabpanel" aria-labelledby="settings-tab-api" hidden={activeTab !== "api"}>
        <div className="panel-title">
          <span className="round-icon">
            <KeyRound size={22} />
          </span>
          <div>
            <h2>{t("Your API connections", "您的 API 连接")}</h2>
            <p>
              {t("Choose a provider and model for each step. Save settings to keep them on this device.", "为每个步骤选择服务商和模型。保存设置后会保留在此设备。")}
            </p>
          </div>
        </div>
        <div className="notice">
          <LockKeyhole size={18} />
          <span>
            {t("Keys are stored unencrypted in this browser's IndexedDB. Other scripts on this shared website origin and anyone with access to this browser profile may be able to read them. Keys are not included in meeting backups or sent to GitHub.", "密钥以未加密方式存储在此浏览器的 IndexedDB 中。同一网站来源的其他脚本及能访问此浏览器配置的人可能读取密钥。密钥不会包含在会议备份中，也不会发送到 GitHub。")}
          </span>
        </div>
          <div className="connection">
            <div className="connection-heading">
              <span className="provider-icon">R</span>
              <div>
                <h3>OpenRouter</h3>
                <p>{t("Access multiple transcription and language models", "访问多种转录和语言模型")}</p>
              </div>
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noreferrer"
                aria-label={t("Open OpenRouter API keys", "打开 OpenRouter API 密钥页面")}
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <label>
              {t("OpenRouter API key", "OpenRouter API 密钥")}
              <input
                type="password"
                maxLength={4096}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                value={openrouter}
                onChange={(e) => setOpenrouter(e.target.value)}
                placeholder={t("Enter your OpenRouter key", "输入 OpenRouter 密钥")}
                aria-label={t("OpenRouter API key", "OpenRouter API 密钥")}
              />
            </label>
          </div>
          <div className="connection">
            <div className="connection-heading">
              <span className="provider-icon mint">O</span>
              <div>
                <h3>OpenAI</h3>
                <p>{t("Provider for meeting notes and optional transcription", "提供会议笔记，也可用于转录")}</p>
              </div>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                aria-label={t("Open OpenAI API keys", "打开 OpenAI API 密钥页面")}
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <label>
              {t("OpenAI API key", "OpenAI API 密钥")}
              <input
                type="password"
                maxLength={4096}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                value={openai}
                onChange={(e) => setOpenai(e.target.value)}
                placeholder={t("Enter your OpenAI key", "输入 OpenAI 密钥")}
                aria-label={t("OpenAI API key", "OpenAI API 密钥")}
              />
            </label>
          </div>
          <div className="connection">
            <h3>{t("Recommended preset", "推荐预设")}</h3>
            <p>{t("OpenRouter Scribe v2 for transcription and OpenAI GPT-6 Luna for notes. Each provider needs its own key. Model access is not guaranteed.", "使用 OpenRouter Scribe v2 转录，OpenAI GPT-6 Luna 生成笔记。两个服务各需一个密钥，不能保证模型可用。")}</p>
            <button type="button" className="button secondary" disabled={saving} onClick={() => {
              setSpeech({ provider: "openrouter", model: defaultModel("openrouter", "speech") });
              setMemo({ provider: "openai", model: defaultModel("openai", "memo") });
            }}>{t("Use recommended preset", "使用推荐预设")}</button>
            <p className="small muted">{t("Selecting the preset does not validate keys or send a request. Save settings to keep it.", "选择预设不会验证密钥或发送请求。请保存设置。")}</p>
          </div>
          {(["speech", "memo"] as Stage[]).map((stage) => {
            const choice = stage === "speech" ? speech : memo;
            const update = stage === "speech" ? setSpeech : setMemo;
            const label = stage === "speech" ? t("Transcription", "转录") : t("Memo", "笔记");
            return (
              <div className="connection" key={stage}>
                <h3>{label} {t("model", "模型")}</h3>
                <label>
                  {label} {t("provider", "服务商")}
                  <select
                    aria-label={`${label} ${t("provider", "服务商")}`}
                    disabled={saving}
                    value={choice.provider}
                    onChange={(e) => {
                      const provider = e.target.value as Provider;
                      update({
                        provider,
                        model: defaultModel(provider, stage),
                      });
                    }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter</option>
                  </select>
                </label>
                <label>
                  {label} {t("model ID", "模型 ID")}
                  <input
                    aria-label={`${label} ${t("model ID", "模型 ID")}`}
                    disabled={saving}
                    list={`${stage}-models`}
                    value={choice.model}
                    maxLength={100}
                    required
                    onChange={(e) =>
                      update({ ...choice, model: e.target.value })
                    }
                  />
                </label>
                <datalist id={`${stage}-models`}>
                  <option value={defaultModel(choice.provider, stage)} />
                  {stage === "memo" && (
                    <option
                      value={
                        choice.provider === "openai"
                          ? "gpt-6.1-sol"
                          : "openai/gpt-6.1-sol"
                      }
                    />
                  )}
                  {stage === "speech" && choice.provider === "openai" && (
                    <option value="gpt-4o-transcribe-diarize" />
                  )}
                  {stage === "speech" && choice.provider === "openrouter" && (
                    <option value="openai/whisper-large-v3" />
                  )}
                </datalist>
                <p className="small muted">
                  {stage === "speech"
                    ? t("OpenAI gpt-transcribe returns text without speaker labels or timestamps. OpenRouter Scribe v2 requests speaker labels and timestamps; other models may return text only. OpenAI diarize is scheduled to shut down 2027-02-26.", "OpenAI gpt-transcribe 返回不含说话人标签或时间戳的文本。OpenRouter Scribe v2 会请求说话人标签和时间戳；其他模型可能仅返回文本。OpenAI diarize 计划于 2027-02-26 停用。")
                    : t("Enter a model ID that supports structured JSON output. Model availability and pricing depend on your provider account.", "请输入支持结构化 JSON 输出的模型 ID。模型可用性和价格取决于您的服务商账户。")}
                </p>
              </div>
            );
          })}
          <div className="connection">
            <h3>{t("Cost estimates", "费用估算")}</h3>
            <p className="muted">
              {t("Enter a rate, its pricing page and the date checked, then bind it to the selected speech model. Estimates are not a billing cap.", "输入费率、定价页面和核对日期，然后绑定所选语音模型。估算不是费用上限。")}
            </p>
            <label>
              {t("Speech rate · USD per minute", "语音费率 · 美元／分钟")}
              <input
                type="number"
                disabled={saving}
                step="0.0001"
                min="0"
                max="10"
                value={speechRate}
                placeholder={t("Unknown", "未知")}
                onChange={(e) => setSpeechRate(e.target.value)}
              />
            </label>
            <label>{t("Pricing source URL", "定价来源网址")}<input type="url" maxLength={300} value={rateSource} disabled={saving} onChange={(e) => setRateSource(e.target.value)} placeholder="https://example.com/pricing" /></label>
            <label>{t("Date checked", "核对日期")}<input type="date" value={rateDate} disabled={saving} onChange={(e) => setRateDate(e.target.value)} /></label>
            <p className="small muted">{rateFor ? `${t("Rate applies to", "费率适用模型")} ${rateFor.provider} / ${rateFor.model}` : t("Rate is not bound to a model.", "费率尚未绑定模型。")}</p>
            <button type="button" className="button secondary" disabled={saving} onClick={() => setRateFor({ ...speech, model: speech.model.trim() })}>{t("Bind rate to selected speech model", "绑定费率到所选语音模型")}</button>
            <button type="button" className="button ghost" disabled={saving} onClick={() => { setRateSource(""); setRateDate(""); setRateFor(null); }}>{t("Clear rate provenance", "清除费率来源")}</button>
          </div>
        </div>
          {saveError && !(activeTab === "appearance" && languageDirty) && (
            <div className="notice danger" role="alert">
              {translateMessage(saveError, displayLanguage)}
            </div>
          )}
          <div className="settings-actions">
            <button type="submit" className="button primary" disabled={saving}>
              {saved && !formDirty ? (
                <Check size={16} />
              ) : (
                <KeyRound size={16} />
              )}{" "}
              {saved && !formDirty ? t("Saved on this device", "已保存在此设备") : t("Save settings", "保存设置")}
            </button>
            <button
              type="button"
              className="button ghost"
              hidden={activeTab !== "api"}
              onClick={() => void forget()}
              disabled={saving}
            >
              <Trash2 size={16} />
              {t("Forget keys", "清除密钥")}
            </button>
          </div>
          <p className="small muted">
            {t("Saving settings does not test keys or incur a charge. Cloud requests are made only after you confirm a meeting operation.", "保存设置不会测试密钥或产生费用。只有确认会议操作后才会发送云端请求。")}
          </p>
        </form>
      </section>
      {notice && (
        <div className="notice" role="status">
          {translateMessage(notice, displayLanguage)}
        </div>
      )}
      <div className="settings-grid">
        <section className="settings-panel">
          <div className="panel-title">
            <HardDrive size={20} />
            <h2>{t("Local storage", "本地存储")}</h2>
          </div>
          <p>{translateMessage(usage, displayLanguage)}</p>
          <p className="muted">
            {t("Meetings are saved in this browser, on this device. Clearing site data removes them. A different device or hostname has a separate library.", "会议保存在此设备的浏览器中。清除网站数据会删除这些会议。其他设备或域名使用独立的会议库。")}
          </p>
          <button className="button secondary" onClick={() => void persist()}>
            {t("Request persistent storage", "请求持久化存储")}
          </button>
        </section>
        <SpeakerModelSettings t={t} />
        <section className="settings-panel">
          <h2>{t("About this workspace", "关于此工作空间")}</h2>
          <p className="muted">
            {t("Browser-first, offline review, and bring-your-own keys. Cloud processing needs a connection and an open page. Supported uploads are stored up to 50 MiB; cloud uploads are limited to 25 MB. Longer recordings may need an externally prepared transcript. Live provider quality and physical-phone validation are tracked separately.", "浏览器优先，支持离线审阅并使用自己的密钥。云端处理需要网络并保持页面打开。本地录音上限为 50 MiB，云端上传上限为 25 MB。较长录音可能需要外部准备的转录。真实服务商质量与实体手机验证另行跟踪。")}
          </p>
          <a
            className="text-button"
            href="https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK"
            target="_blank"
            rel="noreferrer"
          >
            {t("Source & verification notes", "源代码与验证记录")}
            <ExternalLink size={15} />
          </a>
          <p className="small muted">{t("Build", "构建版本")} {__BUILD_ID__}</p>
        </section>
      </div>
    </>
  );
}
