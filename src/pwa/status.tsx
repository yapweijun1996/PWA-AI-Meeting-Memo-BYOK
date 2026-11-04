import { useEffect, useState } from "react";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { isProcessing } from "../jobs/runner";
export function PwaStatus() {
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
      removeEventListener("online", on);
      removeEventListener("offline", on);
      removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  async function update() {
    if (isProcessing()) {
      setError("Finish the active provider request before updating.");
      return;
    }
    if (!confirm("Apply the update now? Save any open text edits first."))
      return;
    setUpdating(true);
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
          Offline · review, edit, and export saved meetings. Cloud AI needs a
          connection.
        </div>
      )}
      {waiting && (
        <div className="notice update" role="status">
          <RefreshCw size={17} />
          <span>A new version is ready. Save your work before updating.</span>
          <button
            className="button secondary compact"
            onClick={() => void update()}
            disabled={updating}
          >
            {updating ? "Updating…" : "Update now"}
          </button>
        </div>
      )}
      {install && (
        <div className="notice install">
          <Download size={17} />
          <span>Make this workspace feel at home on your device.</span>
          <button
            className="button secondary compact"
            onClick={async () => {
              await install.prompt();
              await install.userChoice;
              setInstall(undefined);
            }}
          >
            Install app
          </button>
          <button className="text-button" onClick={() => setInstall(undefined)}>
            Later
          </button>
        </div>
      )}
      {error && (
        <div className="notice" role="status">
          {error}
        </div>
      )}
    </>
  );
}
