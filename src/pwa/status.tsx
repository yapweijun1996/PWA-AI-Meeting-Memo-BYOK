import { Button } from "../components/controls";
import { Icon } from "../components/Icon";
import { translateUi } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { version as appVersion } from "../../package.json";
import { AlertTriangle, Check, Download, RefreshCw, WifiOff, X } from "lucide-react";
import { isProcessing } from "../jobs/runner";
import { flushWrites } from "../storage/repository";
import { avatarWritesPending, flushAvatarWrites } from "../storage/speaker-avatars";
import { flushSettingsWrites, isSettingsDirty } from "../providers/credentials";
import { useUiLanguage } from "../ui-language";
import { translateMessage } from "../ui-messages";
export function PwaStatus() {
  const language = useUiLanguage();
  const displayBuild = __BUILD_ID__.startsWith("local-") ? `local-${__BUILD_ID__.slice(-8)}` : __BUILD_ID__.slice(0, 8);
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const sidebarUpdateButton = useRef<HTMLButtonElement>(null);
  const bannerUpdateButton = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<{ origin: "sidebar" | "banner"; open: boolean }>({ origin: "banner", open: false });
  const [refreshReady, setRefreshReady] = useState(false);
  const [sidebarSlot, setSidebarSlot] = useState<HTMLElement | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState("");
  useEffect(() => { setSidebarSlot(document.getElementById("pwa-sidebar-slot")); }, []);
  const [waiting, setWaiting] = useState<ServiceWorker>(),
    [updating, setUpdating] = useState(false),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(!navigator.onLine);
  const [install, setInstall] = useState<
    Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    }
  >();
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    let controlled = !!navigator.serviceWorker?.controller;
    const controlChanged = () => {
      if (controlled) setRefreshReady(true);
      controlled = true;
    };
    navigator.serviceWorker?.addEventListener(
      "controllerchange",
      controlChanged,
    );
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(
        e as Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        },
      );
    };
    addEventListener("online", on);
    addEventListener("offline", on);
    addEventListener("beforeinstallprompt", prompt);
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          scope: import.meta.env.BASE_URL,
          updateViaCache: "none",
        })
        .then((reg) => {
          if (reg.waiting) setWaiting(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setWaiting(worker);
            });
          });
          const check = () => {
            if (document.visibilityState === "visible")
              void reg.update().catch(() => {});
          };
          document.addEventListener("visibilitychange", check);
        })
        .catch(() =>
          setError(
            "Offline installation is unavailable. Your local meetings can still be backed up.",
          ),
        );
    }
    return () => {
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        controlChanged,
      );
      removeEventListener("online", on);
      removeEventListener("offline", on);
      removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  async function checkForUpdates() {
    setCheckMessage("");
    if (!navigator.onLine) { setCheckMessage(t("Offline: connect to check for updates.", "\u79bb\u7ebf\uff1a\u8bf7\u8054\u7f51\u540e\u68c0\u67e5\u66f4\u65b0\u3002")); return; }
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) { setCheckMessage(t("Update checks are unavailable here.", "\u6b64\u73af\u5883\u65e0\u6cd5\u68c0\u67e5\u66f4\u65b0\u3002")); return; }
    setChecking(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      if (!registration) throw new Error("registration unavailable");
      await registration.update();
      if (registration.waiting) { setWaiting(registration.waiting); setCheckMessage(""); }
      else if (registration.installing) {
        const worker = registration.installing;
        setCheckMessage(t("Preparing an update...", "\u6b63\u5728\u51c6\u5907\u66f4\u65b0..."));
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) { setWaiting(worker); setCheckMessage(""); }
          else if (worker.state === "redundant") setCheckMessage(t("No update is ready. Try again later.", "\u5c1a\u65e0\u53ef\u7528\u66f4\u65b0\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002"));
        });
      } else setCheckMessage(t("No update is ready.", "\u5c1a\u65e0\u53ef\u7528\u66f4\u65b0\u3002"));
    } catch { setCheckMessage(t("Could not check for updates. Try again.", "\u65e0\u6cd5\u68c0\u67e5\u66f4\u65b0\uff0c\u8bf7\u91cd\u8bd5\u3002")); }
    finally { setChecking(false); }
  }
  function revealSidebarControls(control: HTMLElement) {
    const sidebar = control.closest<HTMLElement>("aside.sidebar");
    if (!sidebar || !control.isConnected || getComputedStyle(sidebar).overflowY !== "auto") return;
    const target = control.closest(".pwa-sidebar-actions") ?? control;
    const bounds = target.getBoundingClientRect(), viewport = sidebar.getBoundingClientRect();
    const padding = getComputedStyle(sidebar);
    const bottom = viewport.bottom - parseFloat(padding.paddingBottom);
    const top = viewport.top + parseFloat(padding.paddingTop);
    if (bounds.bottom > bottom) sidebar.scrollTop += bounds.bottom - bottom;
    else if (bounds.top < top) sidebar.scrollTop -= top - bounds.top;
  }
  useEffect(() => {
    if (!confirmation.open || !confirmButton.current) return;
    confirmButton.current.focus({ preventScroll: true });
    if (confirmation.origin === "sidebar") revealSidebarControls(confirmButton.current);
  }, [confirmation]);
  function blocker(): string {
    if (document.querySelector("dialog[open]")) return "Save or close the open editor before updating.";
    if (isSettingsDirty()) return "Save your settings before updating.";
    if (isProcessing()) return "Finish the active provider request before updating.";
    if (avatarWritesPending()) return "Wait for the profile image to finish saving before updating.";
    if (document.querySelector('[data-unsaved-edit="true"]')) return "Save or close the open editor before updating.";
    return "";
  }
  function requestUpdate(origin: "sidebar" | "banner") {
    const reason = blocker();
    setError(reason);
    setConfirmation({ origin, open: reason === "" });
  }
  function closeConfirmation() {
    setConfirmation(current => ({ ...current, open: false }));
  }
  function cancelUpdate() {
    const origin = confirmation.origin;
    closeConfirmation();
    requestAnimationFrame(() => {
      const button = (origin === "sidebar" ? sidebarUpdateButton : bannerUpdateButton).current;
      if (!button) return;
      button.focus({ preventScroll: true });
      if (origin === "sidebar") revealSidebarControls(button);
    });
  }
  async function update() {
    const reason = blocker();
    if (reason) {
      setError(reason);
      closeConfirmation();
      return;
    }
    closeConfirmation();
    setUpdating(true);
    try {
      await flushWrites();
      await flushSettingsWrites();
      await flushAvatarWrites();
    } catch (e) {
      setUpdating(false);
      setError(
        e instanceof Error ? e.message : "Save your changes before updating.",
      );
      return;
    }
    // A newer waiting worker can replace the one captured by React state
    // between opening the confirmation and accepting it.
    let registration: ServiceWorkerRegistration | undefined;
    try {
      registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    } catch {
      setUpdating(false);
      setError("Update did not activate. Try again when connected.");
      return;
    }
    if (!registration?.waiting && !registration?.installing && refreshReady) {
      location.reload();
      return;
    }
    if (!registration || (!registration.waiting && !registration.installing)) {
      setUpdating(false);
      setError("Update did not activate. Try again when connected.");
      return;
    }
    const observed = new Set<ServiceWorker>();
    const attempted = new Set<ServiceWorker>();
    const watch = (worker: ServiceWorker | null) => {
      if (!worker || observed.has(worker)) return;
      observed.add(worker);
      worker.addEventListener("statechange", activateLatest);
    };
    function activateLatest() {
      if (!registration) return;
      watch(registration.installing);
      const worker = registration.waiting;
      if (!worker || attempted.has(worker)) return;
      attempted.add(worker);
      watch(worker);
      worker.postMessage({ type: "SKIP_WAITING" });
    }
    const cleanup = () => {
      registration?.removeEventListener("updatefound", activateLatest);
      for (const worker of observed) worker.removeEventListener("statechange", activateLatest);
      navigator.serviceWorker.removeEventListener("controllerchange", activated);
    };
    const timer = setTimeout(() => {
      cleanup();
      setUpdating(false);
      setError("Update did not activate. Try again when connected.");
    }, 15000);
    function activated() {
      clearTimeout(timer);
      cleanup();
      location.reload();
    }
    navigator.serviceWorker.addEventListener("controllerchange", activated, { once: true });
    registration.addEventListener("updatefound", activateLatest);
    activateLatest();
  }
  const errorText = language === "zh-CN" ? ({
    "Offline installation is unavailable. Your local meetings can still be backed up.": "离线安装不可用。您仍可备份本地会议。",
    "Save or close the open editor before updating.": "更新前请保存或关闭打开的编辑器。",
    "Wait for the profile image to finish saving before updating.": "\u66f4\u65b0\u524d\u8bf7\u7b49\u5f85\u5934\u50cf\u4fdd\u5b58\u5b8c\u6210\u3002",
    "Save your settings before updating.": "更新前请先保存设置。",
    "Finish the active provider request before updating.": "更新前请等待当前服务商请求完成。",
    "Save your changes before updating.": "更新前请先保存更改。",
    "Update did not activate. Try again when connected.": "更新未能激活。请联网后重试。",
  } as Record<string, string>)[error] ?? translateMessage(error, language) : error;
  const sidebarError = confirmation.origin === "sidebar" && !!error;
  const sidebarUpdateText = updating ? t("Updating...", "\u6b63\u5728\u66f4\u65b0...") : t("Update now", "\u7acb\u5373\u66f4\u65b0");
  const sidebarCheckText = checking ? t("Checking...", "\u6b63\u5728\u68c0\u67e5...") : t("Check for updates", "\u68c0\u67e5\u66f4\u65b0");
  return (
    <>
      {sidebarSlot && createPortal(<div className="pwa-sidebar">
        <span className="pwa-version" data-tooltip={__BUILD_ID__}>{t("Version", "\u7248\u672c")} {appVersion} - {displayBuild}</span>
        {confirmation.open && confirmation.origin === "sidebar" && !updating ? <div className="pwa-sidebar-actions">
          <Button ref={confirmButton} type="button" className="pwa-sidebar-button pwa-sidebar-confirm" aria-label={t("Confirm update", "确认更新")} data-tooltip={t("Confirm update", "确认更新")} onClick={() => void update()}><Icon glyph={Check} size="compact" />{t("Confirm update", "确认更新")}</Button>
          <Button type="button" className="pwa-sidebar-button pwa-sidebar-cancel" aria-label={t("Cancel", "取消")} data-tooltip={t("Cancel", "取消")} onClick={cancelUpdate}><Icon glyph={X} size="compact" /></Button>
        </div> : (waiting || refreshReady) ? <Button ref={sidebarUpdateButton} type="button" className="pwa-sidebar-button" aria-label={t("Open update confirmation", "\u6253\u5f00\u66f4\u65b0\u786e\u8ba4")} data-tooltip={sidebarUpdateText} onClick={() => requestUpdate("sidebar")} disabled={updating}><Icon glyph={RefreshCw} size="control" />{sidebarUpdateText}</Button>
          : <Button type="button" className="pwa-sidebar-button" data-tooltip={sidebarCheckText} onClick={() => void checkForUpdates()} disabled={checking}><Icon glyph={RefreshCw} size="control" className={checking ? "pwa-check-spin" : undefined} />{sidebarCheckText}</Button>}
        <span className={`pwa-check-message${sidebarError ? " pwa-update-error" : ""}`} role="status" data-tooltip={sidebarError ? errorText : undefined} tabIndex={sidebarError ? 0 : undefined}>{sidebarError ? <><Icon glyph={AlertTriangle} size="compact" /><span>{errorText}</span></> : checkMessage}</span>
      </div>, sidebarSlot)}
      {offline && (
        <div className="notice">
          <Icon glyph={WifiOff} size="status" />
          {t("Browser reports offline · review, edit, and export saved meetings. Cloud AI needs a connection.", "浏览器显示离线 · 您仍可查看、编辑和导出已保存的会议。云端 AI 需要网络连接。")}
        </div>
      )}
      {(waiting || refreshReady) && (
        <div className="notice update" role="status">
          <Icon glyph={RefreshCw} size="status" className={updating ? "pwa-check-spin" : undefined} />
          <span>{t("A new version is ready. Save your work before updating.", "新版本已准备好。更新前请先保存工作。")}</span>
          {confirmation.open && confirmation.origin === "banner" && !updating ? (
            <>
              <Button ref={confirmButton} className="button secondary compact" onClick={() => void update()}>
                {t("Confirm update", "确认更新")}
              </Button>
              <Button className="text-button" onClick={cancelUpdate}>
                {t("Cancel", "取消")}
              </Button>
            </>
          ) : (
            <Button
              className="button secondary compact"
              ref={bannerUpdateButton}
              onClick={() => requestUpdate("banner")}
              disabled={updating}
            >
              {updating ? t("Updating…", "正在更新…") : t("Update now", "立即更新")}
            </Button>
          )}
        </div>
      )}
      {install && (
        <div className="notice install">
          <Icon glyph={Download} size="status" />
          <span>{t("Make this workspace feel at home on your device.", "将此工作空间安装到您的设备。")}</span>
          <Button
            className="button secondary compact"
            onClick={async () => {
              await install.prompt();
              await install.userChoice;
              setInstall(undefined);
            }}
          >
            {t("Install app", "安装应用")}
          </Button>
          <Button className="text-button" onClick={() => setInstall(undefined)}>
            {t("Later", "稍后")}
          </Button>
        </div>
      )}
      {error && !sidebarError && (
        <div className="notice" role="status">
          {errorText}
        </div>
      )}
    </>
  );
}
