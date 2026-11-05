import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  AudioLines,
  BookOpen,
  ChevronRight,
  FileText,
  FolderOpen,
  HardDrive,
  HelpCircle,
  Leaf,
  LockKeyhole,
  Menu,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { sampleMeeting, type Meeting } from "./domain/model";
import {
  listMeetings,
  getMeeting,
  saveMeeting,
  deleteMeeting,
} from "./storage/repository";
import { readBackup } from "./storage/backup";
import { Brand, Empty, Modal, Pill } from "./components/ui";
import { NewMeeting } from "./features/NewMeeting";
import { MeetingWorkspace } from "./features/MeetingWorkspace";
import { Settings } from "./features/Settings";
import { isProcessing } from "./jobs/runner";
import {
  getSettingsStorageError,
  isSettingsDirty,
} from "./providers/credentials";
import { PwaStatus } from "./pwa/status";
import { useUiLanguage } from "./ui-language";
import { translateMessage } from "./ui-messages";
export const navigate = (route: string) => {
  location.hash = route;
};
export default function App() {
  const uiLanguage = useUiLanguage();
  const t = (en: string, zh: string) => uiLanguage === "zh-CN" ? zh : en;
  useEffect(() => { document.documentElement.lang = uiLanguage; }, [uiLanguage]);
  const [route, setRoute] = useState(location.hash.slice(1) || "/"),
    [meetings, setMeetings] = useState<Meeting[]>([]),
    [current, setCurrent] = useState<Meeting>(),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(getSettingsStorageError()),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [newOpen, setNewOpen] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [help, setHelp] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [topHidden, setTopHidden] = useState(false),
    [showTop, setShowTop] = useState(false);
  useEffect(() => {
    let last = scrollY;
    const onScroll = () => {
      const y = scrollY;
      if (Math.abs(y - last) > 14) {
        setTopHidden(y > last && y > 100);
        last = y;
      }
      setShowTop(y > 700);
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  function reportError(message: string) {
    setError(message);
    window.dispatchEvent(
      new CustomEvent("memo-operation-error", { detail: message }),
    );
  }

  const refresh = useCallback(async () => {
    setMeetings(await listMeetings());
  }, []);
  useEffect(() => {
    const fn = () => {
      setRoute(location.hash.slice(1) || "/");
      setMobileNav(false);
    };
    addEventListener("hashchange", fn);
    return () => removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    setLoading(true);
    void refresh()
      .catch(() =>
        setError(
          "Local storage could not be opened. Check browser storage permissions; private mode may be temporary.",
        ),
      )
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const failed = () => {
      if (location.hash !== "#/settings")
        setError(
          "Settings could not be saved. Return to Settings and enter them again.",
        );
    };
    addEventListener("memo-settings-save-failed", failed);
    return () => removeEventListener("memo-settings-save-failed", failed);
  }, []);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    addEventListener("online", on);
    addEventListener("offline", on);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    const fn = () => {
      void refresh();
    };
    addEventListener("memo-storage-changed", fn);
    return () => removeEventListener("memo-storage-changed", fn);
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    const id = route.match(/^\/meetings\/([^/]+)/)?.[1];
    setCurrent(undefined);
    if (id) {
      setLoading(true);
      void getMeeting(id)
        .then((m) => {
          if (cancelled) return;
          if (!m) throw new Error("This meeting is no longer available.");
          setCurrent(m);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [route]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (isProcessing() || isSettingsDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", guard);
    return () => removeEventListener("beforeunload", guard);
  }, []);
  async function created(m: Meeting) {
    await refresh();
    setNewOpen(false);
    setCurrent(m);
    navigate(`/meetings/${m.id}`);
  }
  async function restore(file?: File) {
    if (!file) return;
    try {
      const result = await readBackup(file);
      if (
        !confirm(
          t(`Restore “${result.meeting.title}” as a new local copy? Existing meetings will stay intact.`, `将“${result.meeting.title}”恢复为新的本地副本吗？现有会议不会受影响。`),
        )
      )
        return;
      await created(await saveMeeting(result.meeting, result.audio));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore this file.");
    }
  }
  const visible = meetings.filter(
    (m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "notes" && m.memos.length) ||
        (filter === "review" && m.segments.some((s) => !s.reviewed))),
  );
  const reviewed = meetings.filter((m) =>
    m.memos.some((v) => v.items.some((i) => i.review === "accepted")),
  ).length;
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        {t("Skip to content", "跳转到内容")}
      </a>
      {mobileNav && (
        <button
          className="nav-scrim"
          onClick={() => setMobileNav(false)}
          aria-label={t("Close navigation", "关闭导航")}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a className="brand-link" href="#/" aria-label={t("Meeting Memo home", "Meeting Memo 首页")}>
          <Brand />
        </a>
        <p className="nav-label">{t("WORKSPACE", "工作空间")}</p>
        <nav aria-label={t("Main navigation", "主导航")}>
          <a
            href="#/"
            className={
              route === "/" || route.startsWith("/meetings") ? "active" : ""
            }
          >
            <FolderOpen size={19} />
            {t("Your meetings", "您的会议")}<span className="nav-count">{meetings.length}</span>
          </a>
          <button onClick={() => setNewOpen(true)}>
            <Plus size={19} />
            {t("New meeting", "新建会议")}
          </button>
          <label className="nav-file">
            <Upload size={19} />
            {t("Restore backup", "恢复备份")}
            <input
              type="file"
              accept=".zip,.json"
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </nav>
        <div className="sidebar-note">
          <Leaf size={22} />
          <strong>
            {t("A little less admin.", "少一点行政工作。")}
            <br />{t("A lot more presence.", "多一点专注。")}
          </strong>
          <p>
            {t("Bring your own key.", "使用您自己的密钥。")}
            <br />
            {t("Keep your meetings close.", "让会议资料留在身边。")}
          </p>
        </div>
        <div className="sidebar-bottom">
          <a
            href="#/settings"
            className={route === "/settings" ? "active" : ""}
          >
            <SettingsIcon size={18} />
            {t("Settings & API keys", "设置与 API 密钥")}
          </a>
          <button onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            {t("How it works", "使用说明")}
            <ArrowUpRight size={14} />
          </button>
          <div className="local-label">
            <span className="status-dot" />
            {t("Saved on this device", "已保存在此设备")}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className={`topbar ${topHidden ? "topbar-hidden" : ""}`}>
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label={t("Open navigation", "打开导航")}
            >
              <Menu size={22} />
            </button>
            <span>{t("Workspace", "工作空间")}</span>
            <ChevronRight size={14} />
            <strong>
              {route === "/settings"
                ? t("Settings", "设置")
                : current?.title || t("Your meetings", "您的会议")}
            </strong>
          </div>
          <span className="privacy-top">
            <ShieldCheck size={15} />
            {online ? t("Private by design", "重视隐私") : t("Browser reports offline", "浏览器显示离线")}
          </span>
        </header>
        <main id="main-content" tabIndex={-1}>
          {error && (
            <div className="notice danger" role="alert">
              {translateMessage(error, uiLanguage)}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label={t("Dismiss error", "关闭错误提示")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <PwaStatus />
          {route === "/settings" ? (
            <Settings />
          ) : route.startsWith("/meetings/") ? (
            current ? (
              <MeetingWorkspace
                key={current.id}
                meeting={current}
                onUpdate={(m) => {
                  if (location.hash === `#/meetings/${m.id}`) setCurrent(m);
                  void refresh();
                }}
                onDelete={async () => {
                  if (isProcessing())
                    throw new Error("Finish processing first.");
                  await deleteMeeting(current.id);
                  await refresh();
                  navigate("/");
                }}
                onError={reportError}
              />
            ) : (
              <div className="empty">
                <p>
                  {loading
                    ? t("Opening your meeting…", "正在打开会议…")
                    : t("Choose a meeting from your library.", "请从会议库中选择会议。")}
                </p>
                <a href="#/">{t("Back to meetings", "返回会议列表")}</a>
              </div>
            )
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span />
                    {t("YOUR PERSONAL WORKSPACE", "您的个人工作空间")}
                  </div>
                  <h1>
                    {t("Your meetings", "您的会议")}<span className="heading-dot">.</span>
                  </h1>
                  <p>{t("Good conversations deserve clear next steps.", "让每次讨论都有清晰的下一步。")}</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setNewOpen(true)}
                >
                  <Plus size={18} />
                  {t("New meeting", "新建会议")}
                </button>
              </section>
              <section className="welcome-panel">
                <div className="welcome-copy">
                  <Pill tone="light">
                    <Sparkles size={13} /> {t("A clearer head after every meeting", "每次会议后思路更清晰")}
                  </Pill>
                  <h2>
                    {t("Stay in the conversation.", "专注于讨论。")}
                    <br />
                    <em>{t("Leave the notes to your workspace.", "让工作空间协助整理笔记。")}</em>
                  </h2>
                  <p>
                    {t("Turn a recording into a transcript you can trust, then review the decisions and next steps.", "将录音转换为可审阅的转录，再检查决定与下一步行动。")}
                  </p>
                  <button
                    className="button dark"
                    onClick={() => setNewOpen(true)}
                  >
                    {t("Start with a recording", "从录音开始")}
                    <ArrowUpRight size={17} />
                  </button>
                  <span className="welcome-foot">
                    <LockKeyhole size={12} />
                    {t("Your keys. Your review. Your notes.", "您的密钥，您的审阅，您的笔记。")}
                  </span>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="art-ring" />
                  <div className="floating-label">
                    <span className="status-dot" />
                    {t("Thoughtfully captured", "用心记录")}
                  </div>
                  <div className="art-document">
                    <div className="art-doc-head">
                      <span className="small-mark">
                        <AudioLines size={22} />
                      </span>
                      <span>
                        {t("Team conversation", "团队讨论")}
                        <small>{t("Ready for a little clarity", "让思路更清晰")}</small>
                      </span>
                    </div>
                    <div className="wave-bars">
                      {Array.from({ length: 32 }, (_, i) => (
                        <i
                          key={i}
                          style={{
                            height: `${12 + (Math.sin(i * 1.7) + 1) * 18}px`,
                          }}
                        />
                      ))}
                    </div>
                    <div className="art-line long" />
                    <div className="art-line" />
                    <div className="art-check">
                      <span>✓</span>{t("A clear next step", "清晰的下一步")}
                    </div>
                    <div className="art-line short" />
                  </div>
                  <div className="floating-note">
                    <FileText size={17} />
                    {t("From conversation to clarity", "从讨论到清晰行动")}
                    <Leaf size={15} />
                  </div>
                </div>
              </section>
              <section className="stats" aria-label={t("Library summary", "会议库摘要")}>
                <div>
                  <span className="stat-icon">
                    <FolderOpen size={19} />
                  </span>
                  <div>
                    <strong>
                      {meetings.length.toString().padStart(2, "0")}
                    </strong>
                    <span>{t("Meetings saved", "已保存会议")}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon lavender">
                    <BookOpen size={19} />
                  </span>
                  <div>
                    <strong>{reviewed.toString().padStart(2, "0")}</strong>
                    <span>{t("With reviewed notes", "已有审阅笔记")}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon sand">
                    <HardDrive size={19} />
                  </span>
                  <div>
                    <strong>{t("Local", "本地")}</strong>
                    <span>{t("Stored on this device", "保存在此设备")}</span>
                  </div>
                </div>
              </section>
              <section className="library">
                <div className="section-title">
                  <h2>
                    {t("Meeting library", "会议库")} <span>{meetings.length}</span>
                  </h2>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label={t("Search meetings", "搜索会议")}
                      placeholder={t("Search your meetings", "搜索您的会议")}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="filter-row">
                  {[
                    ["all", t("All meetings", "所有会议")],
                    ["review", t("Needs review", "需要审阅")],
                    ["notes", t("With notes", "有笔记")],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "selected" : ""}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                  <span>{t("Most recently updated", "最近更新")}</span>
                </div>
                {loading ? (
                  <p role="status">{t("Opening local library…", "正在打开本地会议库…")}</p>
                ) : visible.length ? (
                  <div className="meeting-grid">
                    {visible.map((m) => (
                      <a
                        className="meeting-card"
                        href={`#/meetings/${m.id}`}
                        key={m.id}
                      >
                        <div className="card-top">
                          <span className="card-icon">
                            <AudioLines size={22} />
                          </span>
                          <Pill tone={m.memos.length ? "green" : "neutral"}>
                            {m.memos.length
                              ? t("Draft notes", "笔记草稿")
                              : m.segments.length
                                ? t("Review transcript", "审阅转录")
                                : t("Ready to start", "准备开始")}
                          </Pill>
                        </div>
                        <h3>{m.title}</h3>
                        <p>
                          {m.synthetic
                            ? t("Synthetic example · no recording", "模拟示例 · 无录音")
                            : `${m.date} · ${m.kind === "erp" ? t("ERP discovery", "ERP 需求讨论") : t("General meeting", "一般会议")}`}
                        </p>
                        <footer>
                          <span>
                            {m.segments.length} {t("passages", "段转录")} · {m.speakers.length} {t("speakers", "位说话人")}
                          </span>
                          <ArrowUpRight size={18} />
                        </footer>
                      </a>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={
                      search || filter !== "all"
                        ? t("No meetings match this view", "没有符合条件的会议")
                        : t("Your next good conversation starts here", "从这里开始您的下一次会议")
                    }
                  >
                    <p>
                      {search || filter !== "all"
                        ? t("Try another search or filter.", "请尝试其他搜索或筛选条件。")
                        : t("Import a recording or transcript to begin. Nothing is sent until you say so.", "导入录音或转录开始使用。未经您确认不会发送任何内容。")}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setNewOpen(true)}
                    >
                      <Plus size={16} />
                      {t("Create your first meeting", "创建第一个会议")}
                    </button>
                  </Empty>
                )}
              </section>
              <section className="bottom-note">
                <div>
                  <span className="round-icon">
                    <ShieldCheck size={21} />
                  </span>
                  <div>
                    <strong>{t("A workspace that puts you in control.", "让您掌控自己的工作空间。")}</strong>
                    <p>
                      {t("Saved locally. Sent to your chosen AI provider only with your permission.", "数据保存在本地，只在您同意后发送给所选 AI 服务商。")}
                    </p>
                  </div>
                </div>
                <button className="text-button" onClick={() => setHelp(true)}>
                  {t("A quick tour", "快速了解")}
                  <ArrowUpRight size={16} />
                </button>
              </section>
              <footer className="page-footer">
                <span>{t("Made for more mindful meetings.", "让会议更加专注。")}</span>
                <span>
                  <Leaf size={13} />
                  {t("Less busywork. More clarity.", "减少繁琐工作，理清重点。")}
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {showTop && (
        <button
          className={`back-to-top ${current?.audio ? "above-player" : ""}`}
          aria-label={t("Back to top", "返回顶部")}
          onClick={() =>
            scrollTo({
              top: 0,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            })
          }
        >
          <ArrowUp size={18} />
        </button>
      )}
      {newOpen && (
        <NewMeeting
          onClose={() => setNewOpen(false)}
          onCreated={created}
          onError={reportError}
        />
      )}
      {help && (
        <Modal
          title={t("A little clarity, step by step", "使用步骤")}
          onClose={() => setHelp(false)}
        >
          <div className="modal-body">
            <ol className="tour">
              <li>
                <strong>{t("Bring your conversation", "添加会议内容")}</strong>
                <p>{t("Create a meeting and import a recording or transcript.", "创建会议并导入录音或转录。")}</p>
              </li>
              <li>
                <strong>{t("Review who said what", "审阅发言人和内容")}</strong>
                <p>
                  {t("Connect your own keys in Settings. Speaker labels are anonymous until you confirm them.", "在设置中连接自己的密钥。说话人标签在您确认之前保持匿名。")}
                </p>
              </li>
              <li>
                <strong>{t("Make your notes yours", "审阅您的笔记")}</strong>
                <p>
                  {t("Review suggested decisions and actions against the source. Export a full backup to keep a separate copy.", "对照来源审阅建议的决定和行动，并导出完整备份以保留副本。")}
                </p>
              </li>
            </ol>
            <div className="notice">
              {t("Cloud AI needs a connection. Keep this page open while processing. Local storage can be cleared by your browser; backups matter.", "云端 AI 需要网络连接。处理期间请保持页面打开。浏览器可能清除本地数据，请定期备份。")}
            </div>
            <button
              className="button secondary full"
              onClick={async () => {
                try {
                  await created(await saveMeeting(sampleMeeting()));
                  setHelp(false);
                } catch {
                  setError(t("Could not save the example.", "无法保存示例。"));
                }
              }}
            >
              <FileText size={17} />
              {t("Explore a synthetic example", "查看模拟示例")}
            </button>
            <p className="small muted">
              {t("The example contains invented text, no recorded audio and no AI-generated results.", "示例使用虚构文字，不含录音或 AI 生成结果。")}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
