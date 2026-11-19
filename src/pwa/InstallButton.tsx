import { useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import { Button } from "../components/controls";
import { Icon } from "../components/Icon";
import { Modal } from "../components/ui";
import { translateUi } from "../i18n";
import { useUiLanguage } from "../ui-language";
import { getInstallMode, requestInstall, subscribeInstall } from "./install";
import "./install.css";

/** One install control for the topbar and the sidebar; both read the same browser state. */
export function InstallButton({ placement }: { placement: "topbar" | "sidebar" }) {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const mode = useSyncExternalStore(subscribeInstall, getInstallMode, () => "none" as const);
  const [guideOpen, setGuideOpen] = useState(false);
  if (mode === "none") return null;
  const label = t("Install app", "安装应用");
  const steps: [string, string][] = [
    [t("Open the Share menu", "打开分享菜单"), t("Tap the Share button in the Safari toolbar.", "点按 Safari 工具栏中的分享按钮。")],
    [t("Add to Home Screen", "添加到主屏幕"), t("Scroll the menu and choose Add to Home Screen.", "在菜单中向下滚动并选择“添加到主屏幕”。")],
    [t("Confirm", "确认"), t("Tap Add. The app then opens from your Home Screen.", "点按“添加”。之后可从主屏幕打开此应用。")],
  ];
  return (
    <>
      <Button
        type="button"
        className={placement === "topbar" ? "topbar-install" : "pwa-sidebar-button pwa-sidebar-install"}
        aria-label={label}
        aria-haspopup={mode === "ios-guide" ? "dialog" : undefined}
        data-tooltip={label}
        onClick={() => { if (mode === "ios-guide") setGuideOpen(true); else void requestInstall(); }}
      >
        <Icon glyph={Download} size={placement === "topbar" ? "transport" : "control"} aria-hidden="true" />
        <span className="install-label">{label}</span>
      </Button>
      {mode === "ios-guide" && guideOpen && (
        <Modal title={t("Add to Home Screen", "添加到主屏幕")} onClose={() => setGuideOpen(false)}>
          <div className="modal-body help-guide">
            <p>{t("On iPhone and iPad, install from the browser's Share menu.", "在 iPhone 和 iPad 上，请通过浏览器的分享菜单安装。")}</p>
            <ol className="help-steps" role="list">
              {steps.map(([title, description]) => (
                <li key={title}><div><strong>{title}</strong><p>{description}</p></div></li>
              ))}
            </ol>
          </div>
        </Modal>
      )}
    </>
  );
}
