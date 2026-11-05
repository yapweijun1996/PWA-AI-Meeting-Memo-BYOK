import { useEffect, useState } from "react";
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
  getSelection,
  getSettingsRevision,
  getSettingsStorageError,
  saveSettings,
  setSettingsDirty,
  defaultModel,
  type Provider,
  type Stage,
} from "../providers/credentials";
export function Settings() {
  const [openai, setOpenai] = useState(getKey("openai")),
    [openrouter, setOpenrouter] = useState(getKey("openrouter")),
    [speech, setSpeech] = useState(getSelection("speech")),
    [memo, setMemo] = useState(getSelection("memo")),
    [speechRate, setSpeechRate] = useState(
      () => getSpeechRate()?.toString() ?? "",
    ),
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
      }),
    ),
    [usage, setUsage] = useState("Calculating…");
  const formDirty =
    JSON.stringify({
      keys: { openai, openrouter },
      speech,
      memo,
      speechRate,
    }) !== baseline;
  useEffect(() => {
    setSettingsDirty(formDirty);
    return () => setSettingsDirty(false);
  }, [formDirty]);
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
        throw new Error("Choose a model ID for transcription and notes.");
      await saveSettings(
        {
          keys: { openai: openai.trim(), openrouter: openrouter.trim() },
          speech: { ...speech, model: speech.model.trim() },
          memo: { ...memo, model: memo.model.trim() },
          speechRate: speechRate === "" ? null : Number(speechRate),
        },
        revision,
      );
      setRevision(getSettingsRevision());
      setBaseline(
        JSON.stringify({
          keys: { openai: openai.trim(), openrouter: openrouter.trim() },
          speech: { ...speech, model: speech.model.trim() },
          memo: { ...memo, model: memo.model.trim() },
          speechRate,
        }),
      );
      setOpenai(openai.trim());
      setOpenrouter(openrouter.trim());
      setSpeech({ ...speech, model: speech.model.trim() });
      setMemo({ ...memo, model: memo.model.trim() });
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
        },
        revision,
      );
      setRevision(getSettingsRevision());
      setBaseline(
        JSON.stringify({
          keys: { openai: "", openrouter: "" },
          speech: getSelection("speech"),
          memo: getSelection("memo"),
          speechRate: getSpeechRate()?.toString() ?? "",
        }),
      );
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
          <div className="eyebrow">YOUR WORKSPACE, YOUR CHOICE</div>
          <h1>
            Settings<span className="heading-dot">.</span>
          </h1>
          <p>Connect your own keys. Keep control of your conversations.</p>
        </div>
      </section>
      <section className="settings-panel">
        <div className="panel-title">
          <span className="round-icon">
            <KeyRound size={22} />
          </span>
          <div>
            <h2>Your API connections</h2>
            <p>
              Choose a provider and model for each step. Save settings to keep
              them on this device.
            </p>
          </div>
        </div>
        <div className="notice">
          <LockKeyhole size={18} />
          <span>
            Keys are stored unencrypted in this browser's IndexedDB. Other
            scripts on this shared website origin and anyone with access to this
            browser profile may be able to read them. Keys are not included in
            meeting backups or sent to GitHub.
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="connection">
            <div className="connection-heading">
              <span className="provider-icon">R</span>
              <div>
                <h3>OpenRouter (optional)</h3>
                <p>Access multiple transcription and language models</p>
              </div>
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noreferrer"
                aria-label="Open OpenRouter API keys"
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <label>
              OpenRouter API key
              <input
                type="password"
                maxLength={4096}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                value={openrouter}
                onChange={(e) => setOpenrouter(e.target.value)}
                placeholder="Enter your OpenRouter key"
                aria-label="OpenRouter API key"
              />
            </label>
          </div>
          <div className="connection">
            <div className="connection-heading">
              <span className="provider-icon mint">O</span>
              <div>
                <h3>OpenAI</h3>
                <p>Default provider for transcription and meeting notes</p>
              </div>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                aria-label="Open OpenAI API keys"
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <label>
              OpenAI API key
              <input
                type="password"
                maxLength={4096}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                value={openai}
                onChange={(e) => setOpenai(e.target.value)}
                placeholder="Enter your OpenAI key"
                aria-label="OpenAI API key"
              />
            </label>
          </div>
          {(["speech", "memo"] as Stage[]).map((stage) => {
            const choice = stage === "speech" ? speech : memo;
            const update = stage === "speech" ? setSpeech : setMemo;
            const label = stage === "speech" ? "Transcription" : "Memo";
            return (
              <div className="connection" key={stage}>
                <h3>{label} model</h3>
                <label>
                  {label} provider
                  <select
                    aria-label={`${label} provider`}
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
                  {label} model ID
                  <input
                    aria-label={`${label} model ID`}
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
                    ? "OpenAI gpt-transcribe returns text without speaker labels or timestamps. OpenRouter Scribe v2 requests speaker labels and timestamps; other models may return text only. OpenAI diarize is scheduled to shut down 2027-02-26."
                    : "Enter a model ID that supports structured JSON output. Model availability and pricing depend on your provider account."}
                </p>
              </div>
            );
          })}
          <div className="connection">
            <h3>Cost estimates</h3>
            <p className="muted">
              Optionally enter the selected speech model rate from your plan.
              Estimates are not a billing cap.
            </p>
            <label>
              Speech rate · USD per minute
              <input
                type="number"
                disabled={saving}
                step="0.0001"
                min="0"
                max="10"
                value={speechRate}
                placeholder="Unknown"
                onChange={(e) => setSpeechRate(e.target.value)}
              />
            </label>
          </div>
          {saveError && (
            <div className="notice danger" role="alert">
              {saveError}
            </div>
          )}
          <div className="settings-actions">
            <button type="submit" className="button primary" disabled={saving}>
              {saved && !formDirty ? (
                <Check size={16} />
              ) : (
                <KeyRound size={16} />
              )}{" "}
              {saved && !formDirty ? "Saved on this device" : "Save settings"}
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => void forget()}
              disabled={saving}
            >
              <Trash2 size={16} />
              Forget keys
            </button>
          </div>
          <p className="small muted">
            Saving settings does not test keys or incur a charge. Cloud requests
            are made only after you confirm a meeting operation.
          </p>
        </form>
      </section>
      <div className="settings-grid">
        <section className="settings-panel">
          <div className="panel-title">
            <HardDrive size={20} />
            <h2>Local storage</h2>
          </div>
          <p>{usage}</p>
          <p className="muted">
            Meetings are saved in this browser, on this device. Clearing site
            data removes them. A different device or hostname has a separate
            library.
          </p>
          <button className="button secondary" onClick={() => void persist()}>
            Request persistent storage
          </button>
        </section>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <section className="settings-panel">
        <h2>About this workspace</h2>
        <p className="muted">
          Browser-first, offline review, and bring-your-own keys. Cloud
          processing needs a connection and an open page. Supported uploads are
          stored up to 50 MiB; cloud uploads are limited to 25 MB. Longer
          recordings may need an externally prepared transcript. Live provider
          quality and physical-phone validation are tracked separately.
        </p>
        <a
          className="text-button"
          href="https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK"
          target="_blank"
          rel="noreferrer"
        >
          Source & verification notes
          <ExternalLink size={15} />
        </a>
        <p className="small muted">Build {__BUILD_ID__}</p>
      </section>
    </>
  );
}
