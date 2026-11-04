type Provider = "openai" | "deepgram";
const keys: Record<Provider, string> = { openai: "", deepgram: "" };
export const getKey = (provider: Provider) => keys[provider];
export function setKey(provider: Provider, value: string) {
  keys[provider] = value.trim();
  window.dispatchEvent(new Event("memo-keys-changed"));
}
export function forgetKeys() {
  keys.openai = "";
  keys.deepgram = "";
  window.dispatchEvent(new Event("memo-keys-changed"));
}
let speechRate: number | null = null;
export const getSpeechRate = () => speechRate;
export const setSpeechRate = (value: number | null) => {
  speechRate = value;
};
