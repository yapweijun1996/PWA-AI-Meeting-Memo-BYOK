import { translateUi } from "./i18n";
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
  FolderOpen,
  HelpCircle,
  Leaf,
  Languages,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
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
import { cleanupIncompleteLongAudio } from "./storage/long-audio-store";
import { readBackup } from "./storage/backup";
import { restoreSpeakerAvatars, trackAvatarWrite } from "./storage/speaker-avatars";
import { Brand, Empty, Pill } from "./components/ui";
import { TooltipLayer } from "./components/TooltipLayer";
import { ToastLayer } from "./components/ToastLayer";
import { LoadingPlaceholder } from "./components/LoadingPlaceholder";
import { NewMeeting } from "./features/NewMeeting";
import { MeetingWorkspace } from "./features/MeetingWorkspace";
import { Settings } from "./features/Settings";
import { isProcessing } from "./jobs/runner";
import {
  getSettingsStorageError,
  saveUiLanguagePreference,
  isSettingsDirty,
} from "./providers/credentials";
import { PwaStatus } from "./pwa/status";
import { useSidebarCollapsed } from "./features/useSidebarCollapsed";
import { useUiLanguage } from "./ui-language";
import { HelpModal } from "./features/HelpModal";
import { translateMessage } from "./ui-messages";
export const navigate = (route: string) => {
  location.hash = route;
};
export default function App() {
  const uiLanguage = useUiLanguage();
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  const [languageSaving, setLanguageSaving] = useState(false);
  const navTip = (label: string) => (sidebarCollapsed ? label : undefined);
  const t = (en: string, zh: string) => translateUi(uiLanguage, en, zh);
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
  const hasMeetings = meetings.length > 0;
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
      .then(async () => {
        try { await cleanupIncompleteLongAudio(); } catch { /* startup cleanup is best-effort */ }
      })
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
      const restored = await saveMeeting(result.meeting, result.audio);
      if (result.avatars) {
        try { await trackAvatarWrite(restoreSpeakerAvatars(restored.id, result.avatars)); }
        catch { setError(t("Meeting restored, but some profile images could not be restored.", "\u4f1a\u8bae\u5df2\u6062\u590d\uff0c\u4f46\u90e8\u5206\u5934\u50cf\u672a\u80fd\u6062\u590d\u3002")); }
      }
      await created(restored);
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
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <TooltipLayer />
      <ToastLayer />
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
      <aside id="app-sidebar" className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a className="brand-link" href="#/" aria-label={t("Meeting Memo home", "Meeting Memo 首页")}>
          <Brand />
        </a>
        <p className="nav-label">{t("WORKSPACE", "工作空间")}</p>
        <nav aria-label={t("Main navigation", "主导航")}>
          <a
            href="#/"
            aria-current={route === "/" && filter !== "review" ? "page" : undefined}
            data-tooltip={navTip(t("Your meetings", "您的会议"))}
            className={
              (route === "/" && filter !== "review") || route.startsWith("/meetings")
                ? "active"
                : ""
            }
            onClick={() => setFilter("all")}
          >
            <FolderOpen size={19} />
            <span className="nav-text">{t("Your meetings", "您的会议")}</span><span className="nav-count">{meetings.length}</span>
          </a>
          <button
            data-tooltip={navTip(t("Needs review", "待审阅"))}
            className={route === "/" && filter === "review" ? "active" : ""}
            onClick={() => {
              setFilter("review");
              navigate("/");
              setMobileNav(false);
            }}
          >
            <Clock size={19} />
            <span className="nav-text">{t("Needs review", "待审阅")}</span>
            <span className="nav-count">{needsReviewCount}</span>
          </button>
          <button data-tooltip={navTip(t("New meeting", "新建会议"))} onClick={() => setNewOpen(true)}>
            <Plus size={19} />
            <span className="nav-text">{t("New meeting", "新建会议")}</span>
          </button>
          <label className="nav-file" data-tooltip={navTip(t("Restore backup", "恢复备份"))}>
            <Upload size={19} />
            <span className="nav-text">{t("Restore backup", "恢复备份")}</span>
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
          <div className="sidebar-recent-heading">
            <p className="nav-label">{t("RECENT MEETINGS", "最近会议")}</p>
            {meetings.length > 4 && (
              <button
                type="button"
                className="sidebar-recent-all"
                aria-label={t("View all meetings", "查看全部会议")}
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                  setMobileNav(false);
                  navigate("/");
                }}
              >
                {t("View all", "查看全部")}
              </button>
            )}
          </div>
          {meetings.length > 0 ? (
            <div className="sidebar-recent-list">
              {meetings.slice(0, 4).map((m) => {
                const status = workflow(m);
                return (
                  <a
                    key={m.id}
                    href={`#/meetings/${m.id}`}
                    className={current?.id === m.id ? "active" : ""}
                    aria-current={current?.id === m.id ? "page" : undefined}
                    data-tooltip={m.title}
                    onClick={() => setMobileNav(false)}
                  >
                    <span
                      className={`status-dot ${status.tone === "green" ? "is-ready" : status.tone === "sand" ? "is-warn" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="sidebar-recent-content">
                      <span className="sidebar-recent-title">{m.title}</span>
                      <span className="sidebar-recent-status">{status.badge}</span>
                    </span>
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
            aria-current={route === "/settings" ? "page" : undefined}
            data-tooltip={navTip(t("Settings & API keys", "设置与 API 密钥"))}
            className={route === "/settings" ? "active" : ""}
          >
            <SettingsIcon size={18} />
            <span className="nav-text">{t("Settings & API keys", "设置与 API 密钥")}</span>
          </a>
          <button data-tooltip={navTip(t("How it works", "使用说明"))} onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            <span className="nav-text">{t("How it works", "使用说明")}</span>
          </button>
          <div className="local-label">
            <span className="status-dot" />
            <span className="nav-text">{t("Saved on this device · Local storage", "已保存在此设备 · 本地存储")}</span>
          </div>
          <div id="pwa-sidebar-slot" />
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
            <button
              className="icon-button sidebar-toggle"
              onClick={toggleSidebar}
              aria-controls="app-sidebar"
              aria-expanded={!sidebarCollapsed}
              aria-label={
                sidebarCollapsed
                  ? t("Expand sidebar", "展开侧边栏")
                  : t("Collapse sidebar", "收起侧边栏")
              }
              data-tooltip={
                sidebarCollapsed
                  ? t("Expand sidebar", "展开侧边栏")
                  : t("Collapse sidebar", "收起侧边栏")
              }
            >
              {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
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
          <label className="topbar-language" data-tooltip={t("Display language", "\u663e\u793a\u8bed\u8a00")}><Languages size={20} aria-hidden="true" />
            <select aria-label={t("Display language", "\u663e\u793a\u8bed\u8a00")} value={uiLanguage} disabled={languageSaving} onChange={(event) => { setLanguageSaving(true); void saveUiLanguagePreference(event.target.value as "en" | "zh-CN" | "ms").catch(() => setError(t("Wait for settings to finish saving, or check local storage.", "请等待设置保存完成，或检查本地存储。"))).finally(() => setLanguageSaving(false)); }}>
              <option value="en">English</option><option value="zh-CN">{"\u7b80\u4f53\u4e2d\u6587"}</option><option value="ms">Bahasa Melayu (partial)</option>
            </select>
          </label>
          <span className="privacy-top" data-tooltip={t("Meetings are saved locally. AI requests use your selected provider.", "\u4f1a\u8bae\u4fdd\u5b58\u5728\u672c\u5730\u3002AI \u8bf7\u6c42\u4f7f\u7528\u60a8\u9009\u62e9\u7684\u670d\u52a1\u5546\u3002")}>
            <ShieldCheck size={15} />
            {online
              ? t("Local storage · BYOK", "\u672c\u5730\u5b58\u50a8 · BYOK")
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
            ) : loading ? <LoadingPlaceholder kind="meeting" label={t("Opening your meeting...", "\u6b63\u5728\u6253\u5f00\u4f1a\u8bae...")} /> : (
              <div className="empty"><p>{t("Choose a meeting from your library.", "\u8bf7\u4ece\u4f1a\u8bae\u5e93\u4e2d\u9009\u62e9\u4f1a\u8bae\u3002")}</p><a href="#/">{t("Back to meetings", "\u8fd4\u56de\u4f1a\u8bae\u5217\u8868")}</a></div>
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
                {hasMeetings && (
                  <button
                    className="button primary"
                    onClick={() => setNewOpen(true)}
                  >
                    <Plus size={18} />
                    {t("New meeting", "新建会议")}
                  </button>
                )}
              </section>
              {hasMeetings && (
              <section className="stats" aria-label={t("Library summary", "会议库摘要")}>
                <div>
                  <span className="stat-icon">
                    <FolderOpen size={19} />
                  </span>
                  <div>
                    <strong>
                      {meetings.length}
                    </strong>
                    <span>{t("Total meetings", "会议总数")}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon sand">
                    <BookOpen size={19} />
                  </span>
                  <div>
                    <strong>{needsReviewCount}</strong>
                    <span>{t("Needs review", "待审阅")}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon lavender">
                    <CheckCircle2 size={19} />
                  </span>
                  <div>
                    <strong>{completedCount}</strong>
                    <span>{t("Completed notes", "已完成笔记")}</span>
                  </div>
                </div>
              </section>
              )}
              <section className="library">
                {hasMeetings && (
                <div className="section-title">
                  <h2>
                    {t("Meeting library", "会议库")} <span>{meetings.length}</span>
                  </h2>
                </div>
                )}
                {hasMeetings && (
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
                      {search && (
                        <button
                          type="button"
                          className="icon-button search-clear"
                          aria-label={t("Clear search", "清除搜索")}
                          onClick={() => setSearch("")}
                        >
                          <X size={15} />
                        </button>
                      )}
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
                )}
                {loading ? (
                  <LoadingPlaceholder kind="library" label={t("Opening local library...", "\u6b63\u5728\u6253\u5f00\u672c\u5730\u4f1a\u8bae\u5e93...")} />
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
        <HelpModal
          t={t}
          onClose={() => setHelp(false)}
          onExplore={async () => {
            try {
              await created(await saveMeeting(sampleMeeting()));
              setHelp(false);
            } catch {
              setError(t("Could not save the example.", "???????"));
            }
          }}
        />
      )}
    </div>
  );
}
