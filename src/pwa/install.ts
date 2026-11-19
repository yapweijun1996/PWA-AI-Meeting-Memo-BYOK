/**
 * Shared install-prompt state. The browser fires `beforeinstallprompt` once per
 * page load, possibly before any component mounts, so the listener lives at
 * module level and every install control reads the same snapshot.
 */
export type InstallMode = "none" | "prompt" | "ios-guide";
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export type InstallEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
};

const STANDALONE_MODES = ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"];

/** iPadOS 13+ reports a desktop Mac platform, so touch points distinguish it. */
export function isIosDevice(env: Pick<InstallEnvironment, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true;
  return env.platform === "MacIntel" && env.maxTouchPoints > 1;
}

/** An installed or standalone app never offers installation. iOS has no prompt event, so it gets a guide. */
export function resolveInstallMode(input: { env: InstallEnvironment; installed: boolean; hasPrompt: boolean }): InstallMode {
  if (input.installed || input.env.standalone) return "none";
  if (input.hasPrompt) return "prompt";
  return isIosDevice(input.env) ? "ios-guide" : "none";
}

let promptEvent: InstallPromptEvent | undefined;
let installed = false;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function readEnvironment(): InstallEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true ||
    (typeof matchMedia === "function" && STANDALONE_MODES.some((mode) => matchMedia(`(display-mode: ${mode})`).matches));
  return { userAgent: nav.userAgent, platform: nav.platform, maxTouchPoints: nav.maxTouchPoints ?? 0, standalone };
}

export function startInstallCapture(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    emit();
  });
  addEventListener("appinstalled", () => {
    promptEvent = undefined;
    installed = true;
    emit();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  startInstallCapture();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getInstallMode(): InstallMode {
  if (typeof navigator === "undefined") return "none";
  return resolveInstallMode({ env: readEnvironment(), installed, hasPrompt: promptEvent !== undefined });
}

/** A deferred prompt is single-use, so it is released before the browser dialog opens. */
export async function requestInstall(): Promise<InstallOutcome> {
  const event = promptEvent;
  if (!event) return "unavailable";
  promptEvent = undefined;
  emit();
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

startInstallCapture();
