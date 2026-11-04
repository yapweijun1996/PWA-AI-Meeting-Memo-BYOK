import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  HardDrive,
} from "lucide-react";
import {
  forgetKeys,
  getKey,
  setKey,
  getSpeechRate,
  setSpeechRate,
} from "../providers/credentials";
export function Settings() {
  const [openai, setOpenai] = useState(getKey("openai")),
    [deepgram, setDeepgram] = useState(getKey("deepgram")),
    [saved, setSaved] = useState(false),
    [notice, setNotice] = useState(""),
    [usage, setUsage] = useState("Calculating…");
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
            <p>Separate providers, separate keys. Only this page session.</p>
          </div>
        </div>
        <div className="notice">
          <LockKeyhole size={18} />
          <span>
            Keys stay in memory and are cleared on reload. They are never
            included in meeting backups or sent to GitHub. Page code can access
            keys while you use the app.
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setKey("openai", openai);
            setKey("deepgram", deepgram);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
          }}
        >
          <div className="connection">
            <div className="connection-heading">
              <span className="provider-icon">D</span>
              <div>
                <h3>Deepgram</h3>
                <p>Speaker-aware transcription · Nova-3 multilingual</p>
              </div>
              <a
                href="https://console.deepgram.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Open Deepgram console"
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <label>
              Deepgram API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={deepgram}
                onChange={(e) => setDeepgram(e.target.value)}
                placeholder="Enter your Deepgram key"
                aria-label="Deepgram API key"
              />
            </label>
          </div>
          <div className="connection">
            <div className="connection-heading">
              <span className="provider-icon mint">O</span>
              <div>
                <h3>OpenAI</h3>
                <p>Evidence-linked meeting notes · GPT-6 Luna</p>
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
                autoComplete="off"
                spellCheck={false}
                value={openai}
                onChange={(e) => setOpenai(e.target.value)}
                placeholder="Enter your OpenAI key"
                aria-label="OpenAI API key"
              />
            </label>
          </div>
          <div className="settings-actions">
            <button type="submit" className="button primary">
              {saved ? <Check size={16} /> : <KeyRound size={16} />}{" "}
              {saved ? "Saved for this session" : "Save session keys"}
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                forgetKeys();
                setOpenai("");
                setDeepgram("");
                setNotice("Session keys forgotten.");
              }}
            >
              <Trash2 size={16} />
              Forget keys
            </button>
          </div>
          <p className="small muted">
            Saving keys does not test them or incur a charge. Requests are made
            only after you confirm a meeting operation.
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
        <section className="settings-panel">
          <div className="panel-title">
            <ShieldCheck size={20} />
            <h2>Cost estimates</h2>
          </div>
          <p className="muted">
            Optionally enter your Deepgram rate from your plan. Rates and
            features differ. Memo cost is shown as unknown before actual usage.
          </p>
          <label>
            Speech rate · USD per minute
            <input
              type="number"
              step="0.0001"
              min="0"
              max="10"
              defaultValue={getSpeechRate() ?? ""}
              placeholder="Unknown"
              onChange={(e) =>
                setSpeechRate(
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
          </label>
          <p className="small muted">
            Estimates are not a billing cap. Rate is kept for this session.
          </p>
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
          limited to 50 MB; long recordings may need an externally prepared
          transcript. Live provider quality and physical-phone validation are
          tracked separately.
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
