import { Button, Field, Tabs, Tab } from "../components/controls";
import { Masonry } from "../components/Masonry";
import { Icon } from "../components/Icon";
import type { MemoLanguagePreference } from "../domain/memo-language";
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
  getMemoLanguagePreference,
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
import { StorageMonitor } from "./StorageMonitor";
import { AppearanceSettings } from "./settings/AppearanceSettings";
export function Settings() {
  const [activeTab, setActiveTab] = useState<"api" | "appearance" | "storage" | "about">("api");
  const [displayLanguage, setDisplayLanguage] = useState(getUiLanguage());
  const observedLanguage = useRef(getUiLanguage());
  const [openai, setOpenai] = useState(getKey("openai")),
    [openrouter, setOpenrouter] = useState(getKey("openrouter")),
    [speech, setSpeech] = useState(getSelection("speech")),
    [memo, setMemo] = useState(getSelection("memo")),
    [memoLanguage, setMemoLanguage] = useState(getMemoLanguagePreference()),
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
        memoLanguage: getMemoLanguagePreference(),
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
      memoLanguage,
      speechRate,
      rateSource,
      rateDate,
      rateFor,
      uiLanguage,
    }) !== baseline;
  const languageDirty = uiLanguage !== (JSON.parse(baseline) as { uiLanguage: string }).uiLanguage;
  const t = (en: string, zh: string) => translateUi(displayLanguage, en, zh);
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
          memoLanguage,
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
          memoLanguage,
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
          memoLanguage: getMemoLanguagePreference(),
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
      <Tabs className="settings-tabs" label={t("Settings sections", "设置分类")} onValueChange={name => {
        if (name !== "appearance" && name !== "api" && name !== "storage" && name !== "about") return false;
        setActiveTab(name);
      }}>
        {(["appearance", "api", "storage", "about"] as const).map(name => <Tab key={name} id={`settings-tab-${name}`} value={name}
          selected={activeTab === name} aria-controls={`settings-panel-${name}`}>
          {name === "appearance" ? t("Appearance", "外观") : name === "api" ? t("API & models", "API 与模型") : name === "storage" ? t("Storage", "存储") : t("About", "关于")}
        </Tab>)}
      </Tabs>
      {formDirty && <p className="settings-dirty" role="status">{t("Unsaved settings", "设置尚未保存")}</p>}
      <section className={`settings-panel ${activeTab === "appearance" ? "settings-appearance-panel" : ""}`} hidden={activeTab === "storage" || activeTab === "about"}>
        <form onInvalid={(event) => {
          if (activeTab === "appearance") {
            event.preventDefault();
            const target = event.target as HTMLElement;
            setActiveTab("api");
            setTimeout(() => target.focus(), 0);
          }
        }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={activeTab !== "appearance"}>
          <AppearanceSettings language={displayLanguage} draftLanguage={uiLanguage} languageDirty={languageDirty} saving={saving} saveError={saveError}
            onLanguageChange={next => { setUiLanguage(next); setDisplayLanguage(next); }} />
        </div>
        <div id="settings-panel-api" role="tabpanel" aria-labelledby="settings-tab-api" hidden={activeTab !== "api"}>
        <div className="panel-title">
          <span className="round-icon">
            <Icon glyph={KeyRound} size="heading" />
          </span>
          <div>
            <h2>{t("Your API connections", "您的 API 连接")}</h2>
            <p>
              {t("Choose a provider and model for each step. Save settings to keep them on this device.", "为每个步骤选择服务商和模型。保存设置后会保留在此设备。")}
            </p>
          </div>
        </div>
        <div className="notice">
          <Icon glyph={LockKeyhole} size="control" />
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
                <Icon glyph={ExternalLink} size="inline" />
              </a>
            </div>
            <Field label={t("OpenRouter API key", "OpenRouter API 密钥")}>
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
            </Field>
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
                <Icon glyph={ExternalLink} size="inline" />
              </a>
            </div>
            <Field label={t("OpenAI API key", "OpenAI API 密钥")}>
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
            </Field>
          </div>
          <div className="connection">
            <h3>{t("Recommended preset", "推荐预设")}</h3>
            <p>{t("OpenRouter Scribe v2 for transcription and OpenAI GPT-6 Luna for notes. Each provider needs its own key. Model access is not guaranteed.", "使用 OpenRouter Scribe v2 转录，OpenAI GPT-6 Luna 生成笔记。两个服务各需一个密钥，不能保证模型可用。")}</p>
            <Button type="button" className="button secondary" disabled={saving} onClick={() => {
              setSpeech({ provider: "openrouter", model: defaultModel("openrouter", "speech") });
              setMemo({ provider: "openai", model: defaultModel("openai", "memo") });
            }}>{t("Use recommended preset", "使用推荐预设")}</Button>
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
                {stage === "memo" && <label>
                  {t("Memo output language", "纪要输出语言")}
                  <select aria-label={t("Memo output language", "纪要输出语言")} value={memoLanguage} disabled={saving}
                    onChange={(event) => setMemoLanguage(event.target.value as MemoLanguagePreference)}>
                    <option value="interface">{t("Follow interface language", "跟随界面语言")}</option>
                    <option value="meeting">{t("Meeting language", "会议语言")}</option>
                    <option value="en">English</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="ms">Bahasa Melayu</option>
                  </select>
                  <span className="small muted">{t("Applies to new generations. Saved plans retain their confirmed language; existing notes and transcript text stay unchanged.", "用于新生成。已保存计划保留确认时的语言；现有笔记和转录文本保持不变。")}</span>
                </label>}
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
            <Button type="button" className="button secondary" disabled={saving} onClick={() => setRateFor({ ...speech, model: speech.model.trim() })}>{t("Bind rate to selected speech model", "绑定费率到所选语音模型")}</Button>
            <Button type="button" className="button ghost" disabled={saving} onClick={() => { setRateSource(""); setRateDate(""); setRateFor(null); }}>{t("Clear rate provenance", "清除费率来源")}</Button>
          </div>
        </div>
          {saveError && !(activeTab === "appearance" && languageDirty) && (
            <div className="notice danger" role="alert">
              {translateMessage(saveError, displayLanguage)}
            </div>
          )}
          <div className="settings-actions">
            <Button type="submit" className="button primary" disabled={saving}>
              {saved && !formDirty ? (
                <Icon glyph={Check} size="inline" />
              ) : (
                <Icon glyph={KeyRound} size="inline" />
              )}{" "}
              {saved && !formDirty ? t("Saved on this device", "已保存在此设备") : t("Save settings", "保存设置")}
            </Button>
            <Button
              type="button"
              className="button ghost"
              hidden={activeTab !== "api"}
              onClick={() => void forget()}
              disabled={saving}
            >
              <Icon glyph={Trash2} size="inline" />
              {t("Forget keys", "清除密钥")}
            </Button>
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
      <div id="settings-panel-storage" role="tabpanel" aria-labelledby="settings-tab-storage" hidden={activeTab !== "storage"}>
      <Masonry className="settings-grid">
        <section className="settings-panel">
          <div className="panel-title">
            <Icon glyph={HardDrive} size="transport" />
            <h2>{t("Local storage", "本地存储")}</h2>
          </div>
          <p>{translateMessage(usage, displayLanguage)}</p>
          <p className="muted">
            {t("Meetings are saved in this browser, on this device. Clearing site data removes them. A different device or hostname has a separate library.", "会议保存在此设备的浏览器中。清除网站数据会删除这些会议。其他设备或域名使用独立的会议库。")}
          </p>
          <Button className="button secondary" onClick={() => void persist()}>
            {t("Request persistent storage", "请求持久化存储")}
          </Button>
        </section>
        <StorageMonitor t={t} />
        <SpeakerModelSettings t={t} />
      </Masonry>
      </div>
      <div id="settings-panel-about" role="tabpanel" aria-labelledby="settings-tab-about" hidden={activeTab !== "about"}>
        <section className="settings-panel">
          <h2>{t("About this workspace", "关于此工作空间")}</h2>
          <p className="muted">
            {t("Browser-first, offline review, and bring-your-own keys. Recordings larger than 24,000,000 bytes can be imported as local parts for supported MP3/MPEG and M4A/MP4 formats, up to 4 GiB. Larger files in other formats require conversion. Actual support depends on the device, browser, format and available storage. Each cloud transcription upload is limited to 25 MB; processing requires a connection and an open page. Live provider quality and physical-phone validation remain open.", "浏览器优先，支持离线审阅并使用自己的密钥。超过 24,000,000 字节的录音，支持的 MP3/MPEG 或 M4A/MP4 格式可在本地分块导入，最大 4 GiB；其他格式的大文件需要转换。实际支持范围受设备、浏览器、格式和可用存储影响。每次云端转录上传上限为 25 MB，处理时需要网络并保持页面打开。真实服务商质量和实体手机验证仍待完成。")}
          </p>
          <a
            className="text-button"
            href="https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK"
            target="_blank"
            rel="noreferrer"
          >
            {t("Source & verification notes", "源代码与验证记录")}
            <Icon glyph={ExternalLink} size="compact" />
          </a>
          <p className="small muted">{t("Build", "构建版本")} {__BUILD_ID__}</p>
        </section>
      </div>
    </>
  );
}
