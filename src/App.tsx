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
import { PwaStatus } from "./pwa/status";
export const navigate = (route: string) => {
  location.hash = route;
};
export default function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/"),
    [meetings, setMeetings] = useState<Meeting[]>([]),
    [current, setCurrent] = useState<Meeting>(),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
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
      if (isProcessing()) {
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
          `Restore “${result.meeting.title}” as a new local copy? Existing meetings will stay intact.`,
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
        Skip to content
      </a>
      {mobileNav && (
        <button
          className="nav-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a className="brand-link" href="#/" aria-label="Meeting Memo home">
          <Brand />
        </a>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <a
            href="#/"
            className={
              route === "/" || route.startsWith("/meetings") ? "active" : ""
            }
          >
            <FolderOpen size={19} />
            Your meetings<span className="nav-count">{meetings.length}</span>
          </a>
          <button onClick={() => setNewOpen(true)}>
            <Plus size={19} />
            New meeting
          </button>
          <label className="nav-file">
            <Upload size={19} />
            Restore backup
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
            A little less admin.
            <br />A lot more presence.
          </strong>
          <p>
            Bring your own key.
            <br />
            Keep your meetings close.
          </p>
        </div>
        <div className="sidebar-bottom">
          <a
            href="#/settings"
            className={route === "/settings" ? "active" : ""}
          >
            <SettingsIcon size={18} />
            Settings & API keys
          </a>
          <button onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            How it works
            <ArrowUpRight size={14} />
          </button>
          <div className="local-label">
            <span className="status-dot" />
            Saved on this device
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className={`topbar ${topHidden ? "topbar-hidden" : ""}`}>
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {route === "/settings"
                ? "Settings"
                : current?.title || "Your meetings"}
            </strong>
          </div>
          <span className="privacy-top">
            <ShieldCheck size={15} />
            {online ? "Private by design" : "Offline · local work available"}
          </span>
        </header>
        <main id="main-content" tabIndex={-1}>
          {error && (
            <div className="notice danger" role="alert">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
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
                    ? "Opening your meeting…"
                    : "Choose a meeting from your library."}
                </p>
                <a href="#/">Back to meetings</a>
              </div>
            )
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span />
                    YOUR PERSONAL WORKSPACE
                  </div>
                  <h1>
                    Your meetings<span className="heading-dot">.</span>
                  </h1>
                  <p>Good conversations deserve clear next steps.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setNewOpen(true)}
                >
                  <Plus size={18} />
                  New meeting
                </button>
              </section>
              <section className="welcome-panel">
                <div className="welcome-copy">
                  <Pill tone="light">
                    <Sparkles size={13} /> A clearer head after every meeting
                  </Pill>
                  <h2>
                    Stay in the conversation.
                    <br />
                    <em>Leave the notes to your workspace.</em>
                  </h2>
                  <p>
                    Turn a recording into a transcript you can trust,
                    <br className="desktop-break" /> then review the decisions
                    and next steps.
                  </p>
                  <button
                    className="button dark"
                    onClick={() => setNewOpen(true)}
                  >
                    Start with a recording
                    <ArrowUpRight size={17} />
                  </button>
                  <span className="welcome-foot">
                    <LockKeyhole size={12} />
                    Your keys. Your review. Your notes.
                  </span>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="art-ring" />
                  <div className="floating-label">
                    <span className="status-dot" />
                    Thoughtfully captured
                  </div>
                  <div className="art-document">
                    <div className="art-doc-head">
                      <span className="small-mark">
                        <AudioLines size={22} />
                      </span>
                      <span>
                        Team conversation
                        <small>Ready for a little clarity</small>
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
                      <span>✓</span>A clear next step
                    </div>
                    <div className="art-line short" />
                  </div>
                  <div className="floating-note">
                    <FileText size={17} />
                    From conversation to clarity
                    <Leaf size={15} />
                  </div>
                </div>
              </section>
              <section className="stats" aria-label="Library summary">
                <div>
                  <span className="stat-icon">
                    <FolderOpen size={19} />
                  </span>
                  <div>
                    <strong>
                      {meetings.length.toString().padStart(2, "0")}
                    </strong>
                    <span>Meetings saved</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon lavender">
                    <BookOpen size={19} />
                  </span>
                  <div>
                    <strong>{reviewed.toString().padStart(2, "0")}</strong>
                    <span>With reviewed notes</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon sand">
                    <HardDrive size={19} />
                  </span>
                  <div>
                    <strong>Local</strong>
                    <span>Stored on this device</span>
                  </div>
                </div>
              </section>
              <section className="library">
                <div className="section-title">
                  <h2>
                    Meeting library <span>{meetings.length}</span>
                  </h2>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search meetings"
                      placeholder="Search your meetings"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="filter-row">
                  {[
                    ["all", "All meetings"],
                    ["review", "Needs review"],
                    ["notes", "With notes"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "selected" : ""}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                  <span>Most recently updated</span>
                </div>
                {loading ? (
                  <p role="status">Opening local library…</p>
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
                              ? "Notes ready"
                              : m.segments.length
                                ? "Review transcript"
                                : "Ready to start"}
                          </Pill>
                        </div>
                        <h3>{m.title}</h3>
                        <p>
                          {m.synthetic
                            ? "Synthetic example · no recording"
                            : `${m.date} · ${m.kind === "erp" ? "ERP discovery" : "General meeting"}`}
                        </p>
                        <footer>
                          <span>
                            {m.segments.length} passages · {m.speakers.length}{" "}
                            speakers
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
                        ? "No meetings match this view"
                        : "Your next good conversation starts here"
                    }
                  >
                    <p>
                      {search || filter !== "all"
                        ? "Try another search or filter."
                        : "Import a recording or transcript to begin. Nothing is sent until you say so."}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setNewOpen(true)}
                    >
                      <Plus size={16} />
                      Create your first meeting
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
                    <strong>A workspace that puts you in control.</strong>
                    <p>
                      Saved locally. Sent to your chosen AI provider only with
                      your permission.
                    </p>
                  </div>
                </div>
                <button className="text-button" onClick={() => setHelp(true)}>
                  A quick tour
                  <ArrowUpRight size={16} />
                </button>
              </section>
              <footer className="page-footer">
                <span>Made for more mindful meetings.</span>
                <span>
                  <Leaf size={13} />
                  Less busywork. More clarity.
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {showTop && (
        <button
          className={`back-to-top ${current?.audio ? "above-player" : ""}`}
          aria-label="Back to top"
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
          title="A little clarity, step by step"
          onClose={() => setHelp(false)}
        >
          <div className="modal-body">
            <ol className="tour">
              <li>
                <strong>Bring your conversation</strong>
                <p>Create a meeting and import a recording or transcript.</p>
              </li>
              <li>
                <strong>Review who said what</strong>
                <p>
                  Connect your own keys in Settings. Speaker labels are
                  anonymous until you confirm them.
                </p>
              </li>
              <li>
                <strong>Make your notes yours</strong>
                <p>
                  Review suggested decisions and actions against the source.
                  Export a full backup to keep a separate copy.
                </p>
              </li>
            </ol>
            <div className="notice">
              Cloud AI needs a connection. Keep this page open while processing.
              Local storage can be cleared by your browser; backups matter.
            </div>
            <button
              className="button secondary full"
              onClick={async () => {
                try {
                  await created(await saveMeeting(sampleMeeting()));
                  setHelp(false);
                } catch {
                  setError("Could not save the example.");
                }
              }}
            >
              <FileText size={17} />
              Explore a synthetic example
            </button>
            <p className="small muted">
              The example contains invented text, no recorded audio and no
              AI-generated results.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
