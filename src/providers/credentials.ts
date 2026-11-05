import {
  readSettings,
  writeSettings,
  type SettingsRecord,
} from "../storage/settings";
export type Provider = "openai" | "openrouter";
export type Stage = "speech" | "memo";
export type Selection = { provider: Provider; model: string };
const defaults: Record<Provider, Record<Stage, string>> = {
  openai: { speech: "gpt-transcribe", memo: "gpt-6-luna" },
  openrouter: { speech: "elevenlabs/scribe-v2", memo: "openai/gpt-6-luna" },
};
let settings: SettingsRecord = {
  version: 1,
  revision: 0,
  keys: { openai: "", openrouter: "" },
  speech: { provider: "openai", model: defaults.openai.speech },
  memo: { provider: "openai", model: defaults.openai.memo },
  speechRate: null,
};
let storageError = "";
const unavailable =
  "Settings could not be read from local storage. Your meetings were not removed. Check browser storage permissions before saving settings.";
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("meeting-memo-settings-changes-v1")
    : null;
export async function initializeSettings() {
  try {
    const saved = await readSettings();
    if (saved && saved.revision >= settings.revision) settings = saved;
    storageError = "";
  } catch {
    storageError = unavailable;
  }
}
channel?.addEventListener("message", () => {
  void initializeSettings().then(() => {
    window.dispatchEvent(new Event("memo-settings-external"));
    window.dispatchEvent(new Event("memo-keys-changed"));
  });
});
export const getSettingsStorageError = () => storageError;
export const getSettingsRevision = () => settings.revision;
export const defaultModel = (provider: Provider, stage: Stage) =>
  defaults[provider][stage];
export const getSelection = (stage: Stage): Selection => ({
  ...settings[stage],
});
export const getKey = (provider: Provider) => settings.keys[provider];
export const getSpeechRate = () => settings.speechRate;
let pendingWrite: Promise<void> | undefined;
let dirty = false;
export const setSettingsDirty = (value: boolean) => {
  dirty = value;
};
export const isSettingsDirty = () => dirty;
export async function flushSettingsWrites() {
  if (pendingWrite) await pendingWrite;
  if (dirty) throw new Error("Save your settings before updating.");
}
export function saveSettings(
  value: Omit<SettingsRecord, "version" | "revision">,
  expectedRevision: number,
) {
  const write = commitSettings(value, expectedRevision);
  pendingWrite = write;
  void write.then(
    () => {
      if (pendingWrite === write) pendingWrite = undefined;
    },
    () => {
      if (pendingWrite === write) pendingWrite = undefined;
    },
  );
  return write;
}
async function commitSettings(
  value: Omit<SettingsRecord, "version" | "revision">,
  expectedRevision: number,
) {
  if (storageError) throw new Error(unavailable);
  try {
    settings = await writeSettings(
      { version: 1, revision: expectedRevision, ...value },
      expectedRevision,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Settings changed in another tab")
    )
      throw error;
    throw new Error(
      "Could not save settings on this device. Your unsaved entries are still visible; check browser storage permissions and try again.",
      { cause: error },
    );
  }
  window.dispatchEvent(new Event("memo-keys-changed"));
  channel?.postMessage("updated");
}
