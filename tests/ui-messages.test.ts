import { expect, it } from "vitest";
import { translateMessage } from "../src/ui-messages";
import { memoLanguageLabel } from "../src/i18n";
import { memoLanguageInstruction, memoLanguageName } from "../src/domain/memo-language";

it("localizes display labels without changing provider language instructions", () => {
  expect(memoLanguageLabel("meeting", "zh-CN")).toBe("会议语言");
  expect(memoLanguageLabel("en", "zh-CN")).toBe("英语");
  expect(memoLanguageLabel("zh-CN", "zh-CN")).toBe("简体中文");
  expect(memoLanguageLabel("ms", "zh-CN")).toBe("马来语");
  expect(memoLanguageLabel("meeting", "en")).toBe("Meeting language");
  expect(memoLanguageLabel("meeting", "ms")).toBe("Meeting language");
  expect(memoLanguageName("zh-CN")).toBe("Simplified Chinese");
  expect(memoLanguageInstruction("zh-CN")).toContain("Write the notes in Simplified Chinese");
});

it("translates current and legacy review storage refusals without changing the original error", () => {
  const current = "This meeting cannot retain the bounded review responses within the local record limit. Back it up or use the existing memo workflow. No new request was sent.";
  const legacy = current.replace("Back it up", "Back up");
  for (const message of [current, legacy]) {
    expect(translateMessage(message, "zh-CN")).toContain("尚未发送新的请求");
    expect(translateMessage(message, "zh-CN")).toContain("本地记录容量不足");
    expect(translateMessage(message, "en")).toBe(message);
  }
  expect(translateMessage("The received response exceeds the local meeting record budget. Export the unsaved response before leaving this page.", "zh-CN")).toContain("先导出尚未保存的回应");
});

it("long memo confirmation errors and saved-step status retain Chinese text", () => {
  expect(translateMessage("Memo plan paused. Saved steps were retained.", "zh-CN")).toBe("纪要计划已暂停，已保存的步骤得到保留。");
  expect(translateMessage("Saved memo step 2/3.", "zh-CN")).toBe("已保存纪要步骤 2/3。");
  expect(translateMessage("Memo step 1/3. Keep this page open.", "zh-CN")).toBe("纪要步骤 1/3。请保持页面打开。");
});

it("translates known messages without changing unknown content", () => {
  const english = "This meeting changed in another tab. Reload it before saving; your unsaved text is still in this page.";
  expect(translateMessage(english, "en")).toBe(english);
  expect(translateMessage(english, "zh-CN")).toContain("未保存的文字仍在此页面");
  expect(translateMessage("User-entered text 123", "zh-CN")).toBe("User-entered text 123");
});

it("preserves billing uncertainty and no-retry guidance for provider errors", () => {
  const uncertain = "Provider returned HTTP 503. The outcome may be billable; review your account before retrying.";
  expect(translateMessage(uncertain, "zh-CN")).toContain("可能产生费用");
  const rejected = "Provider returned HTTP 429. The provider returned a rate or quota limit. Check your account. No automatic retry was made.";
  const result = translateMessage(rejected, "zh-CN");
  expect(result).toContain("额度限制");
  expect(result).toContain("未进行自动重试");
});
