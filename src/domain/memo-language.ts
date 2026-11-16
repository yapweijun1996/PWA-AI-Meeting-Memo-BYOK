/** Output preference is separate from transcript language and interface translation. */
export const MEMO_LANGUAGE_PREFERENCES = ["interface", "meeting", "en", "zh-CN", "ms"] as const;
export const MEMO_OUTPUT_LANGUAGES = ["meeting", "en", "zh-CN", "ms"] as const;
export type MemoLanguagePreference = typeof MEMO_LANGUAGE_PREFERENCES[number];
export type MemoOutputLanguage = typeof MEMO_OUTPUT_LANGUAGES[number];

export function resolveMemoLanguage(
  preference: MemoLanguagePreference,
  interfaceLanguage: "en" | "zh-CN" | "ms",
): MemoOutputLanguage {
  return preference === "interface" ? interfaceLanguage : preference;
}

export function memoLanguageName(language: MemoOutputLanguage): string {
  return { meeting: "Meeting language", en: "English", "zh-CN": "Simplified Chinese", ms: "Malay" }[language];
}

export function memoLanguageInstruction(language: MemoOutputLanguage): string {
  return language === "meeting"
    ? "Write the notes in the meeting language indicated by the transcript and meeting context."
    : `Write the notes in ${memoLanguageName(language)}. Keep exact source quotations unchanged in their original language. Do not translate identifiers or infer new facts.`;
}
