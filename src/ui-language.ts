import { useSyncExternalStore } from "react";
import { getUiLanguage } from "./providers/credentials";

function subscribe(listener: () => void) {
  window.addEventListener("memo-keys-changed", listener);
  return () => window.removeEventListener("memo-keys-changed", listener);
}

export function useUiLanguage() {
  return useSyncExternalStore(subscribe, getUiLanguage, () => "en");
}
