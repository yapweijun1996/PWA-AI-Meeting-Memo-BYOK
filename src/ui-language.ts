import { useSyncExternalStore } from "react";
import { getUiLanguage, subscribeSettingsChanges } from "./providers/credentials";

export function useUiLanguage() {
  return useSyncExternalStore(subscribeSettingsChanges, getUiLanguage, () => "en" as const);
}
