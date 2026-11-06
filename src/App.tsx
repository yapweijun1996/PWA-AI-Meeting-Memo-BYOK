import { isMeetingCompleted, doesMeetingNeedReview, getMeetingWorkflow } from "./domain/workflow";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  AudioLines,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  HelpCircle,
  Leaf,
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
    [sortBy, setSortBy] = useState<"recent" | "date" | "title">("recent"),
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
  const workflow = (m: Meeting) => {
    const value = getMeetingWorkflow(m);
    return { ...value, badge: t(...value.badge), stage: t(...value.stage), cta: t(...value.cta) };
  };
  const needsReviewCount = meetings.filter(doesMeetingNeedReview).length;
  const completedCount = meetings.filter(isMeetingCompleted).length;
  const visible = meetings
    .filter(
      (m) =>
        m.title.toLowerCase().includes(search.toLowerCase()) &&
        (filter === "all" ||
          (filter === "notes" && m.memos.length > 0) ||
          (filter === "review" && doesMeetingNeedReview(m))),
    )
    .sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "date") return b.date.localeCompare(a.date);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
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
              (route === "/" && filter !== "review") || route.startsWith("/meetings")
                ? "active"
                : ""
            }
            onClick={() => setFilter("all")}
          >
            <FolderOpen size={19} />
            {t("Your meetings", "您的会议")}<span className="nav-count">{meetings.length}</span>
          </a>
          <button
            className={route === "/" && filter === "review" ? "active" : ""}
            onClick={() => {
              setFilter("review");
              navigate("/");
              setMobileNav(false);
            }}
          >
            <Clock size={19} />
            {t("Needs review", "待审阅")}
            <span className="nav-count">{needsReviewCount}</span>
          </button>
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
        <div className="sidebar-recent" aria-label={t("Recent meetings", "最近会议")}>
          <p className="nav-label">{t("RECENT MEETINGS", "最近会议")}</p>
          {meetings.length > 0 ? (
            <div className="sidebar-recent-list">
              {meetings.slice(0, 4).map((m) => {
                const status = workflow(m);
                return (
                  <a
                    key={m.id}
                    href={`#/meetings/${m.id}`}
                    className={current?.id === m.id ? "active" : ""}
                  >
                    <span
                      className={`status-dot ${status.tone === "green" ? "is-ready" : status.tone === "sand" ? "is-warn" : ""}`}
                    />
                    <span className="sidebar-recent-title">{m.title}</span>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="sidebar-empty-hint">
              {t("Created meetings appear here for quick switching.", "创建的会议将显示在此处，方便快速切换。")}
            </p>
          )}
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
            {t("Saved on this device · Local storage", "已保存在此设备 · 本地存储")}
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
            <a className="breadcrumb-root" href="#/">
              {t("Workspace", "工作空间")}
            </a>
            <ChevronRight size={14} />
            <strong>
              {route === "/settings"
                ? t("Settings", "设置")
                : current?.title || t("Your meetings", "您的会议")}
            </strong>
            {route.startsWith("/meetings/") && current && (
              <Pill tone={workflow(current).tone}>
                {workflow(current).badge}
              </Pill>
            )}
          </div>
          <span className="privacy-top">
            <ShieldCheck size={15} />
            {online
              ? t("Private by design · Local storage", "重视隐私 · 本地存储")
              : t("Browser reports offline · Local storage", "浏览器显示离线 · 本地存储")}
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
                  <h1>
                    {t("Your meetings", "您的会议")}<span className="heading-dot">.</span>
                  </h1>
                  <p>{t("Manage recordings, transcripts and notes.", "管理录音、转录与会议笔记。")}</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setNewOpen(true)}
                >
                  <Plus size={18} />
                  {t("New meeting", "新建会议")}
                </button>
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
                    <span>{t("Total meetings", "会议总数")}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon sand">
                    <BookOpen size={19} />
                  </span>
                  <div>
                    <strong>{needsReviewCount.toString().padStart(2, "0")}</strong>
                    <span>{t("Needs review", "待审阅")}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon lavender">
                    <CheckCircle2 size={19} />
                  </span>
                  <div>
                    <strong>{completedCount.toString().padStart(2, "0")}</strong>
                    <span>{t("Completed notes", "已完成笔记")}</span>
                  </div>
                </div>
              </section>
              <section className="welcome-banner" aria-label={t("Workspace overview", "工作空间简介")}>
                <div className="welcome-banner-copy">
                  <strong>
                    <Sparkles size={16} />
                    {t("Turn conversations into clear next steps.", "将每次讨论转化为清晰的下一步。")}
                  </strong>
                  <p>
                    {t("Record, transcribe and review — all in one workspace.", "在一个工作空间中完成录音导入、转录与笔记审阅。")}
                  </p>
                </div>
                <button className="text-button" onClick={() => setHelp(true)}>
                  {t("How it works", "使用说明")}
                  <ArrowUpRight size={15} />
                </button>
              </section>
              <section className="library">
                <div className="section-title">
                  <h2>
                    {t("Meeting library", "会议库")} <span>{meetings.length}</span>
                  </h2>
                </div>
                <div className="library-toolbar">
                  <div className="filter-row" role="group" aria-label={t("Filter meetings", "筛选会议")}>
                    {[
                      ["all", `${t("All", "全部")} (${meetings.length})`],
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
                  </div>
                  <div className="library-controls">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label={t("Search meetings", "搜索会议")}
                        placeholder={t("Search meetings", "搜索会议")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <label className="sort-control">
                      <span>{t("Sort", "排序")}</span>
                      <select
                        aria-label={t("Sort meetings", "排序会议")}
                        value={sortBy}
                        onChange={(e) =>
                          setSortBy(e.target.value as "recent" | "date" | "title")
                        }
                      >
                        <option value="recent">{t("Recently updated", "最近更新")}</option>
                        <option value="date">{t("Meeting date", "会议日期")}</option>
                        <option value="title">{t("Title A–Z", "标题排序")}</option>
                      </select>
                    </label>
                  </div>
                </div>
                {loading ? (
                  <p role="status">{t("Opening local library…", "正在打开本地会议库…")}</p>
                ) : visible.length ? (
                  <div className="meeting-grid">
                    {visible.map((m) => {
                      const status = workflow(m);
                      return (
                        <a
                          className="meeting-card"
                          href={`#/meetings/${m.id}`}
                          key={m.id}
                        >
                          <div className="card-top">
                            <span className="card-icon">
                              <AudioLines size={20} />
                            </span>
                            <Pill tone={status.tone}>{status.badge}</Pill>
                          </div>
                          <h3>{m.title}</h3>
                          <p className="meeting-card-stage">
                            <strong>{status.stage}</strong>
                            {" · "}
                            {m.synthetic
                              ? t("Synthetic example · no recording", "模拟示例 · 无录音")
                              : `${m.date} · ${m.kind === "erp" ? t("ERP discovery", "ERP 需求讨论") : t("General meeting", "一般会议")}`}
                          </p>
                          <footer>
                            <span>
                              {m.segments.length} {t("passages", "段转录")} · {m.speakers.length} {t("speakers", "位说话人")}
                            </span>
                            <span className="card-cta">
                              {status.cta}
                              <ArrowUpRight size={15} />
                            </span>
                          </footer>
                        </a>
                      );
                    })}
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
