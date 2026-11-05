export type Provider = "openai" | "openrouter";
export type Stage = "speech" | "memo";
export type Selection = { provider: Provider; model: string };
const keys: Record<Provider, string> = { openai: "", openrouter: "" };
const defaults: Record<Provider, Record<Stage, string>> = {
  openai: { speech: "gpt-transcribe", memo: "gpt-6-luna" },
  openrouter: { speech: "elevenlabs/scribe-v2", memo: "openai/gpt-6-luna" },
};
let selections: Record<Stage, Selection> = {
  speech: { provider: "openai", model: defaults.openai.speech },
  memo: { provider: "openai", model: defaults.openai.memo },
};
export const defaultModel = (provider: Provider, stage: Stage) =>
  defaults[provider][stage];
export const getSelection = (stage: Stage): Selection => ({
  ...selections[stage],
});
export function setSelection(stage: Stage, selection: Selection) {
  selections = {
    ...selections,
    [stage]: { ...selection, model: selection.model.trim() },
  };
  window.dispatchEvent(new Event("memo-keys-changed"));
}
export const getKey = (provider: Provider) => keys[provider];
export function setKey(provider: Provider, value: string) {
  keys[provider] = value.trim();
  window.dispatchEvent(new Event("memo-keys-changed"));
}
export function forgetKeys() {
  keys.openai = "";
  keys.openrouter = "";
  window.dispatchEvent(new Event("memo-keys-changed"));
}
let speechRate: number | null = null;
export const getSpeechRate = () => speechRate;
export const setSpeechRate = (value: number | null) => {
  speechRate = value;
};
