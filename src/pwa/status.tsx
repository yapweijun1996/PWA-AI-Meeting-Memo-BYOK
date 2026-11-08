import { useEffect, useState } from "react";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { isProcessing } from "../jobs/runner";
import { flushWrites } from "../storage/repository";
import { flushSettingsWrites, isSettingsDirty } from "../providers/credentials";
import { useUiLanguage } from "../ui-language";
import { translateMessage } from "../ui-messages";
export function PwaStatus() {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => language === "zh-CN" ? zh : en;
  const [refreshReady, setRefreshReady] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker>(),
    [updating, setUpdating] = useState(false),
    [confirming, setConfirming] = useState(false),
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
  async function update() {
    if (document.querySelector("dialog[open]")) {
      setError("Save or close the open editor before updating.");
      return;
    }
    if (isSettingsDirty()) {
      setError("Save your settings before updating.");
      return;
    }
    if (isProcessing()) {
      setError("Finish the active provider request before updating.");
      return;
    }
    if (document.querySelector('[data-unsaved-edit="true"]')) {
      setError(
        t(
          "Save or close the open editor before updating.",
          "更新前请保存或关闭打开的编辑器。",
        ),
      );
      return;
    }
    setConfirming(false);
    try {
      await flushWrites();
      await flushSettingsWrites();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Save your changes before updating.",
      );
      return;
    }
    setUpdating(true);
    if (!waiting && refreshReady) {
      location.reload();
      return;
    }
    const timer = setTimeout(() => {
      setUpdating(false);
      setError("Update did not activate. Try again when connected.");
    }, 15000);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(timer);
        location.reload();
      },
      { once: true },
    );
    waiting?.postMessage({ type: "SKIP_WAITING" });
  }
  return (
    <>
      {offline && (
        <div className="notice">
          <WifiOff size={17} />
          {t("Browser reports offline · review, edit, and export saved meetings. Cloud AI needs a connection.", "浏览器显示离线 · 您仍可查看、编辑和导出已保存的会议。云端 AI 需要网络连接。")}
        </div>
      )}
      {(waiting || refreshReady) && (
        <div className="notice update" role="status">
          <RefreshCw size={17} />
          <span>{t("A new version is ready. Save your work before updating.", "新版本已准备好。更新前请先保存工作。")}</span>
          {confirming && !updating ? (
            <>
              <button className="button secondary compact" onClick={() => void update()}>
                {t("Confirm update", "确认更新")}
              </button>
              <button className="text-button" onClick={() => setConfirming(false)}>
                {t("Cancel", "取消")}
              </button>
            </>
          ) : (
            <button
              className="button secondary compact"
              onClick={() => { setError(""); setConfirming(true); }}
              disabled={updating}
            >
              {updating ? t("Updating…", "正在更新…") : t("Update now", "立即更新")}
            </button>
          )}
        </div>
      )}
      {install && (
        <div className="notice install">
          <Download size={17} />
          <span>{t("Make this workspace feel at home on your device.", "将此工作空间安装到您的设备。")}</span>
          <button
            className="button secondary compact"
            onClick={async () => {
              await install.prompt();
              await install.userChoice;
              setInstall(undefined);
            }}
          >
            {t("Install app", "安装应用")}
          </button>
          <button className="text-button" onClick={() => setInstall(undefined)}>
            {t("Later", "稍后")}
          </button>
        </div>
      )}
      {error && (
        <div className="notice" role="status">
          {language === "zh-CN" ? ({
            "Offline installation is unavailable. Your local meetings can still be backed up.": "离线安装不可用。您仍可备份本地会议。",
            "Save or close the open editor before updating.": "更新前请保存或关闭打开的编辑器。",
            "Save your settings before updating.": "更新前请先保存设置。",
            "Finish the active provider request before updating.": "更新前请等待当前服务商请求完成。",
            "Save your changes before updating.": "更新前请先保存更改。",
            "Update did not activate. Try again when connected.": "更新未能激活。请联网后重试。",
          } as Record<string, string>)[error] ?? translateMessage(error, language) : error}
        </div>
      )}
    </>
  );
}
